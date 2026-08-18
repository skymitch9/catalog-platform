/**
 * The regression test for the restore drill's hole #1
 * (docs/access/RECOVERY.md §3b): a `wrangler d1 export` dump whose
 * CREATE/INSERT interleave puts an INSERT before the table its FOREIGN KEY
 * references. The raw dump must FAIL to replay; the reordered one must replay
 * clean, with every row present and zero foreign-key violations.
 *
 * The fixture reproduces the drill's exact failing pattern from
 * `library-catalog`: `copy` is created and populated first, and its rows
 * reference `edition`, which the dump does not create until later —
 * `no such table: main.edition`, after which the import dies leaving a
 * half-populated database that looks imported.
 *
 * ⚠️ Replay is exercised, not reasoned about — the whole reason this hole
 * survived is that the two small databases anyone would test with are the two
 * that replay fine. `node:sqlite` is one of the two engines the drill used.
 *
 * ⚠️ `enableForeignKeyConstraints: false` on the reordered load is deliberate
 * and is documented in RECOVERY.md §3b: reordering fixes the `no such table`
 * error, but the dump still inserts child rows before parent rows.
 * D1/miniflare does not enforce FKs at insert time so the reordered dump loads
 * clean THERE; `node:sqlite`'s DatabaseSync enforces them by default, so a
 * plain read of a dump needs the flag. The `foreign_key_check` assertion below
 * is what proves the ordering is a load-time artefact and not corrupt data.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { splitStatements, reorderStatements, summarizeEstateAuth, estateAuthWarning, splitTopLevel, createTableColumns } from '../lib/d1-dump.mjs';

/**
 * The drill's failing shape: table order, not dependency order.
 * `copy` (with a FK to `edition`) comes first and is populated immediately.
 */
const INTERLEAVED_DUMP = `PRAGMA defer_foreign_keys=TRUE;
CREATE TABLE copy (
  id INTEGER PRIMARY KEY,
  edition_id INTEGER NOT NULL REFERENCES edition(id),
  location TEXT
);
INSERT INTO copy VALUES(1,1,'shelf A');
INSERT INTO copy VALUES(2,2,'shelf B — it''s the one by the window');
CREATE TABLE edition (
  id INTEGER PRIMARY KEY,
  work_id INTEGER NOT NULL REFERENCES work(id),
  isbn TEXT
);
INSERT INTO edition VALUES(1,1,'9780000000001');
INSERT INTO edition VALUES(2,1,'9780000000002');
CREATE TABLE work (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL
);
INSERT INTO work VALUES(1,'A book; with a semicolon in the title');
CREATE INDEX idx_copy_edition ON copy(edition_id);
CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY, name TEXT);
INSERT INTO d1_migrations VALUES(1,'0001_init.sql');
`;

function loadInto(sql, { foreignKeys }) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: foreignKeys });
  try {
    db.exec(sql);
    return { db, error: null };
  } catch (err) {
    return { db, error: err };
  }
}

test('the raw interleaved dump FAILS to replay — the drill\'s measured bug', () => {
  // FK enforcement ON is what surfaces it: SQLite happily accepts a
  // `REFERENCES edition(id)` clause against a table that does not exist yet
  // (FK targets resolve lazily), and only reports `no such table: main.edition`
  // when an INSERT makes it actually go looking. That is the drill's exact
  // error, in one of the drill's two engines.
  const { db, error } = loadInto(INTERLEAVED_DUMP, { foreignKeys: true });
  assert.ok(error, 'the raw dump replayed clean — the fixture no longer reproduces the bug');
  assert.match(String(error.message), /no such table: (main\.)?edition/);

  // ⚠️ The half-populated-but-looks-imported part: `copy` exists and is empty
  // of the rows the dump meant to put there, and the later tables never
  // arrived at all. This is what a restore would have silently left behind.
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all()
    .map((r) => r.name);
  assert.deepEqual(tables, ['copy'], 'only the first table was created before the import died');
  db.close();
});

