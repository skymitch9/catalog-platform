#!/usr/bin/env node
/**
 * Reorder a `wrangler d1 export` dump so it actually replays.
 * (docs/access/RECOVERY.md §3b is the runbook; this is the tool it calls, and
 * docs/access/backup-restore.md §4b is the restore recipe it belongs to.)
 *
 * ⚠️ THIS IS A MANDATORY STEP OF THE D1 RESTORE PATH, not an optional tidy-up.
 * Two of the estate's four exports do not replay without it.
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
 * including SQLite's doubled-quote escape) and re-emits them as PRAGMAs →
 * every CREATE TABLE → every INSERT → everything else (indexes/triggers/
 * views). No statement is rewritten, dropped or deduplicated; only reordered.
 * The parsing lives in `scripts/lib/d1-dump.mjs` so it is unit-tested against
 * the drill's exact failing pattern — see
 * `scripts/test/reorder-d1-dump.test.mjs`.
 *
 * Verified on the drill: after reordering, both failing dumps imported clean
 * (rc=0) through `wrangler d1 execute --local --file=`, and a node:sqlite load
 * of the same files reported `PRAGMA integrity_check` = ok with ZERO
 * `foreign_key_check` violations and full row counts (library-catalog 3,649
 * rows / 26 tables; board-game-catalog 5,870 rows / 17 tables).
 *
 * ## ⚠️ It also refuses to let an estate_auth restore proceed blind
 *
 * When the dump contains an `estate_user` table, this prints the BACKUP's
 * approved/revoked/approver/devops counts and the §3d warning before writing
 * anything. Restoring `estate_auth` is a security event — the drill measured a
 * backup that would silently re-approve a revoked member while every row count
 * matched. Passing `--yes-i-checked-membership` acknowledges the warning and
 * suppresses the non-zero exit; without it the tool still WRITES the reordered
 * file (so nothing is blocked) but exits 3, so a script that chains straight
 * into an import stops and a human has to look.
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
import { splitStatements, reorderStatements, summarizeEstateAuth, estateAuthWarning } from './lib/d1-dump.mjs';

const argv = process.argv.slice(2);
const acknowledged = argv.includes('--yes-i-checked-membership');
const [inPath, outPath] = argv.filter((a) => !a.startsWith('--'));

if (!inPath || !outPath) {
  console.error('Usage: node scripts/reorder-d1-dump.mjs <in.sql> <out.sql> [--yes-i-checked-membership]');
  process.exit(2);
}

const sql = readFileSync(inPath, 'utf8');
const stmts = splitStatements(sql);

if (stmts.length < 2) {
  console.error(
    `Split ${inPath} into ${stmts.length} statement(s) — that cannot be right for a D1 export. ` +
      'Refusing to write an output that would look reordered and be one blob.',
  );
  process.exit(1);
}

const { pragmas, tables, inserts, rest, ordered } = reorderStatements(stmts);

if (tables.length === 0) {
  console.error(`No CREATE TABLE statements found in ${inPath} — wrong file, or the split failed.`);
  process.exit(1);
}

writeFileSync(outPath, ordered.join('\n') + '\n');

const estateAuth = summarizeEstateAuth(stmts);

console.log(
  JSON.stringify({
    in: inPath,
    out: outPath,
    statements: stmts.length,
    pragmas: pragmas.length,
    create_table: tables.length,
    inserts: inserts.length,
    other_ddl: rest.length,
    estate_auth: estateAuth
      ? { rows: estateAuth.rows, by_status: estateAuth.byStatus, approvers: estateAuth.approvers, devops: estateAuth.devops, parsed: estateAuth.parsed }
      : null,
  }),
);

if (estateAuth) {
  // stderr, so it is impossible to lose it by piping stdout's JSON somewhere.
  console.error(estateAuthWarning(estateAuth));
  if (!acknowledged) {
    console.error(
      'The reordered file WAS written — nothing is blocked. Exiting 3 so an automated\n' +
        'chain stops here and a human reads the block above. Re-run with\n' +
        '--yes-i-checked-membership once you have captured the CURRENT membership state.',
    );
    process.exit(3);
  }
}
