/**
 * WHICH TREES THE DOCS BACKUP ARCHIVES, AND THE WALKER THAT COLLECTS THEM.
 *
 * Extracted from `scripts/backup-docs.mjs` on 2026-09-06, when the gitignored
 * `.claude/` project folders joined the backup (owner: *"Yes"*, 2026-09-06
 * 00:5x Phoenix). The script itself is a top-level program — importing it runs
 * a backup — so the decisions worth pinning had to move somewhere a test can
 * import. Nothing about the docs half changed behaviour in that move; the
 * tests in `scripts/test/backup-docs-trees.test.mjs` pin both halves.
 *
 * ── 🔴 WHY `.claude/` IS BACKED UP AT ALL ───────────────────────────────────
 *
 * `KNOWN_ISSUES.md` KI-14: on 2026-09-06 an `rm -rf /c/lcw` destroyed **six**
 * `.claude/` project folders across the estate. Nothing tracked was lost —
 * `.claude/` is gitignored everywhere — and that is exactly the problem: the
 * folders held permission allowlists, project-local agents and skills whose
 * ONLY copy was on that disk. Never in git, never in R2 (this script backed up
 * `docs/`, not `.claude/`), and never in OneDrive either, because
 * `scripts/onedrive-exclude.ps1` had deliberately moved them OUT of the syncing
 * folder into `C:\lcw\onedrive-excluded\<repo>\.claude`, leaving a junction.
 *
 * ── ⚠️ KI-2: THIS MUST NEVER BECOME A TRACKED FILE ──────────────────────────
 *
 * The estate repos are PUBLIC. A `.claude/settings.local.json` can name hosts,
 * paths and machine layout. The backup goes to `estate-backups` — a private R2
 * bucket bound to no Worker — and nothing here ever stages anything into git.
 * `.claude/` stays untracked and gitignored; this file is the archive, not a
 * reason to check the folder in.
 *
 * ── ⚠️ WHY IT RIDES IN THE `docs/<repo>` OBJECT AND NOT A NEW `claude/` PREFIX
 *
 * A new `<kind>/<store>` prefix in `estate-backups` is a THREE-PLACE
 * registration, not a path string: `KNOWN_BACKUP_PREFIXES` in
 * `apps/auth-worker/src/backups.ts`, the retention invocation in
 * `.github/workflows/backup.yml`, and `prune-r2-backups.mjs`'s argument list —
 * pinned to each other by `apps/auth-worker/test/backups.test.ts`, which parses
 * the workflow. Registering one would also put a new row on the LIVE `/status`
 * backup grade, which needs an auth-worker deploy to take effect and which
 * would immediately grade a store that nothing schedules.
 *
 * So each repo still produces exactly ONE object per generation,
 * `docs/<repo>/<UTC>.json.gz`, and the `.claude` files ride inside it tagged
 * with `tree: "claude"`. Retention, grading and the drilled restore recipe are
 * all unchanged, and a `.claude` snapshot is always paired with the `docs`
 * snapshot taken in the same second — which is the restore-day property you
 * actually want.
 */

import { readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative, resolve, sep } from 'node:path';

/**
 * ⚠️ NO EXTENSION FILTER AND NO DENYLIST for the docs tree. Stated as a
 * decision rather than left to be inferred from an absence: this is the half of
 * the docs story that takes everything, and the snapshot publisher is the half
 * that is careful. A single file skipped here is a file that does not come back.
 *
 * The only things excluded are directories that are not documentation at all.
 */
export const SKIP_DIRS = new Set(['node_modules', '.git', '__pycache__']);

/**
 * 🔴 THE `.claude` TREE NEEDS TWO MORE EXCLUSIONS, AND BOTH ARE LOAD-BEARING.
 *
 * - `worktrees/` is a throwaway git CHECKOUT of the whole repo. Archiving it
 *   would base64 an entire second copy of the source into a JSON blob — tens to
 *   hundreds of MB a generation, for files git already has.
 * - `.wrangler/` is `wrangler dev`'s scratch, and `KNOWN_ISSUES.md` KI-3
 *   measured live API keys inside its source maps. `estate-backups` already
 *   holds key material knowingly (`access/keys/`); it should not also hoover up
 *   key material nobody decided to put there.
 *
 * ⚠️ Neither is silent: every skipped directory is reported by name and reason,
 * in the run log AND inside the archive's own manifest.
 */
export const CLAUDE_SKIP_DIRS = new Set([...SKIP_DIRS, 'worktrees', '.wrangler']);

/** A single file this large is not a doc; flag it rather than silently ship it. */
export const WARN_FILE_BYTES = 5 * 1024 * 1024;

