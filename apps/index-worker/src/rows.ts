/**
 * The push contract and the entry-building rules — pure, no I/O.
 *
 * Sources push RAW display strings (an explicit allow-list of columns, built
 * in the owning repo); the index folds, refuses, and resolves universes HERE,
 * once, on write. No source contains fold code at all — that is what beats
 * even "three exporters compute the inputs" (design §6).
 */

import { z } from 'zod';
import { creatorFoldOrNull, titleFoldOrNull, workFoldOrNull } from './fold.js';
import type { UniverseIndex } from './universes.js';
import { universeFor } from './universes.js';

export const SOURCES = ['game', 'library', 'audiobook'] as const;
export type Source = (typeof SOURCES)[number];

export function isSource(s: string): s is Source {
  return (SOURCES as readonly string[]).includes(s);
}

const id = z.union([z.string().min(1), z.number().int()]).transform(String);

/**
 * One pushed row. `.strict()` on purpose: an unknown key is refused with its
 * name, never silently stripped — this estate has measured what the silent
 * strip costs (a zod default this codebase documents as a lie elsewhere).
 *
 * Everything here is display data or a pointer. The projection is
 * default-deny at the SOURCE (design §4.1); this schema is the second fence,
 * not the first.
 */
export const pushRowSchema = z
  .object({
    source_id: id,
    title: z.string().min(1),
    creator: z.string().min(1).nullish(),
    series: z.string().min(1).nullish(),
    series_index: z.number().finite().nullish(),
    year: z.number().int().nullish(),
    publisher: z.string().min(1).nullish(),
    format: z.string().min(1),
    kind: z.string().min(1).nullish(),
    parent_source_id: id.nullish(),
    cover_url: z.string().min(1).nullish(),
    detail_url: z.string().min(1).nullish(),
  })
  .strict();

export type PushRow = z.infer<typeof pushRowSchema>;

export const pushBodySchema = z.array(pushRowSchema);

/** What actually lands in the `entry` table. Column-for-column with migration 0001. */
export interface EntryRow {
  source: Source;
  source_id: string;
  title: string;
  creator: string | null;
  title_fold: string | null;
  work_fold: string | null;
  universe: string | null;
  series: string | null;
  /**
   * The series registry key (migration 0004), filled in by push.ts AFTER this
   * function — resolving it needs the registry, and the registry needs the
   * database, which this module deliberately never touches. `null` here means
   * "not resolved yet"; `null` in the database means the row has no series, or
   * one whose fold is empty (the refusal).
   */
  series_slug: string | null;
  series_index: number | null;
  year: number | null;
  publisher: string | null;
  format: string;
  kind: string | null;
  parent_source_id: string | null;
  cover_url: string | null;
  detail_url: string | null;
  pushed_at: string;
}

/**
 * Problems with a snapshot that zod cannot see. Returned as strings so the
 * route can 422 naming every one, not just the first.
 */
export function snapshotProblems(source: Source, rows: readonly PushRow[]): string[] {
  const problems: string[] = [];

  // "Zero rows is a failed export, not an empty catalog" — the bridge script's
  // own loud-failure rule, kept (design §5). None of these catalogs is empty;
  // an empty array means the source's export broke.
  if (rows.length === 0) {
    problems.push('empty snapshot: zero rows is a failed export, not an empty catalog');
    return problems;
  }

  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.source_id)) {
      problems.push(`duplicate source_id '${row.source_id}': a snapshot holds one row per catalogued thing`);
    }
    seen.add(row.source_id);

    // Games have no author, and a board game is never the same work as a book.
    // A games row carrying a creator is a projection bug at the source, said
    // out loud rather than quietly stored.
    if (source === 'game' && row.creator != null) {
      problems.push(`row '${row.source_id}' carries creator '${row.creator}': games rows have no creator by design`);
    }
  }
  return problems;
}

/**
 * Fold, refuse, resolve — the write-side rules of design §3, applied to one row.
 *
 * - `work_fold` exists for BOOK sources only; games rows carry NULL, always.
 * - An empty fold stores NULL (the refusal), so the row is out of key joins.
 * - `universe` is resolved here from the shared list, exclusions first.
 */
export function entryFor(source: Source, row: PushRow, universes: UniverseIndex, pushedAt: string): EntryRow {
  const titleFold = titleFoldOrNull(row.title);
  const creatorFold = source === 'game' ? null : creatorFoldOrNull(row.creator);
  return {
    source,
    source_id: row.source_id,
    title: row.title,
    creator: row.creator ?? null,
    title_fold: titleFold,
    work_fold: source === 'game' ? null : workFoldOrNull(titleFold, creatorFold),
    universe: universeFor(universes, { title: row.title, series: row.series ?? null }),
    series: row.series ?? null,
    series_slug: null, // resolved against the registry in push.ts (see the field)
    series_index: row.series_index ?? null,
    year: row.year ?? null,
    publisher: row.publisher ?? null,
    format: row.format,
    kind: row.kind ?? null,
    parent_source_id: row.parent_source_id ?? null,
    cover_url: row.cover_url ?? null,
    detail_url: row.detail_url ?? null,
    pushed_at: pushedAt,
  };
}
