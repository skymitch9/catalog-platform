#!/usr/bin/env node
/**
 * gen-admin-catalogs.mjs — project `packages/estate-auth`'s canonical catalog
 * vocabulary down to the one array `/admin` needs, and write it as a browser
 * ES module.
 *
 * ⚠️ WHY THIS EXISTS. `sites/heygabi-home/public/admin/admin.js` carried
 * `const CATALOGS = [...]` — the THIRD in-repo copy of
 * `packages/estate-auth/src/visibility.ts`'s array (survey §3.1). The copy was
 * deliberate and the reasoning was right: `/admin` is a PERMISSIONS surface,
 * that array decides which visibility grants render, and the estate registry is
 * a NAME service cached ten minutes upstream with two isolates free to disagree
 * inside that window (`docs/info/catalog-registry.md` §8 — *fine for a name,
 * never for a permission*). Driving the checkbox set from a runtime fetch would
 * let a stale or unreachable directory silently remove an admin's ability to
 * grant or revoke a catalog: an access surface failing closed on a cache miss.
 *
 * 🔴 **SO THIS IS A SYNC, NOT A FETCH, AND THE DISTINCTION IS THE WHOLE POINT.**
 * The vocabulary is fixed at BUILD time from the canonical TypeScript, exactly
 * as `sync-estate-auth.mjs` fixes the auth module for the sibling repos. The
 * page ships knowing every catalog; no network call can narrow it; and the
 * array can no longer drift, because a test regenerates it and diffs.
 * `docs/TODO.md` said it in as many words: *"Consolidating it is a sync-script
 * job like `sync-estate-auth.mjs`, not a fetch."*
 *
 * ⚠️ WHAT THIS DOES **NOT** TOUCH: `CATALOG_LABELS` in `admin.js`. Labels are
 * DISPLAY and are still overwritten in place from `GET /api/catalogs` before
 * the first render — a name is exactly what the registry is safe for. The keys
 * are the vocabulary; the words are the directory's. That line stays where the
 * page draws it.
 *
 * ⚠️ IT IS CHECKED IN, not gitignored-and-regenerated. `heygabi-home` is a
 * Cloudflare Pages site deployed by uploading `sites/heygabi-home/public`
 * DIRECTLY (`npm run deploy:home`) — there is no build step and no prebuild
 * hook in that path. A generated file that only exists after somebody remembers
 * to run a script is an `/admin` page that white-screens on a fresh clone, and
 * a directory upload ships whatever is on disk. Committed, plus a parity test,
 * is the only shape that survives both facts.
 *
 * ⚠️ AND A CHECKED-IN GENERATED FILE IS A HAND-KEPT COPY THE MOMENT NOTHING
 * PROVES IT IS CURRENT — which is how the `/universes` page went a full day one
 * universe short with nothing going red (see `gen-universe-names.mjs`, whose
 * shape this follows deliberately). `scripts/test/admin-catalogs-generated-parity.test.mjs`
 * regenerates this in memory and diffs it, and `npm test` runs before every
 * deploy of this site.
 *
 *   node scripts/gen-admin-catalogs.mjs           # write it
 *   node scripts/gen-admin-catalogs.mjs --check   # exit 1 if it is stale
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = new URL('../', import.meta.url);
const SOURCE_PATH = new URL('packages/estate-auth/src/visibility.ts', REPO_ROOT);
const OUT_PATH = new URL('sites/heygabi-home/public/admin/catalogs.generated.js', REPO_ROOT);

/** Where the source lives, as the generated banner should name it. */
export const SOURCE_REL = 'packages/estate-auth/src/visibility.ts';

/**
 * Pull the canonical array out of the TypeScript source.
 *
 * ⚠️ IT PARSES RATHER THAN IMPORTS, because the consumers of this projection
 * are plain `node --test` files with no TypeScript loader, and adding one to
 * make a five-element array readable would be a large dependency for a small
 * fact. The trade is that a regex can go quietly wrong — so this one is
 * DELIBERATELY BRITTLE AND LOUD:
 *
 *   - it matches the exact `export const CATALOGS = [...] as const;` form;
 *   - it THROWS with the file path when that form is not found, rather than
 *     returning `[]` (the zero-row-read rule the estate's sync scripts follow:
 *     an empty read is a failed read, not an empty module);
 *   - it throws on an empty array, a duplicate, or a non-string entry.
 *
 * A restructure upstream therefore stops the build with a sentence naming what
 * changed, which is the only acceptable failure mode for a permissions
 * vocabulary.
 */