/**
 * 🔴 ONEDRIVE MAKES REAL FILES LOOK LIKE SYMLINKS, AND AN EARLIER VERSION OF
 * THIS WALKER SILENTLY DROPPED THEM — MEASURED 2026-08-21.
 *
 * These trees live under OneDrive. A file OneDrive has dehydrated into a
 * placeholder (a "cloud file", i.e. a reparse point) is reported by Node as
 * `isSymbolicLink() === true` and `isFile() === false`. The old loop skipped
 * anything that was not `isFile()`, on the reasonable-sounding grounds that
 * symlinks must not be followed out of the tree.
 *
 * The result: `Board_Game_Catalog/docs` held **46 files and the backup archived
 * 27**, reporting complete success. ⚠️ And it was never limited to files
 * somebody had just moved — ANY file OneDrive chooses to free space on becomes
 * invisible to the backup, at a moment nothing here controls.
 *
 * The fix keeps the original protection and drops the false negative: a
 * symlink-ish entry is RESOLVED (`statSync` follows it), and included only if
 * it resolves to something INSIDE this tree. A genuine link pointing outside is
 * still refused — that was the real concern and it survives.
 *
 * ⚠️ THE CONTAINMENT CHECK IS AGAINST THE TREE'S OWN RESOLVED ROOT, which is
 * what lets `.claude` work at all: in three of the four repos `.claude` IS a
 * junction to `C:\lcw\onedrive-excluded\<repo>\.claude`. `realpathSync(base)`
 * resolves the junction first, so its contents are INSIDE the tree by the only
 * definition that matters, while a link inside it that points somewhere else
 * entirely is still refused.
 *
 * ⚠️ Nothing is skipped silently. Every skip is collected and printed, because
 * a backup that quietly omits files is worse than one that fails.
 */
export function walk(dir, base, { skipDirs = SKIP_DIRS, out = [], skipped = [], baseReal = null } = {}) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return out;
    throw err;
  }
  const root = baseReal ?? realpathSync(base);
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (skipDirs.has(e.name)) {
        skipped.push({ path: full, why: `directory excluded by name (${e.name})` });
        continue;
      }
      walk(full, base, { skipDirs, out, skipped, baseReal: root });
      continue;
    }
    if (e.isFile()) {
      out.push(full);
      continue;
    }
    // Neither a plain file nor a directory: a symlink, a junction, or a
    // OneDrive placeholder. Resolve it and decide on where it actually points.
    let real;
    let st;
    try {
      real = realpathSync(full);
      st = statSync(full); // follows
    } catch (err) {
      skipped.push({ path: full, why: `unresolvable (${err.code ?? err.message})` });
      continue;
    }
    if (!real.startsWith(root)) {
      skipped.push({ path: full, why: `resolves OUTSIDE the tree -> ${real}` });
      continue;
    }
    if (st.isDirectory()) {
      if (skipDirs.has(e.name)) {
        skipped.push({ path: full, why: `directory excluded by name (${e.name})` });
        continue;
      }
      walk(full, base, { skipDirs, out, skipped, baseReal: root });
    } else if (st.isFile()) out.push(full);
    else skipped.push({ path: full, why: 'not a regular file or directory' });
  }
  return out;
}

/**
 * The trees one repo contributes, in archive order.
 *
 * ⚠️ THE TWO TREES HAVE DIFFERENT FAILURE RULES, DELIBERATELY.
 *
 * - `docs` is **required**. Zero files is a moved directory or a typo in
 *   `REPOS`, and quietly writing an empty archive over a good one is how a
 *   backup becomes worse than none. The caller refuses the run.
 * - `claude` is **optional**. `library_catalog` has no `.claude` at all, and
 *   after KI-14 the other three are junctions to EMPTY targets. Both of those
 *   are ordinary states, not faults: a missing or empty `.claude` is a logged
 *   no-op and the docs backup still lands. Making it required would mean the
 *   incident that motivated this feature would also have broken the backup that
 *   answers it.
 */
export function treesFor(repo) {
  const trees = [{ tree: 'docs', root: repo.docs, required: true, skipDirs: SKIP_DIRS }];
  if (repo.claude) {
    trees.push({ tree: 'claude', root: repo.claude, required: false, skipDirs: CLAUDE_SKIP_DIRS });
  }
  return trees;
}

/**
 * Read one tree into archive entries.
 *
 * `status` is one of:
 *   `missing` — the root does not exist (or a junction that dangles)
 *   `empty`   — the root exists and yielded no files
 *   `ok`      — at least one file
 *
 * ⚠️ `missing` and `empty` are reported separately on purpose. They look
 * identical in a file count and they mean different things on restore day: one
 * says the folder was never there, the other says it was there and held
 * nothing — which is precisely the post-KI-14 state of three `.claude` folders,
 * and a reader of the archive should be able to tell that apart from a path
 * this script got wrong.
 */
