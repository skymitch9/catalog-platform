// scripts/lib/library-repo.mjs
//
// Finding the sibling `bookbuddy/library_catalog` checkout.
//
// ⚠️ The MIRROR of `library_catalog/scripts/lib/platform-repo.mjs`, which does
// this in the other direction. Same argument, same failure discipline: a bare
// relative path (`../bookbuddy/library_catalog/...`) works on this machine and
// breaks on any checkout laid out differently, so resolution is explicit and
// its failure names every path it tried.
//
// ⚠️ **The direction matters, and it is the opposite of the other file's.**
// `library_catalog` reads catalog-platform for CODE it must bundle, so a
// missing checkout there FAILS THE BUILD. Here the thing being read is
// `packages/research/src/gabi.ts` — GABI's canonical personality prompt — and
// what this repo does with it is COMMITTED SOURCE (the generated section of
// `apps/discord-worker/src/gabi-prompt.ts`), not a gitignored build artifact.
// So a clone with no sibling library checkout still typechecks, tests and
// deploys; only re-syncing needs the sibling. `sync-gabi-prompt.mjs --check`
// therefore SKIPS loudly rather than failing when it cannot find this repo.

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, '..', '..');

/** The env var that overrides everything. Named in every failure message. */
export const ENV_VAR = 'LIBRARY_CATALOG_DIR';

/** Relative to this repo's root, in the order they are tried. */
const CANDIDATES = [
  join('..', 'bookbuddy', 'library_catalog'), // vs-code-repos/bookbuddy/… ← the real layout
  join('..', 'library_catalog'),
  join('..', '..', 'bookbuddy', 'library_catalog'),
];

/** A directory is the library repo if it holds the file we came for. */
function looksRight(dir) {
  return existsSync(join(dir, 'packages', 'research', 'src', 'gabi.ts'));
}

/**
 * @returns {{ dir: string, how: string, tried: string[] } | null}
 *   `null` when it cannot be found — the CALLER decides whether that is fatal.
 *   ⚠️ Deliberately not a throw: the only consumer that MUST have it is the
 *   hand-run sync, and the only consumer that must NOT die without it is a
 *   `--check` in a clone that has no sibling.
 */
export function findLibraryRepo() {
  const tried = [];

  const fromEnv = process.env[ENV_VAR];
  if (fromEnv) {
    const dir = resolve(fromEnv);
    tried.push(`${ENV_VAR}=${dir}`);
    if (looksRight(dir)) return { dir, how: ENV_VAR, tried };
    return null;
  }

  for (const rel of CANDIDATES) {
    const dir = resolve(REPO_ROOT, rel);
    tried.push(dir);
    if (looksRight(dir)) return { dir, how: `sibling lookup (${rel})`, tried };
  }

  return { dir: null, how: null, tried };
}

/** The sentence a caller prints when `findLibraryRepo()` came back empty. */
export function libraryRepoAdvice(tried) {
  return (
    'Cannot find the bookbuddy/library_catalog checkout.\n\n' +
    'It owns packages/research/src/gabi.ts — GABI_SYSTEM, the canonical\n' +
    'personality prompt for the whole estate. This repo carries a generated\n' +
    'COPY of its shared paragraphs, committed, so the absence of this checkout\n' +
    'breaks only the re-sync, never the build.\n\n' +
    'Tried:\n' +
    (tried ?? []).map((t) => `  - ${t}`).join('\n') +
    `\n\nFix: clone library_catalog under a sibling bookbuddy/, or set ${ENV_VAR}:\n` +
    `  PowerShell   $env:${ENV_VAR} = "C:\\path\\to\\library_catalog"\n` +
    `  bash         export ${ENV_VAR}=/path/to/library_catalog\n`
  );
}
