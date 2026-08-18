/**
 * `wrangler d1 export` dump surgery — the parsing half of
 * `scripts/reorder-d1-dump.mjs`, split out so it can be unit-tested against
 * the exact failure the restore drill measured (docs/access/RECOVERY.md §3b)
 * without shelling out to the CLI.
 *
 * Two jobs, both born from the 2026-08-17/18 restore drill:
 *
 *   1. `reorderStatements` — the fix for hole #1. `wrangler d1 export`
 *      interleaves `CREATE TABLE` with that table's `INSERT`s in TABLE order,
 *      which is not DEPENDENCY order, so an INSERT can reference a table the
 *      dump has not created yet. SQLite raises `no such table: main.<x>` and
 *      the import dies partway, leaving a half-populated database that looks
 *      imported. Measured on two of the estate's four databases, in two
 *      independent SQLite engines.
 *
 *   2. `summarizeEstateAuth` — the visibility fix for hole #3. An
 *      `estate_auth` restore is a SECURITY event, not a data event: the
 *      drill's 2026-08-16 backup held 12 approved / 0 revoked while live held
 *      11 approved / 1 revoked. Both `estate_user` row counts are 12, so a
 *      count-based sanity check passes and a blind restore silently
 *      re-approves a revoked member. This reads those counts OUT OF THE DUMP
 *      so the restore path can print them and make the trap visible.
 *      ⚠️ Counts only — never an email, never a row. Public repo.
 */

/**
 * Split a dump into statements, respecting single-quoted string literals.
 * SQLite escapes an embedded quote by doubling it, which this handles
 * naturally: the closing quote flips `inStr` out and the immediately following
 * quote flips it straight back in, so `'it''s'` stays one literal.
 */
export function splitStatements(sql) {
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
  return stmts;
}

/**
 * Bucket statements into replay order:
 *
 *   1. PRAGMAs            (kept first, in order)
 *   2. every CREATE TABLE (so no INSERT can reference a missing table)
 *   3. every INSERT
 *   4. everything else    (CREATE INDEX / TRIGGER / VIEW — after the data,
 *                          which is also faster to build)
 *
 * No statement is rewritten, dropped or deduplicated; only reordered.
 */
export function reorderStatements(stmts) {
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
  return { pragmas, tables, inserts, rest, ordered: [...pragmas, ...tables, ...inserts, ...rest] };
}

// ---------------------------------------------------------------------------
// estate_auth preflight — RECOVERY.md §3d
// ---------------------------------------------------------------------------

/** Strip SQLite's identifier quoting and any `main.` / `"main".` qualifier. */
function bareIdentifier(raw) {
  let s = raw.trim();
  const unquote = (t) =>
    (t.startsWith('"') && t.endsWith('"')) || (t.startsWith('`') && t.endsWith('`'))
      ? t.slice(1, -1)
      : t.startsWith('[') && t.endsWith(']')
        ? t.slice(1, -1)
        : t;
  // Split on the LAST dot outside quotes — `"main"."estate_user"` -> estate_user
  const parts = s.match(/(?:"[^"]*"|`[^`]*`|\[[^\]]*\]|[^.\s]+)/g) ?? [s];
  return unquote(parts[parts.length - 1]);
}

/** Column names out of a `CREATE TABLE x (...)` statement, in order. */
export function createTableColumns(stmt) {
  const open = stmt.indexOf('(');
  if (open < 0) return null;
  const body = stmt.slice(open + 1, stmt.lastIndexOf(')'));
  const cols = [];
  for (const part of splitTopLevel(body)) {
    const t = part.trim();
    if (!t) continue;
    // Skip table-level constraints — they are not columns.
    if (/^(CONSTRAINT|PRIMARY\s+KEY|UNIQUE|CHECK|FOREIGN\s+KEY)\b/i.test(t)) continue;
    const name = t.match(/^("[^"]*"|`[^`]*`|\[[^\]]*\]|[A-Za-z_][A-Za-z0-9_$]*)/);
    if (name) cols.push(bareIdentifier(name[1]));
  }
  return cols;
}

/**
 * Split a parenthesised list on commas that are at depth 0 and outside a
 * single-quoted literal. Used for both column definitions and VALUES tuples.
 */
export function splitTopLevel(text) {
  const out = [];
  let buf = '';
  let depth = 0;
  let inStr = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      buf += ch;
      if (ch === "'") inStr = false;
      continue;
    }
    if (ch === "'") {
      inStr = true;
      buf += ch;
    } else if (ch === '(') {
      depth++;
      buf += ch;
    } else if (ch === ')') {
      depth--;
      buf += ch;
    } else if (ch === ',' && depth === 0) {
      out.push(buf);
      buf = '';
    } else {
      buf += ch;
    }
  }
  out.push(buf);
  return out;
}

