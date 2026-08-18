#!/usr/bin/env node
/**
 * Reorder a `wrangler d1 export` dump so it actually replays.
 * (docs/access/RECOVERY.md §3b is the runbook; this is the tool it calls.)
 *
 * ## The bug this exists for — MEASURED 2026-08-17, not theorised
 *
 * `wrangler d1 export` emits statements in table order, interleaving
 * `CREATE TABLE` with that table's `INSERT`s. Table order is not dependency
 * order, so a table whose rows are inserted before a table its FOREIGN KEY
 * points at has not been created yet — and SQLite raises
 *
 *     no such table: main.<referenced-table>          (SQLITE_ERROR)
 *
 * partway through the import, leaving a HALF-POPULATED database that looks
 * for all the world like it imported. The restore drill hit this on the
 * newest snapshot of two of the estate's four databases, reproduced in two
 * independent SQLite engines:
 *
 *   library-catalog     wrangler --local: "no such table: main.edition"
 *                       node:sqlite:      "no such table: main.edition"
 *                       (stopped after 5 of 27 tables)
 *   board-game-catalog  wrangler --local: "no such table: main.app_user"
 *                       node:sqlite:      "FOREIGN KEY constraint failed"
 *                       (stopped after 2 of 18 tables)
 *
 * `estate_auth` and `index_catalog` replay fine — which is exactly why this
 * went unnoticed: the two small databases anyone would test with are the two
 * that work.
 *
 * ⚠️ `PRAGMA foreign_keys=OFF` does NOT fix it through wrangler. Prepending it
 * to both dumps was tried on the drill and both failed identically — D1's API
 * does not honour that pragma. The `PRAGMA defer_foreign_keys=TRUE` the dump
 * emits itself does not help either: deferring a constraint CHECK cannot
 * conjure a table that does not exist yet.
 *
 * ## What it does
 *
 * Splits the dump into statements (respecting single-quoted string literals,
 * including SQLite's doubled-quote escape) and re-emits them as:
 *
 *   1. PRAGMAs            (kept first, in order)
 *   2. every CREATE TABLE (so no INSERT can reference a missing table)
 *   3. every INSERT
 *   4. everything else    (CREATE INDEX / TRIGGER / VIEW — after the data,
 *                          which is also faster to build)
 *
 * No statement is rewritten, dropped or deduplicated; only reordered.
 *
 * Verified on the drill: after reordering, both failing dumps imported clean
 * (rc=0) through `wrangler d1 execute --local --file=`, and a node:sqlite load
 * of the same files reported `PRAGMA integrity_check` = ok with ZERO
 * `foreign_key_check` violations and full row counts (library-catalog 3,649
 * rows / 26 tables; board-game-catalog 5,870 rows / 17 tables).
 *
 * ## Usage
 *
 *   node scripts/reorder-d1-dump.mjs ./library-catalog.sql ./library-catalog.ordered.sql
 *
 * Prints a one-line JSON summary (statement counts by bucket) so a caller can
 * see it parsed something sane rather than silently emitting one huge
 * statement — a zero or one statement count means the splitter was defeated
 * and the output must not be trusted.
 */

import { readFileSync, writeFileSync } from 'node:fs';

const [inPath, outPath] = process.argv.slice(2);
if (!inPath || !outPath) {
  console.error('Usage: node scripts/reorder-d1-dump.mjs <in.sql> <out.sql>');
  process.exit(2);
}

const sql = readFileSync(inPath, 'utf8');

// Statement splitter that respects single-quoted string literals. SQLite
// escapes an embedded quote by doubling it, which this handles naturally:
// the closing quote flips `inStr` out and the immediately following quote
// flips it straight back in, so `'it''s'` stays one literal.
const stmts = [];
let buf = '';
let inStr = false;
for (let i = 0; i < sql.length; i++) {
  const ch = sql[i];
  buf += ch;
  if (ch === "'") inStr = !inStr;
  else if (ch === ';' && !inStr) {
    const s = buf.trim();
    if (s) stmts.push(s);
    buf = '';
  }
}
if (buf.trim()) stmts.push(buf.trim());

if (stmts.length < 2) {
  console.error(
    `Split ${inPath} into ${stmts.length} statement(s) — that cannot be right for a D1 export. ` +
      'Refusing to write an output that would look reordered and be one blob.',
  );
  process.exit(1);
}

const pragmas = [];
const tables = [];
const inserts = [];
const rest = [];

for (const s of stmts) {
  if (/^PRAGMA\b/i.test(s)) pragmas.push(s);
  else if (/^CREATE\s+TABLE\b/i.test(s)) tables.push(s);
  else if (/^INSERT\s+INTO\b/i.test(s)) inserts.push(s);
  else rest.push(s);
}

if (tables.length === 0) {
  console.error(`No CREATE TABLE statements found in ${inPath} — wrong file, or the split failed.`);
  process.exit(1);
}

writeFileSync(outPath, [...pragmas, ...tables, ...inserts, ...rest].join('\n') + '\n');

console.log(
  JSON.stringify({
    in: inPath,
    out: outPath,
    statements: stmts.length,
    pragmas: pragmas.length,
    create_table: tables.length,
    inserts: inserts.length,
    other_ddl: rest.length,
  }),
);