test('the reordered dump replays clean, with every row and zero FK violations', () => {
  const stmts = splitStatements(INTERLEAVED_DUMP);
  const { ordered, pragmas, tables, inserts, rest } = reorderStatements(stmts);

  // Every CREATE TABLE precedes every INSERT — the property that fixes it.
  const sql = ordered.join('\n') + '\n';
  const lastCreate = ordered.findLastIndex((s) => /^CREATE\s+TABLE\b/i.test(s));
  const firstInsert = ordered.findIndex((s) => /^INSERT\s+INTO\b/i.test(s));
  assert.ok(lastCreate < firstInsert, 'a CREATE TABLE still follows an INSERT');
  assert.equal(pragmas.length, 1);
  assert.equal(tables.length, 4);
  assert.equal(inserts.length, 6);
  assert.equal(rest.length, 1, 'the CREATE INDEX lands in the trailing DDL bucket');

  // Nothing was rewritten, dropped or deduplicated — only reordered.
  assert.equal(ordered.length, stmts.length);
  assert.deepEqual([...ordered].sort(), [...stmts].sort());

  const { db, error } = loadInto(sql, { foreignKeys: false });
  assert.equal(error, null, `reordered dump failed to replay: ${error?.message}`);

  assert.equal(db.prepare('SELECT count(*) AS n FROM copy').get().n, 2);
  assert.equal(db.prepare('SELECT count(*) AS n FROM edition').get().n, 2);
  assert.equal(db.prepare('SELECT count(*) AS n FROM work').get().n, 1);
  assert.equal(db.prepare('SELECT count(*) AS n FROM d1_migrations').get().n, 1);

  // The doubled-quote escape and the semicolon inside a literal both survived
  // the splitter — the two ways a naive `split(';')` corrupts a dump.
  assert.equal(db.prepare('SELECT location FROM copy WHERE id=2').get().location, "shelf B — it's the one by the window");
  assert.equal(db.prepare('SELECT title FROM work WHERE id=1').get().title, 'A book; with a semicolon in the title');

  // The ordering is a load-time artefact, not corrupt data (RECOVERY.md §3b).
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  db.close();
});

test('RECOVERY.md §3b\'s nuance holds: reordered still needs FK enforcement OFF', () => {
  // Reordering fixes `no such table`; it does NOT reorder child rows after
  // parent rows. D1/miniflare does not enforce FKs at insert time so the
  // reordered dump loads clean THERE (the drill proved that end to end), but a
  // plain SQLite with enforcement ON — node:sqlite's default — stops at the
  // constraint. Pinned so nobody "simplifies" the flag out of the runbook.
  const sql = reorderStatements(splitStatements(INTERLEAVED_DUMP)).ordered.join('\n') + '\n';
  const { db, error } = loadInto(sql, { foreignKeys: true });
  assert.ok(error, 'expected a FOREIGN KEY failure with enforcement on');
  assert.match(String(error.message), /FOREIGN KEY constraint failed/i);
  db.close();
});

test('reordering is idempotent', () => {
  const once = reorderStatements(splitStatements(INTERLEAVED_DUMP)).ordered;
  const twice = reorderStatements(splitStatements(once.join('\n') + '\n')).ordered;
  assert.deepEqual(twice, once);
});

test('the statement splitter is not defeated by quotes or semicolons', () => {
  assert.deepEqual(splitStatements("SELECT 1; SELECT ';'; SELECT 'it''s;';"), [
    'SELECT 1;',
    "SELECT ';';",
    "SELECT 'it''s;';",
  ]);
  assert.deepEqual(splitTopLevel("1,'a,b',NULL,(2,3)"), ['1', "'a,b'", 'NULL', '(2,3)']);
});

// ---------------------------------------------------------------------------
// The estate_auth restore trap — RECOVERY.md §3d
// ---------------------------------------------------------------------------