export function parseCatalogs(source) {
  const m = source.match(/export\s+const\s+CATALOGS\s*=\s*\[([\s\S]*?)\]\s*as\s+const\s*;/);
  if (!m) {
    throw new Error(
      `gen-admin-catalogs: could not find \`export const CATALOGS = [...] as const;\` in ${SOURCE_REL}.\n` +
        'The canonical module was restructured. Update the parser in ' +
        'scripts/gen-admin-catalogs.mjs after reading what it became — do NOT ' +
        'fall back to a hand-written array, which is the copy this script removed.',
    );
  }
  const ids = [...m[1].matchAll(/'([^']+)'|"([^"]+)"/g)].map((x) => x[1] ?? x[2]);
  if (ids.length === 0) {
    throw new Error(
      `gen-admin-catalogs: parsed ZERO catalogs from ${SOURCE_REL} — refusing to write an empty ` +
        'permissions vocabulary. An /admin page with no catalogs renders no grant controls at all.',
    );
  }
  for (const id of ids) {
    if (!/^[a-z][a-z0-9_]*$/.test(id)) {
      throw new Error(`gen-admin-catalogs: implausible catalog id ${JSON.stringify(id)} in ${SOURCE_REL}`);
    }
  }
  if (new Set(ids).size !== ids.length) {
    throw new Error(`gen-admin-catalogs: duplicate catalog id in ${SOURCE_REL} — [${ids.join(', ')}]`);
  }
  return ids;
}

/**
 * Render the module.
 *
 * Exported so the parity test uses the SAME function rather than a second
 * implementation of the projection — two projections would be two things to
 * keep in step, which is the failure this file exists to prevent.
 */
export function renderModule(ids) {
  const entries = ids.map((id) => `  '${id}',`).join('\n');
  return `/**
 * catalogs.generated.js — GENERATED. DO NOT EDIT.
 *
 * Written by \`node scripts/gen-admin-catalogs.mjs\` from
 * ${SOURCE_REL}, which is the ONE copy of the estate's
 * catalog vocabulary. Kept honest by
 * scripts/test/admin-catalogs-generated-parity.test.mjs, which regenerates this
 * in memory and diffs it — so a hand edit here fails \`npm test\`, and \`npm test\`
 * runs before every deploy of this site.
 *
 * ⚠️ THIS IS A BUILD-TIME SYNC, NOT A RUNTIME FETCH, and the difference is a
 * security property rather than a preference. /admin is a PERMISSIONS surface:
 * this array decides which visibility grants render. The estate registry
 * (\`GET /api/catalogs\`) is a NAME service cached ten minutes upstream, so
 * driving the checkbox set from it would let a stale or unreachable directory
 * silently remove an admin's ability to grant or revoke a catalog — an access
 * surface failing closed on a cache miss. Names may come from the network;
 * a permissions vocabulary may not.
 *
 * ⚠️ ORDER IS LOAD-BEARING and is §4.5's canonical order: it is the order the
 * checkboxes render in AND the order the visibility array is POSTED in. New
 * catalogs append at the END; existing entries never move.
 *
 * To add a catalog: edit ${SOURCE_REL}
 * (plus its \`vis_<id>\` migration on the auth Worker), then run
 * \`node scripts/gen-admin-catalogs.mjs\` and commit BOTH files.
 */

export const CATALOGS = [
${entries}
];
`;
}

export function loadSource() {
  return readFileSync(SOURCE_PATH, 'utf8');
}

function main() {
  const wanted = renderModule(parseCatalogs(loadSource()));
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
      `STALE: ${fileURLToPath(OUT_PATH)} does not match ${SOURCE_REL}.\n` +
        'Run `node scripts/gen-admin-catalogs.mjs` and commit the result.',
    );
    process.exitCode = 1;
    return;
  }
  writeFileSync(OUT_PATH, wanted, 'utf8');
  console.log(`wrote ${fileURLToPath(OUT_PATH)}`);
}

// ⚠️ Run only when INVOKED, never when imported — the parity test imports
// `renderModule`, `parseCatalogs` and `loadSource` from here, and a module that
// wrote a file as a side effect of being imported would make the test rewrite
// the very file it is checking, which passes forever and proves nothing.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