export function collectTree(spec, { log = () => {} } = {}) {
  const skipped = [];
  let exists = true;
  try {
    exists = statSync(spec.root).isDirectory();
  } catch {
    exists = false;
  }

  const files = exists ? walk(spec.root, spec.root, { skipDirs: spec.skipDirs, skipped }) : [];
  // ⚠️ NO SILENT CAPS. A skip is announced whether or not anyone asked, because
  // the failure this whole module exists to avoid is a cheerful archive that is
  // quietly missing files.
  for (const s of skipped) log(`  ⚠️ SKIPPED ${s.path} — ${s.why}`);

  const entries = [];
  let bytes = 0;
  for (const full of files) {
    const buf = readFileSync(full);
    // POSIX separators in the archive so a restore is not Windows-shaped.
    const rel = relative(spec.root, full).split(sep).join('/');
    if (buf.length > WARN_FILE_BYTES) {
      log(`  ⚠️ large: ${spec.tree}/${rel} (${(buf.length / 1024 / 1024).toFixed(1)} MB)`);
    }
    entries.push({
      // ⚠️ THE TREE TAG IS WHAT MAKES ONE OBJECT HOLD TWO TREES. An entry with
      // no `tree` is a pre-2026-09-06 archive and means `docs` — restore-docs.mjs
      // depends on that default, so do not "tidy" it into a required field.
      tree: spec.tree,
      path: rel,
      bytes: buf.length,
      sha256: createHash('sha256').update(buf).digest('hex'),
      // base64 so binary files (the JSON/CSV/HTML fragments, and anything
      // added later) round-trip byte-exact rather than through a text decode.
      b64: buf.toString('base64'),
      mtime: statSync(full).mtime.toISOString(),
    });
    bytes += buf.length;
  }

  const status = !exists ? 'missing' : entries.length === 0 ? 'empty' : 'ok';
  return { tree: spec.tree, root: spec.root, required: spec.required, status, entries, bytes, skipped };
}

/**
 * Bundle every tree a repo contributes into one archive payload's worth of
 * entries, plus the per-tree ledger that goes INTO the archive.
 */
export function bundleRepo(repo, { log = () => {} } = {}) {
  const trees = [];
  const entries = [];
  let bytes = 0;
  for (const spec of treesFor(repo)) {
    const result = collectTree(spec, { log });
    entries.push(...result.entries);
    bytes += result.bytes;
    trees.push({
      tree: result.tree,
      root: result.root,
      required: result.required,
      status: result.status,
      file_count: result.entries.length,
      bytes: result.bytes,
      skipped: result.skipped,
    });
  }
  return { entries, bytes, trees, skipped: trees.flatMap((t) => t.skipped) };
}

/**
 * The one required tree that came back empty, or `null` when the archive is
 * shippable. Kept here rather than in the script so the refusal is testable.
 */
export function refusalFor(trees) {
  return trees.find((t) => t.required && t.file_count === 0) ?? null;
}

// ── THE RESTORE SIDE ────────────────────────────────────────────────────────

/**
 * ⚠️ An entry with NO `tree` is a pre-2026-09-06 archive and means `docs`.
 * Do not "tidy" this into a required field: every archive written before
 * 2026-09-06 is still in the bucket and still has to restore.
 */
export function treeOf(entry) {
  return entry.tree ?? 'docs';
}

/**
 * Where one entry lands under `--into`.
 *
 *   tree "docs"   -> <into>/<path>            ⚠️ UNCHANGED, deliberately — the
 *                                             drilled `diff -r` recipe in
 *                                             backup-restore.md §6b depends on it
 *   tree "claude" -> <into>/.claude/<path>
 *
 * 🔴 A `..` in an archived path would write OUTSIDE the directory the operator
 * named. These archives are ours, but a restore happens in a disaster on bytes
 * fetched back out of a bucket, and "the input is trusted" is precisely the
 * assumption that ships a path-traversal bug. Refuse loudly instead.
 */
export function destPathFor(entry, dest) {
  const tree = treeOf(entry);
  const root = resolve(dest);
  const out = resolve(root, tree === 'docs' ? entry.path : join('.claude', entry.path));
  if (out !== root && !out.startsWith(root + sep)) {
    throw new Error(
      `REFUSING: archived path "${entry.path}" (tree ${tree}) resolves to ${out}, which is OUTSIDE ${root}. ` +
        `An archive written by scripts/backup-docs.mjs never contains one — treat this file as untrusted and ` +
        `do not restore it. If you believe it is genuine, unpack it by hand and inspect the path first.`,
    );
  }
  return out;
}

/**
 * A one-line summary per tree for the run log. ⚠️ It always prints, including
 * for a `missing` or `empty` `.claude` — a no-op that says nothing is
 * indistinguishable from a step that never ran.
 */
export function treeLogLine(t) {
  if (t.status === 'missing') return `  ${t.tree}: MISSING (${t.root}) — nothing to archive${t.required ? '' : ', which is fine'}`;
  if (t.status === 'empty') return `  ${t.tree}: EMPTY (${t.root}) — 0 files${t.required ? '' : ', which is fine'}`;
  return `  ${t.tree}: ${t.file_count} file(s), ${(t.bytes / 1024).toFixed(0)} KB`;
}
