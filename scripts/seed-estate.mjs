#!/usr/bin/env node
/**
 * Seed the estate directory (estate-auth-design.md §9 step 2, §14.1).
 *
 * DRY-RUN BY DEFAULT: prints EVERY row it would write, with origin — the
 * review-key backfill's lesson: read the rows, not the counts. Nothing is
 * written without --commit, and --commit demands an explicit --local or
 * --remote so the target is a decision, not a default.
 *
 * Sources (union by lowercased email; first source to introduce an email
 * names its origin):
 *   1. library production app_user  (read-only SELECT via wrangler --remote)
 *        active role → approved, origin seed:library; pending → pending
 *   2. games production app_user    (likewise, seed:games)
 *   3. audiobook ADMIN_EMAILS       (site/identity.js) → approved + approver, seed:admin
 *   4. OWNER_EMAILS                 (auth-worker wrangler.toml) → approved + approver, seed:admin
 *   5. --extra <file>               (the pre-seed list the owner may supply
 *        later — one email per line, # comments; → approved, seed:admin.
 *        OPTIONAL: absence never blocks the seed.)
 *
 * Idempotent: INSERT ... ON CONFLICT(email) DO NOTHING — an existing row is
 * NEVER changed, so re-running cannot downgrade anyone. The one exception is
 * an explicit UPGRADE: is_approver 0→1 for admin/owner emails. Status
 * upgrades for existing rows are the admin API's job, deliberately.
 *
 * ⚠️ Refuses zero-row reads (the d1.mjs lesson: a zero-row read is a FAILED
 * read, not an empty table).
 *
 * Usage, from catalog-platform/:
 *   node scripts/seed-estate.mjs                       # dry run, prints rows
 *   node scripts/seed-estate.mjs --extra emails.txt    # with the later list
 *   node scripts/seed-estate.mjs --commit --local      # rehearse into local D1
 *   node scripts/seed-estate.mjs --commit --remote     # 🔴 the real seed (dispatcher)
 *
 * --sources-local reads the two app_user tables from each repo's LOCAL dev
 * D1 instead of production — a rehearsal lane only (local dev data is not
 * the household), so it refuses to combine with --remote.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const PLATFORM = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPOS = resolve(PLATFORM, '..');
const LIBRARY_DIR = process.env.LIBRARY_CATALOG_DIR ?? join(REPOS, 'bookbuddy', 'library_catalog');
const GAMES_DIR = process.env.GAMES_CATALOG_DIR ?? join(REPOS, 'boardbuddy', 'Board_Game_Catalog');
const AUDIOBOOK_IDENTITY =
  process.env.AUDIOBOOK_IDENTITY_JS ?? join(REPOS, 'bookbuddy', 'audiobook_catalog', 'site', 'identity.js');
const AUTH_WORKER_DIR = join(PLATFORM, 'apps', 'auth-worker');

const args = process.argv.slice(2);
const commit = args.includes('--commit');
const targetLocal = args.includes('--local');
const targetRemote = args.includes('--remote');
const extraIdx = args.indexOf('--extra');
const extraFile = extraIdx >= 0 ? args[extraIdx + 1] : null;

const sourcesLocal = args.includes('--sources-local');

if (commit && targetLocal === targetRemote) {
  console.error('--commit requires exactly one of --local or --remote (the target is a decision, not a default).');
  process.exit(2);
}
if (sourcesLocal && targetRemote) {
  console.error('--sources-local is a rehearsal lane; seeding the REMOTE directory from local dev data is refused.');
  process.exit(2);
}

function sh(cwd, cmd, cmdArgs) {
  return execFileSync(cmd, cmdArgs, {
    cwd,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/** Read-only SELECT against a production app D1. Refuses zero rows. */
