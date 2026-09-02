#!/usr/bin/env node
/**
 * gen-universe-names.mjs — project data/universes.json down to the two things
 * the auth Worker needs, and write them as a TypeScript module.
 *
 * ⚠️ WHY A GENERATED MODULE AND NOT A JSON IMPORT. `data/universes.json` is
 * 180 KB, and 145 KB of that is `universes[].notes` prose plus `_changelog` —
 * history that is the whole point of the file and none of the Worker's
 * business. A plain `import '../../../data/universes.json'` would inline every
 * byte of it into the Worker bundle, because esbuild cannot tree-shake INSIDE
 * a JSON object. The projection below is 2.3 KB.
 *
 * ⚠️ WHY NOT A HAND-KEPT COPY. That is exactly what the /universes page did,
 * and it was silently one universe short for a day (DotHack, 2026-08-25 →
 * 2026-08-26). A generated file is only safe while something proves it is
 * current: `scripts/test/universe-names-generated-parity.test.mjs` regenerates
 * this in memory and diffs it against the checked-in file, and `npm test` runs
 * before every deploy. If that test fails, run this script; do not edit the
 * output by hand.
 *
 * It is CHECKED IN rather than gitignored-and-regenerated (which is what
 * library_catalog's `sync-universes.mjs` does for its own copy) because
 * `wrangler deploy` has no prebuild hook here — a generated file that only
 * exists after someone remembers to run a script is a Worker that fails to
 * build on a fresh clone.
 *
 *   node scripts/gen-universe-names.mjs           # write it
 *   node scripts/gen-universe-names.mjs --check   # exit 1 if it is stale
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = new URL('../', import.meta.url);
const DATA_PATH = new URL('data/universes.json', REPO_ROOT);
const OUT_PATH = new URL('apps/auth-worker/src/universe-names.generated.ts', REPO_ROOT);

/**
 * The projection. Exported so the parity test uses the SAME function rather
 * than a second implementation of "what the Worker needs" — two projections
 * would be two things to keep in step, which is the failure this file exists
 * to prevent.
 */
export function renderModule(data) {
  const names = data.universes.map((u) => u.name);
  // Only the real alias entries: keys starting with `_` are the file's own
  // documentation (`_note`), not spellings anybody types.
  const canonical = Object.fromEntries(
    Object.entries(data.canonicalNames ?? {}).filter(([k]) => !k.startsWith('_')),
  );
  const pinned = Object.fromEntries(
    Object.entries(data._pinnedCanonicalNames ?? {}).filter(([k]) => !k.startsWith('_')),
  );

  return `/**
 * universe-names.generated.ts — GENERATED. DO NOT EDIT.
 *
 * Written by \`node scripts/gen-universe-names.mjs\` from data/universes.json,
 * which is the ONE copy of the estate's universe list. Kept honest by
 * scripts/test/universe-names-generated-parity.test.mjs, which regenerates this
 * in memory and diffs it — so a stale copy fails \`npm test\`, which every
 * deploy runs first.
 *
 * Only two things are projected here: the canonical names, and the alias fold.
 * The 145 KB of \`notes\` prose and \`_changelog\` in the source file is history
 * that belongs in git, not in a Worker bundle.
 */

/** Every universe's canonical name, in data/universes.json's own order. */
export const UNIVERSE_NAMES: readonly string[] = ${JSON.stringify(names, null, 2)};

/**
 * Normalised alias -> the owner's spelling. \`"cosmere" -> "The Cosmere"\`.
 * ⚠️ Keys are ALREADY normalised (lowercased, quotes folded, whitespace
 * collapsed) — normalise the typed name before looking it up, never the key.
 */
export const CANONICAL_NAMES: Readonly<Record<string, string>> = ${JSON.stringify(canonical, null, 2)};

/**
 * The owner's PINNED spellings — aliases whose answer is a recorded decision
 * rather than a preference. Carried so the Worker's refusal wording can say
 * "that is a spelling of X" with the same authority \`tools/universes.mjs canon\`
 * has locally.
 */
export const PINNED_CANONICAL_NAMES: Readonly<Record<string, string>> = ${JSON.stringify(pinned, null, 2)};
`;
}

export function loadData(path = DATA_PATH) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function main() {
  const wanted = renderModule(loadData());
  const check = process.argv.includes('--check');
  let current = null;
  try {
    current = readFileSync(OUT_PATH, 'utf8');
  } catch {
    /* not written yet */
  }
  if (current === wanted) {
    console.log(`up to date: ${fileURLToPath(OUT_PATH)}`);
    return;
  }
  if (check) {
    console.error(
      `STALE: ${fileURLToPath(OUT_PATH)} does not match data/universes.json.\n` +
        'Run `node scripts/gen-universe-names.mjs` and commit the result.',
    );
    process.exitCode = 1;
    return;
  }
  writeFileSync(OUT_PATH, wanted, 'utf8');
  console.log(`wrote ${fileURLToPath(OUT_PATH)}`);
}

// ⚠️ Run only when INVOKED, never when imported — the parity test imports
// `renderModule` and `loadData` from here, and a module that writes a file as a
// side effect of being imported would make the test rewrite the very file it is
// checking, which is a tripwire that can never fail. `import.meta.url ===
// pathToFileURL(argv[1])` is the portable form; the naive `file://${argv[1]}`
// comparison is false on Windows (drive letters need three slashes) and would
// have silently disabled the CLI here.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