/** The literal value of one VALUES item: `'approved'` -> approved, `0` -> 0. */
function literalValue(raw) {
  const t = raw.trim();
  if (t.startsWith("'") && t.endsWith("'") && t.length >= 2) return t.slice(1, -1).replace(/''/g, "'");
  if (/^NULL$/i.test(t)) return null;
  return t;
}

/**
 * Read the membership shape out of an `estate_auth` dump — statuses and the
 * two authority flags, COUNTS ONLY.
 *
 * Returns `null` when the dump has no `estate_user` table at all (i.e. this is
 * not an estate_auth export, so there is no trap to warn about). Returns
 * `{ parsed: false }` when the table IS there but the rows could not be parsed
 * confidently — that is reported as "verify by hand", never as zero, because a
 * silent zero is exactly the failure mode §3d is about.
 */
export function summarizeEstateAuth(stmts) {
  const create = stmts.find(
    (s) => /^CREATE\s+TABLE\b/i.test(s) && /\bestate_user\b/i.test(s.slice(0, s.indexOf('(') + 1)),
  );
  if (!create) return null;

  const columns = createTableColumns(create);
  const iStatus = columns ? columns.indexOf('status') : -1;
  const iApprover = columns ? columns.indexOf('is_approver') : -1;
  const iDevops = columns ? columns.indexOf('is_devops') : -1;

  const rows = [];
  let unparsed = 0;
  for (const s of stmts) {
    if (!/^INSERT\s+INTO\b/i.test(s)) continue;
    // The target table first, on its own — a dotted/quoted qualifier
    // (`"main"."estate_user"`) is one name in several tokens.
    const target = s.match(/^INSERT\s+(?:OR\s+\w+\s+)?INTO\s+((?:"[^"]*"|`[^`]*`|\[[^\]]*\]|[A-Za-z_][A-Za-z0-9_$]*)(?:\s*\.\s*(?:"[^"]*"|`[^`]*`|\[[^\]]*\]|[A-Za-z_][A-Za-z0-9_$]*))*)/i);
    if (!target || bareIdentifier(target[1]) !== 'estate_user') continue;

    // Only the `(cols) VALUES (...)` / `VALUES (...)` form is parseable here.
    // ⚠️ Anything else (INSERT ... SELECT, a multi-row VALUES tuple list) is
    // counted as UNPARSED, never skipped — §3d is about a silent zero.
    const head = s
      .slice(target[0].length)
      .match(/^\s*(\([^)]*\))?\s*VALUES\s*/i);
    if (!head) {
      unparsed++;
      continue;
    }

    // An explicit column list on the INSERT wins over the CREATE TABLE order.
    const explicit = head[1] ? splitTopLevel(head[1].slice(1, -1)).map((c) => bareIdentifier(c)) : null;
    const after = s.slice(target[0].length + head[0].length).trim().replace(/;$/, '').trim();
    if (!after.startsWith('(') || !after.endsWith(')')) {
      unparsed++;
      continue;
    }
    const values = splitTopLevel(after.slice(1, -1)).map(literalValue);
    const names = explicit ?? columns;
    if (!names || values.length !== names.length) {
      unparsed++;
      continue;
    }
    const si = explicit ? explicit.indexOf('status') : iStatus;
    const ai = explicit ? explicit.indexOf('is_approver') : iApprover;
    const di = explicit ? explicit.indexOf('is_devops') : iDevops;
    rows.push({
      status: si >= 0 ? values[si] : null,
      approver: ai >= 0 ? String(values[ai]) === '1' : false,
      devops: di >= 0 ? String(values[di]) === '1' : false,
    });
  }

  if (rows.length === 0 && unparsed === 0) {
    // Table present, zero INSERTs: a genuinely empty directory export.
    return { parsed: true, rows: 0, byStatus: {}, approvers: 0, devops: 0, unparsed: 0 };
  }
  if (unparsed > 0 && rows.length === 0) {
    return { parsed: false, rows: 0, byStatus: {}, approvers: 0, devops: 0, unparsed };
  }

  const byStatus = {};
  let approvers = 0;
  let devops = 0;
  for (const r of rows) {
    const key = r.status ?? '(unknown)';
    byStatus[key] = (byStatus[key] ?? 0) + 1;
    if (r.approver) approvers++;
    if (r.devops) devops++;
  }
  return { parsed: unparsed === 0, rows: rows.length, byStatus, approvers, devops, unparsed };
}

/**
 * The worded warning printed before ANY estate_auth restore. It is prose, not
 * a status line, because §3d is a judgement a human has to make: the counts
 * below describe the BACKUP, and only the operator knows whether they still
 * match what the estate intends today.
 *
 * ⚠️ Counts only. No email, no display name, no row — this string is printed
 * to CI logs and terminals on a public repo.
 */
export function estateAuthWarning(summary) {
  const lines = [
    '',
    '='.repeat(72),
    '⚠️  THIS IS AN estate_auth DUMP — RESTORING IT IS A SECURITY EVENT',
    '='.repeat(72),
    '',
  ];

  if (!summary.parsed && summary.rows === 0) {
    lines.push(
      `Could not parse the ${summary.unparsed} estate_user INSERT statement(s) in this dump.`,
      'That is reported rather than treated as zero — a silent zero here is exactly the',
      'failure this warning exists to prevent. Read the counts out of the dump by hand',
      'before importing.',
      '',
    );
  } else {
    const statuses = Object.keys(summary.byStatus).sort();
    lines.push('WHAT THIS BACKUP SAYS THE MEMBERSHIP WAS, at the moment it was taken:', '');
    lines.push(`  estate_user rows : ${summary.rows}`);
    for (const s of statuses) lines.push(`  ${s.padEnd(17)}: ${summary.byStatus[s]}`);
    lines.push(`  is_approver = 1  : ${summary.approvers}`);
    lines.push(`  is_devops   = 1  : ${summary.devops}`);
    if (summary.unparsed > 0) {
      lines.push('', `  ⚠️ ${summary.unparsed} INSERT(s) could not be parsed and are NOT in the counts above.`);
    }
    lines.push('');
  }

  lines.push(
    'MEASURED ON THE RESTORE DRILL (2026-08-17/18), and this is not hypothetical:',
    'the 2026-08-16 backup held 12 approved / 0 revoked; live held 11 approved and',
    '1 REVOKED. Both estate_user row counts were 12 — so a count-based check passes,',
    'and a blind restore of that backup silently RE-APPROVES a member who has since',
    'been revoked. Revocation and post-seed authority live in this database and',
    'nowhere else; nothing else in the estate can tell you they were lost.',
    '',
    'BEFORE YOU IMPORT — capture the CURRENT state, which is what the restore will',
    'overwrite (RECOVERY.md §3d):',
    '',
    '  npx wrangler d1 execute <estate_auth-database-id> --remote --command \\',
    '    "SELECT id, status, is_approver, is_devops FROM estate_user ORDER BY id;"',
    '',
    'Compare it against the counts above. Anyone REVOKED today who is not revoked in',
    'the backup must be re-revoked by hand after the import, and every approver/devops',
    'flag re-checked. A restore is a human act: this tool cannot make that judgement',
    'for you and does not try.',
    '',
    '='.repeat(72),
    '',
  );
  return lines.join('\n');
}