function readAppUsers(label, appDir, dbName, sql) {
  const workerDir = join(appDir, 'apps', 'worker');
  if (!existsSync(workerDir)) {
    console.error(`${label}: checkout not found at ${workerDir} (set ${label.toUpperCase()}_CATALOG_DIR)`);
    process.exit(2);
  }
  const sourceFlag = sourcesLocal ? '--local' : '--remote';
  console.error(`reading ${label} app_user (read-only, ${sourceFlag})…`);
  // ⚠️ Via --command, NOT --file — measured 2026-08-13 on the first real run:
  // with `--file`, this wrangler version's --json output contains ONLY the
  // execution summary ("Total queries executed", …); the SELECT's rows are
  // never in the JSON at all, so a file-based read is structurally unable to
  // return users. The original reason for --file (Windows shell:true
  // concatenates args unquoted, shredding SQL spaces) is answered by
  // pre-quoting the whole SQL as one argument — cmd.exe keeps a
  // double-quoted token intact, and these SELECTs contain no double quotes.
  const out = sh(workerDir, 'npx', ['wrangler', 'd1', 'execute', dbName, sourceFlag, '--json', '--command', `"${sql}"`]);
  const jsonStart = out.indexOf('[');
  const parsed = JSON.parse(out.slice(jsonStart));
  // ⚠️ With `--file`, wrangler's --json array includes a SUMMARY element whose
  // "results" are meta rows ("Total queries executed", "Rows read", …), not
  // user rows. `parsed[0]` grabbed that summary on the first real remote run —
  // it passed the zero-row check (the summary IS rows) and then crashed the
  // fold on `email: undefined`. Select by SHAPE instead: the one element whose
  // rows actually carry an `email` column. Found 2026-08-13 on the first
  // dispatcher-run dry-run, exactly the run this script's own handoff demanded
  // a human execute before --commit.
  const rows = parsed.map((p) => p?.results ?? []).find((rs) => rs.length > 0 && typeof rs[0]?.email === 'string') ?? [];
  if (rows.length === 0) {
    console.error(`${label}: ZERO user rows from ${dbName}.app_user (summary-only or empty output) — a zero-row read is a failed read. Refusing.`);
    process.exit(2);
  }
  return rows;
}

function parseAdminEmails() {
  if (!existsSync(AUDIOBOOK_IDENTITY)) {
    console.error(`audiobook identity.js not found at ${AUDIOBOOK_IDENTITY} — refusing (ADMIN_EMAILS is a seed source).`);
    process.exit(2);
  }
  const src = readFileSync(AUDIOBOOK_IDENTITY, 'utf8');
  const m = /export const ADMIN_EMAILS = \[([^\]]*)\]/.exec(src);
  if (!m) {
    console.error('could not find `export const ADMIN_EMAILS = [...]` in identity.js — refusing.');
    process.exit(2);
  }
  return [...m[1].matchAll(/'([^']+)'|"([^"]+)"/g)].map((x) => (x[1] ?? x[2]).trim().toLowerCase());
}

function parseOwnerEmails() {
  const toml = readFileSync(join(AUTH_WORKER_DIR, 'wrangler.toml'), 'utf8');
  const m = /^OWNER_EMAILS\s*=\s*"([^"]*)"/m.exec(toml);
  if (!m || !m[1].trim()) {
    console.error('OWNER_EMAILS missing from apps/auth-worker/wrangler.toml [vars] — refusing.');
    process.exit(2);
  }
  return m[1].split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
}

