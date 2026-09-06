/**
 * Types for `suite.mjs` — hand-written, because the probe suite is plain ESM
 * JavaScript that Node runs with no build step and wrangler's esbuild bundles
 * straight into the auth Worker.
 *
 * ⚠️ A PROMISE, NOT A DERIVATION. Nothing checks these signatures against the
 * implementation. If you change `runProbeSuite`'s options or its return shape,
 * change this file in the same edit — otherwise the Worker typechecks against a
 * contract the suite no longer honours, which is a runtime failure wearing a
 * green build's clothes.
 *
 * `moduleResolution` is `bundler` in both auth-worker tsconfigs, which applies
 * the `.mjs` -> `.d.mts` extension substitution, so `import … from
 * '…/suite.mjs'` finds this file.
 */

/** One assertion's row, exactly as `kit.mjs`'s `check()` builds it. */
export interface ProbeResult {
  /** Surface name — `auth`, `index`, `library`, `discipline`, … */
  area: string;
  /** Stable id, unique within `area` — `A39`, `AB22`, `RO1`. */
  id: string;
  /** The HTTP method used, or `PARSE` for a body-shape assertion. */
  method: string;
  endpoint: string;
  assertion: string;
  ok: boolean;
  /** What was actually seen. ⚠️ Always populated on a failure. */
  observed: string;
}

export interface ProbeSuiteOptions {
  /** Per-request timeout. Default 15 000 ms (the CLI's). */
  timeoutMs?: number;
  /**
   * Wall-clock budget for the whole run, checked BETWEEN areas. Absent = no
   * limit (the CLI). A run that hits it returns `truncated: true`.
   */
  deadlineMs?: number;
  log?: (line: string) => void;
  logFailure?: (line: string) => void;
  now?: () => number;
}

export interface ProbeSuiteRun {
  passed: number;
  failed: number;
  total: number;
  results: ProbeResult[];
  /** ⚠️ True when the deadline stopped the run. Never render this as green. */
  truncated: boolean;
  startedAt: string;
  finishedAt: string;
  areasRun: number;
  areasTotal: number;
}

export function runProbeSuite(opts?: ProbeSuiteOptions): Promise<ProbeSuiteRun>;
export const NON_GET_ALLOWLIST: Set<string>;
export const AREA_COUNT: number;
