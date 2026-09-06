/**
 * Types for `backup-keys.mjs` — hand-written, because the module itself is
 * plain ESM JavaScript that Node runs with no build step.
 *
 * ⚠️ WHY A `.d.mts` NEXT TO A `.mjs` RATHER THAN A SECOND COPY IN TYPESCRIPT.
 * `apps/auth-worker/src/backups.ts` carried a duplicate `generationOf` from
 * 2026-08-18 to 2026-09-05, with a header explaining that the copy was
 * deliberate "because there is no shared module between a Node script and this
 * Worker". That premise was never true of the BUNDLER — wrangler builds with
 * esbuild, which follows a relative import out of `apps/auth-worker/src` into
 * `scripts/lib` without complaint — it was only ever true of `tsc`, which
 * refuses a `.mjs` import with no types under `allowJs: false`. This file is
 * the four lines that answer tsc, and it retires the duplicate.
 *
 * ⚠️ IT IS A PROMISE, NOT A DERIVATION. Nothing checks these signatures against
 * the implementation; if you change an export in `backup-keys.mjs`, change it
 * here in the same edit. The unit tests
 * (`scripts/test/backup-keys.test.mjs`, `apps/auth-worker/test/backups.test.ts`)
 * exercise the real module from both sides, which is what makes a drift show up
 * as a failing test rather than as a silent `any`.
 *
 * `moduleResolution` is `bundler` in both auth-worker tsconfigs, which applies
 * the `.mjs` -> `.d.mts` extension substitution — so `import … from
 * '…/backup-keys.mjs'` finds this file.
 */

/** One R2/REST listing entry, narrowed to the single field retention reads. */
export interface BackupObject {
  key: string;
}

/** A generation: one backup night, which may be several part-objects. */
export interface BackupGeneration {
  /** `YYYYMMDDTHHMMSSZ` — sorts lexicographically as it sorts chronologically. */
  stamp: string;
  /** The objects that make up this generation, part order preserved. */
  objects: BackupObject[];
}

export interface RetentionPlan {
  /** Newest first, at most `keep` of them. */
  keep: BackupGeneration[];
  /** Everything older than the newest `keep`. */
  drop: BackupGeneration[];
  /**
   * `drop` flattened to keys, in delete order. ⚠️ THIS is the array the shadow
   * gate compares between `scripts/prune-r2-backups.mjs --dry-run` and the
   * Worker's `POST /api/estate/backups/prune?dryRun=1`.
   */
  dropKeys: string[];
  /** How many generations the listing held in total. */
  generations: number;
  /** How many objects the listing held in total (>= `generations`). */
  objects: number;
}

export function generationOf(key: string): string;
export function groupByGeneration<T extends BackupObject>(objects: T[]): BackupGeneration[];
export function planRetention(objects: BackupObject[], keep: number): RetentionPlan;
export function readWorkflowPrefixes(ymlText: string): { prefixes: string[]; keep: number };