function parseExtraList() {
  if (!extraFile) return []; // The later pre-seed list is OPTIONAL — never block on it.
  if (!existsSync(extraFile)) {
    console.error(`--extra file not found: ${extraFile}`);
    process.exit(2);
  }
  return readFileSync(extraFile, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.replace(/#.*$/, '').trim().toLowerCase())
    .filter((l) => l.includes('@'));
}

// ---------------------------------------------------------------------------

const libraryRows = readAppUsers('library', LIBRARY_DIR, 'library-catalog',
  'SELECT email, firebase_uid, display_name, role FROM app_user ORDER BY id');
const gamesRows = readAppUsers('games', GAMES_DIR, 'board-game-catalog',
  'SELECT email, display_name, role FROM app_user ORDER BY id');
const adminEmails = parseAdminEmails();
const ownerEmails = parseOwnerEmails();
const extraEmails = parseExtraList();

/** email → row-to-write. First source to introduce an email sets origin. */
const plan = new Map();

function fold(email, patch) {
  const key = email.trim().toLowerCase();
  const cur = plan.get(key) ?? {
    email: key,
    firebase_uid: null,
    display_name: null,
    status: 'pending',
    is_approver: false,
    origin: patch.origin,
    sources: [],
  };
  cur.firebase_uid = cur.firebase_uid ?? patch.firebase_uid ?? null;
  cur.display_name = cur.display_name ?? patch.display_name ?? null;
  if (patch.status === 'approved') cur.status = 'approved'; // upgrade only — pending never overwrites
  cur.is_approver = cur.is_approver || patch.is_approver === true;
  cur.sources.push(patch.source);
  plan.set(key, cur);
}

for (const r of libraryRows) {
  fold(r.email, {
    firebase_uid: r.firebase_uid ?? null,
    display_name: r.display_name ?? null,
    status: r.role !== 'pending' ? 'approved' : 'pending',
    origin: 'seed:library',
    source: `library(role=${r.role})`,
  });
}
for (const r of gamesRows) {
  fold(r.email, {
    display_name: r.display_name ?? null,
    status: r.role !== 'pending' ? 'approved' : 'pending',
    origin: 'seed:games',
    source: `games(role=${r.role})`,
  });
}
for (const e of adminEmails) {
  fold(e, { status: 'approved', is_approver: true, origin: 'seed:admin', source: 'audiobook ADMIN_EMAILS' });
}
for (const e of ownerEmails) {
  fold(e, { status: 'approved', is_approver: true, origin: 'seed:admin', source: 'OWNER_EMAILS' });
}
for (const e of extraEmails) {
  fold(e, { status: 'approved', origin: 'seed:admin', source: `pre-seed list (${extraFile})` });
}

// ---------------------------------------------------------------------------

const rows = [...plan.values()];
console.log(`\nSeed plan — ${rows.length} rows (library ${libraryRows.length}, games ${gamesRows.length}, admin ${adminEmails.length}, owner ${ownerEmails.length}, extra ${extraEmails.length}):\n`);
for (const r of rows) {
  console.log(
    `  ${r.status.padEnd(8)} ${r.is_approver ? 'APPROVER ' : '         '}${r.origin.padEnd(13)} ${r.email}` +
      `${r.display_name ? `  (${r.display_name})` : ''}  ← ${r.sources.join(' + ')}`,
  );
}

const esc = (v) => (v === null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
const statements = rows.map((r) => {
  const decided = r.status === 'approved' ? "datetime('now')" : 'NULL';
  const note = `seed 2026: ${r.sources.join(' + ')}`;
  return (
    `INSERT INTO estate_user (email, firebase_uid, display_name, status, is_approver, origin, note, decided_at)\n` +
    `  VALUES (${esc(r.email)}, ${esc(r.firebase_uid)}, ${esc(r.display_name)}, ${esc(r.status)}, ${r.is_approver ? 1 : 0}, ${esc(r.origin)}, ${esc(note)}, ${decided})\n` +
    `  ON CONFLICT(email) DO NOTHING;`
  );
});
// The one permitted change to an existing row: the approver UPGRADE.
for (const r of rows.filter((x) => x.is_approver)) {
  statements.push(`UPDATE estate_user SET is_approver = 1 WHERE email = ${esc(r.email)} AND is_approver = 0;`);
}

if (!commit) {
  console.log(`\nDRY RUN — nothing written. ${statements.length} statements ready; re-run with --commit --local|--remote.`);
  process.exit(0);
}

const sqlFile = join(tmpdir(), `seed-estate-${Date.now()}.sql`);
writeFileSync(sqlFile, statements.join('\n') + '\n', 'utf8');
const flag = targetRemote ? '--remote' : '--local';
console.log(`\ncommitting to ${flag} estate_auth…`);
const out = sh(AUTH_WORKER_DIR, 'npx', ['wrangler', 'd1', 'execute', 'estate_auth', flag, '--json', '--file', sqlFile]);
rmSync(sqlFile, { force: true });
const jsonStart = out.indexOf('[');
const results = JSON.parse(out.slice(jsonStart));
const failed = results.filter((r) => r.success !== true).length;
if (failed > 0) {
  console.error(`⚠️ ${failed} of ${results.length} statements did NOT report success — read the wrangler output above.`);
  process.exit(1);
}
// No per-row change counts: local D1's JSON meta omits `changes`, and a
// number invented from its absence would be a lie. Idempotency is ON
// CONFLICT DO NOTHING; verify by reading the rows, as the dry run prints them.
console.log(`done: ${results.length} statements executed, all reported success.`);
