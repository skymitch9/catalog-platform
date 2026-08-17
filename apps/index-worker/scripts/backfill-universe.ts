/**
 * One-shot: re-run the UNIVERSE join over the rows already in D1, now that
 * `entry.series` holds the registry's CANONICAL spelling rather than whatever
 * each source pushed.
 *
 *   npx tsx scripts/backfill-universe.ts                 # remote, DRY RUN
 *   npx tsx scripts/backfill-universe.ts --apply         # remote, writes
 *   npx tsx scripts/backfill-universe.ts --local --apply # the wrangler dev DB
 *
 * ⚠️ DRY RUN BY DEFAULT and it prints the SQL it would run — the same house
 * rule `backfill-series.ts` and `scripts/restore-firestore.mjs` follow.
 *
 * ⚠️ It calls the SAME `universeFor` the push route calls (via the same
 * `data/universes.json`), not a second implementation of the lookup. A
 * backfill that resolved differently from the push would be undone by the next
 * snapshot — design §1's whole failure class.
 *
 * ⚠️ STRICTLY ADDITIVE, exactly like the push-time re-point in
 * `src/push.ts`'s `applySeriesPlan`: it only fills rows whose `universe` is
 * NULL, and never rewrites or clears one that is already set. A row whose
 * stored universe DISAGREES with today's lookup is REPORTED, not changed —
 * that means `data/universes.json` was edited since that row was last pushed
 * (design §9 Q2 accepted exactly that lag), and the honest fix is a re-push of
 * that source, not a rewrite from here.
 *
 * ⚠️ WHY THE COUNT IS NOT "gained_from_canonical". D1 no longer holds the raw
 * pushed spelling — the series backfill rewrote it — so this script cannot
 * separate "gains because the join now reads the canonical spelling" from
 * "gains because the list changed". The push response's `universe` block is
 * the measurement that CAN make that split, per push. What this script
 * measures is the before/after of the estate as it stands.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildUniverseIndex, universeFor, type UniversesDocument } from '../src/universes.js';

const DB = 'index_catalog';
const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const LOCAL = args.includes('--local');
const WHERE = LOCAL ? '--local' : '--remote';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * ⚠️ wrangler is invoked as `node <wrangler.js>`, NOT `npx wrangler` — Node 20+
 * on Windows refuses to spawn a .cmd shim without `shell: true`, and a shell
 * would put SQL full of apostrophes through cmd.exe quoting. Same reasoning,
 * and the same walk-up resolution, as `backfill-series.ts`.
 */
const WRANGLER = findWrangler();

function findWrangler(): string {
  let dir = HERE;
  for (;;) {
    const candidate = join(dir, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
    if (existsSync(candidate)) return candidate;
    const up = dirname(dir);
    if (up === dir) throw new Error('wrangler/bin/wrangler.js not found — run `npm install` at the repo root');
    dir = up;
  }
}

function wrangler(extra: string[]): string {
  return execFileSync(process.execPath, [WRANGLER, 'd1', 'execute', DB, WHERE, ...extra], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

function d1<T>(sql: string): T[] {
  const out = wrangler(['--json', '--command', sql]);
  const start = out.indexOf('[');
  if (start < 0) throw new Error(`no JSON in wrangler output:\n${out}`);
  const parsed = JSON.parse(out.slice(start)) as { results: T[] }[];
  return parsed[0]?.results ?? [];
}

const q = (v: string) => `'${v.replace(/'/g, "''")}'`;

// The list is READ, never imported with an assertion — tsx runs this file as
// plain Node, and `with { type: 'json' }` is the Worker bundler's affordance.
const document = JSON.parse(
  readFileSync(join(HERE, '..', '..', '..', 'data', 'universes.json'), 'utf8'),
) as UniversesDocument;
const index = buildUniverseIndex(document);

interface Row {
  source: string;
  source_id: string;
  title: string;
  series: string | null;
  universe: string | null;
}

console.log(`Reading ${WHERE} ${DB}...`);
const rows = d1<Row>('SELECT source, source_id, title, series, universe FROM entry');

const beforeWithUniverse = rows.filter((r) => r.universe !== null && r.universe !== '').length;

const gains = new Map<string, { source: string; universe: string; ids: string[] }>();
const disagreements: { source: string; title: string; series: string | null; stored: string; now: string }[] = [];
let unchanged = 0;

for (const row of rows) {
  const now = universeFor(index, { title: row.title, series: row.series });
  const stored = row.universe === '' ? null : row.universe;

  if (stored === null && now !== null) {
    // ⚠️ Keyed on a TAB: universe names contain spaces ("The Cosmere"),
    // and the value carries the pair anyway, so the key is never parsed back.
    const key = `${row.source}	${now}`;
    const bucket = gains.get(key);
    if (bucket) bucket.ids.push(row.source_id);
    else gains.set(key, { source: row.source, universe: now, ids: [row.source_id] });
  } else if (stored !== null && now !== null && stored !== now) {
    disagreements.push({ source: row.source, title: row.title, series: row.series, stored, now });
  } else {
    unchanged += 1;
  }
}

const gained = [...gains.values()].reduce((n, g) => n + g.ids.length, 0);

// One UPDATE per (source, universe) pair, keyed by source_id — the primary key
// pair, so no row is touched twice and no title-matching is involved.
const statements = [...gains.values()].map((g) => {
  return `UPDATE entry SET universe = ${q(g.universe)} WHERE source = ${q(g.source)} AND source_id IN (${g.ids.map(q).join(', ')});`;
});

console.log('');
console.log(`  rows in the index ............. ${rows.length}`);
console.log(`  carrying a universe BEFORE .... ${beforeWithUniverse}`);
console.log(`  would GAIN one ................ ${gained}`);
console.log(`  carrying a universe AFTER ..... ${beforeWithUniverse + gained}`);
console.log(`  unchanged ..................... ${unchanged}`);
console.log(`  ⚠️ stored ≠ today's lookup ..... ${disagreements.length}  (reported only — never rewritten)`);
for (const d of disagreements.slice(0, 10)) {
  console.log(`      ! ${d.source}: "${d.title}" [${d.series ?? 'no series'}] stored ${d.stored}, lookup says ${d.now}`);
}
console.log(`  SQL statements ................ ${statements.length}`);
console.log('');

if (statements.length === 0) {
  console.log('Nothing to do — every row already carries the universe the list gives it.');
  process.exit(0);
}

if (!APPLY) {
  console.log('DRY RUN - nothing was written. The SQL, in full:');
  console.log('');
  for (const s of statements) console.log(`  ${s}`);
  console.log('');
  console.log('Re-run with --apply to execute it.');
  process.exit(0);
}

const file = join(mkdtempSync(join(tmpdir(), 'universe-backfill-')), 'backfill.sql');
writeFileSync(file, `${statements.join('\n')}\n`, 'utf8');
console.log(`Applying ${statements.length} statements from ${file} ...`);
console.log(wrangler(['--file', file, '--yes']));
console.log("Done. Verify: SELECT universe, COUNT(*) FROM entry WHERE universe IS NOT NULL GROUP BY universe;");
