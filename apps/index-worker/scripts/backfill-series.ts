/**
 * One-shot: fold every EXISTING `entry.series` through the registry resolver,
 * so the registry reflects the data already in D1 rather than only what has
 * been pushed since migration 0004.
 *
 *   npx tsx scripts/backfill-series.ts                 # remote, DRY RUN
 *   npx tsx scripts/backfill-series.ts --apply         # remote, writes
 *   npx tsx scripts/backfill-series.ts --local --apply # the wrangler dev DB
 *
 * ⚠️ DRY RUN BY DEFAULT, and it prints the SQL it would run — the house rule
 * every rewriting script in this estate follows (scripts/restore-firestore.mjs
 * is the precedent). Nothing here deletes a row, but it REWRITES display
 * strings, and a rewrite you did not read first is one you cannot review
 * afterwards.
 *
 * ⚠️ It calls the SAME `planSeries` the push route calls — not a second
 * implementation of the rules. That is the whole reason this is a tsx script
 * and not a .mjs one: a backfill that folded differently from the push would
 * re-create the drift on the next snapshot, which is exactly the class of bug
 * the two existing library-audiobook bridges are made of (design §1).
 *
 * It is IDEMPOTENT: every insert is OR IGNORE, every update is by value, and a
 * second run against unchanged data plans nothing.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { planSeries, type SeriesRegistry } from '../src/series.js';
import { seriesCanonIndex } from '../src/series-canon-data.js';

const DB = 'index_catalog';
const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const LOCAL = args.includes('--local');
const WHERE = LOCAL ? '--local' : '--remote';

/**
 * ⚠️ wrangler is invoked as `node <wrangler.js>`, NOT as `npx wrangler`. On
 * Windows, Node 20+ refuses to spawn a .cmd shim without `shell: true`
 * (EINVAL), and turning the shell on would put SQL full of apostrophes through
 * cmd.exe quoting — the same class of mangling this repo already documents for
 * commit messages. Resolving the JS entry point sidesteps both.
 *
 * It is found by walking up to the workspace root rather than by `require
 * .resolve`, because wrangler's package `exports` map does not publish
 * `./bin/wrangler.js` — a resolve() call fails with ERR_PACKAGE_PATH_NOT_EXPORTED.
 */
const WRANGLER = findWrangler();

function findWrangler(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
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
  // wrangler prints a banner before the JSON; the payload starts at the array.
  const start = out.indexOf('[');
  if (start < 0) throw new Error(`no JSON in wrangler output:\n${out}`);
  const parsed = JSON.parse(out.slice(start)) as { results: T[] }[];
  return parsed[0]?.results ?? [];
}

const q = (v: string) => `'${v.replace(/'/g, "''")}'`;

interface EntryRow {
  source: string;
  title: string;
  series: string;
}

console.log(`Reading ${WHERE} ${DB}...`);
const rows = d1<EntryRow>(
  "SELECT source, title, series FROM entry WHERE series IS NOT NULL AND series != ''",
);
const existingSeries = d1<{ slug: string; display_name: string }>('SELECT slug, display_name FROM series');
const existingAliases = d1<{ alias_fold: string; slug: string }>('SELECT alias_fold, slug FROM series_alias');
const existingPending = d1<{ candidate_fold: string }>('SELECT candidate_fold FROM series_pending');

const registry: SeriesRegistry = {
  series: new Map(existingSeries.map((s) => [s.slug, { slug: s.slug, display_name: s.display_name }])),
  aliases: new Map(existingAliases.map((a) => [a.alias_fold, a.slug])),
  queued: new Set(existingPending.map((p) => p.candidate_fold)),
};

const distinctRaw = new Set(rows.map((r) => r.series)).size;
const plan = planSeries(registry, rows, seriesCanonIndex);
const now = new Date().toISOString();

// One UPDATE per target: every raw spelling that resolved to it, by value.
const byTarget = new Map<string, { slug: string; display: string; raws: string[] }>();
for (const [raw, res] of plan.resolutions) {
  if (!res) continue;
  const key = `${res.slug} ${res.display}`;
  const bucket = byTarget.get(key);
  if (bucket) bucket.raws.push(raw);
  else byTarget.set(key, { slug: res.slug, display: res.display, raws: [raw] });
}

const statements: string[] = [
  ...plan.newSeries.map(
    (s) =>
      `INSERT OR IGNORE INTO series (slug, display_name, first_source, created_at) VALUES (${q(s.slug)}, ${q(s.display_name)}, ${q(s.first_source)}, ${q(now)});`,
  ),
  ...plan.newAliases.map(
    (a) =>
      `INSERT OR IGNORE INTO series_alias (alias_fold, slug, alias_display, decided_how, created_at) VALUES (${q(a.alias_fold)}, ${q(a.slug)}, ${q(a.alias_display)}, ${q(a.decided_how)}, ${q(now)});`,
  ),
  ...plan.newPending.map(
    (p) =>
      `INSERT OR IGNORE INTO series_pending (candidate_fold, candidate_display, candidate_slug, closest_slug, closest_display, near_key, sample_titles, sources, created_at) VALUES (${q(p.candidate_fold)}, ${q(p.candidate_display)}, ${q(p.candidate_slug)}, ${q(p.closest_slug)}, ${q(p.closest_display)}, ${q(p.near_key)}, ${q(JSON.stringify(p.sample_titles))}, ${q(JSON.stringify(p.sources))}, ${q(now)});`,
  ),
  ...[...byTarget.values()].map(
    (v) =>
      `UPDATE entry SET series_slug = ${q(v.slug)}, series = ${q(v.display)} WHERE series IN (${v.raws.map(q).join(', ')});`,
  ),
];

console.log('');
console.log(`  rows with a series ............ ${rows.length}`);
console.log(`  distinct raw spellings ........ ${distinctRaw}`);
console.log(`  distinct slugs (after fold) ... ${registry.series.size}`);
console.log(`  registry entries created ...... ${plan.newSeries.length}`);
console.log(`  aliases written (canon) ....... ${plan.newAliases.length}`);
console.log(`  spellings merged onto another . ${plan.mergedSpellings}`);
console.log(`  unfoldable (series_slug NULL) . ${plan.unfoldable}`);
console.log(`  confirm-queue rows added ...... ${plan.newPending.length}`);
for (const p of plan.newPending) {
  console.log(`      ? "${p.candidate_display}"  ~  "${p.closest_display}"  (near key: ${p.near_key})`);
}
console.log(`  SQL statements ................ ${statements.length}`);
console.log('');

if (!APPLY) {
  console.log('DRY RUN - nothing was written. The SQL, in full:');
  console.log('');
  for (const s of statements) console.log(`  ${s}`);
  console.log('');
  console.log('Re-run with --apply to execute it.');
  process.exit(0);
}

const file = join(mkdtempSync(join(tmpdir(), 'series-backfill-')), 'backfill.sql');
writeFileSync(file, `${statements.join('\n')}\n`, 'utf8');
console.log(`Applying ${statements.length} statements from ${file} ...`);
console.log(wrangler(['--file', file, '--yes']));
console.log('Done. Verify: GET /api/series, and `SELECT COUNT(*) FROM series`.');