const ESTATE_AUTH_DUMP = `PRAGMA defer_foreign_keys=TRUE;
CREATE TABLE estate_user (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','revoked')),
  is_approver INTEGER NOT NULL DEFAULT 0,
  origin TEXT NOT NULL,
  is_devops INTEGER NOT NULL DEFAULT 0
);
INSERT INTO estate_user VALUES(1,'a@example.test','approved',1,'seed:admin',1);
INSERT INTO estate_user VALUES(2,'b@example.test','approved',1,'seed:library',1);
INSERT INTO estate_user VALUES(3,'c@example.test','approved',0,'seen:library',1);
INSERT INTO estate_user VALUES(4,'d@example.test','pending',0,'seen:games',0);
INSERT INTO estate_user VALUES(5,'e@example.test','revoked',0,'manual',0);
`;

test('an estate_auth dump is detected and its membership counted from the backup', () => {
  const summary = summarizeEstateAuth(splitStatements(ESTATE_AUTH_DUMP));
  assert.ok(summary, 'estate_user table was not detected');
  assert.equal(summary.parsed, true);
  assert.equal(summary.rows, 5);
  assert.deepEqual(summary.byStatus, { approved: 3, pending: 1, revoked: 1 });
  assert.equal(summary.approvers, 2);
  assert.equal(summary.devops, 3);
  assert.equal(summary.unparsed, 0);
});

test('the §3d warning states the backup counts and never leaks a name', () => {
  const summary = summarizeEstateAuth(splitStatements(ESTATE_AUTH_DUMP));
  const text = estateAuthWarning(summary);

  assert.match(text, /SECURITY EVENT/);
  assert.match(text, /approved\s*:\s*3/);
  assert.match(text, /revoked\s*:\s*1/);
  assert.match(text, /is_approver = 1\s*:\s*2/);
  assert.match(text, /is_devops\s*=\s*1\s*:\s*3/);
  assert.match(text, /re-revoked by hand/);
  assert.match(text, /RECOVERY\.md §3d/);

  // ⚠️ Counts only — this string goes to terminals and CI logs on a PUBLIC repo.
  assert.doesNotMatch(text, /@example\.test/);
  assert.doesNotMatch(text, /example/i);
});

test('a non-estate_auth dump triggers no membership warning at all', () => {
  assert.equal(summarizeEstateAuth(splitStatements(INTERLEAVED_DUMP)), null);
});

test('an explicit INSERT column list is honoured over CREATE TABLE order', () => {
  const dump = `CREATE TABLE estate_user (id INTEGER PRIMARY KEY, email TEXT, status TEXT, is_approver INTEGER, is_devops INTEGER);
INSERT INTO "main"."estate_user" (is_devops,status,id,is_approver,email) VALUES(1,'revoked',9,0,'x@example.test');
`;
  const summary = summarizeEstateAuth(splitStatements(dump));
  assert.deepEqual(summary.byStatus, { revoked: 1 });
  assert.equal(summary.devops, 1);
  assert.equal(summary.approvers, 0);
});

test('unparseable estate_user rows are reported, never counted as zero', () => {
  const dump = `CREATE TABLE estate_user (id INTEGER PRIMARY KEY, email TEXT, status TEXT);
INSERT INTO estate_user SELECT * FROM somewhere_else;
`;
  const summary = summarizeEstateAuth(splitStatements(dump));
  assert.equal(summary.parsed, false);
  assert.equal(summary.unparsed, 1);
  const text = estateAuthWarning(summary);
  assert.match(text, /Could not parse/);
  assert.match(text, /silent zero/);
});

test('createTableColumns skips table-level constraints', () => {
  const cols = createTableColumns(
    'CREATE TABLE t (a INTEGER, b TEXT DEFAULT (1,2), CONSTRAINT c CHECK (a > 0), UNIQUE (a, b), FOREIGN KEY (a) REFERENCES u(id))',
  );
  assert.deepEqual(cols, ['a', 'b']);
});
