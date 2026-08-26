#!/usr/bin/env node
/**
 * Import `docs/access/keys/*.txt` — the three RAW VALUES this machine keeps for
 * scripts that need them — into the 1Password vault `Estate`.
 *
 *   node scripts/op-import-keys.mjs --dry-run     # names + actions, no writes
 *   node scripts/op-import-keys.mjs               # create/update the items
 *
 * Owner decision 2026-08-26 (option A): adopt 1Password now. This is **step 2**
 * of [`docs/info/secrets-review-2026-08-26.md`](../docs/info/secrets-review-2026-08-26.md)
 * §5 — "three items, no code, and it removes three raw values from a synced disk
 * in one sitting". Step 1 (`library_catalog`) is where the code went.
 *
 * ## ⚠️ This is a LAUNCHER, not a second implementation
 *
 * The import logic — the item-title convention, the idempotent create/update,
 * the glued-value refusal, the names-only output, and the rule that a VALUE
 * reaches `op` over **stdin** and never argv — lives in ONE place:
 * `library_catalog/scripts/op-import-dev-vars.mjs`, which grew a `--keys-dir`
 * mode for exactly this caller. Two copies of a function that decides how a
 * secret is NAMED is the "one canonical implementation" rule broken on the
 * worst possible subject.
 *
 * The direction of the dependency is deliberate and is the *reverse* of the
 * usual one (library_catalog syncs code FROM here). It goes this way because the
 * library repo is where `push-secrets.mjs`'s allowlists, classification lists
 * and guards already lived, so that is where the vault work cost least — the
 * ordering §5 chose. If the two repos ever stop sitting side by side, the fix is
 * to move the shared module, not to fork it.
 *
 * ## What it does NOT do
 *
 * ⚠️ **It does not delete the files.** That is the owner's call, and
 * `docs/access/keys/README.md` records the new arrangement: the vault is the
 * master, the files are a courtesy copy that a script on this machine can still
 * read without an authorization prompt.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const KEYS_DIR = join(root, 'docs', 'access', 'keys');

/**
 * Where the shared importer lives. `LIBRARY_CATALOG_DIR` wins, then the places
 * the estate actually keeps that repo — measured 2026-08-26.
 */
const CANDIDATES = [
  process.env.LIBRARY_CATALOG_DIR,
  join(root, '..', 'bookbuddy', 'library_catalog'),
  join(root, '..', 'library_catalog'),
  'C:\\Users\\nbasl\\OneDrive\\Documents\\vs-code-repos\\bookbuddy\\library_catalog',
].filter(Boolean);

const SCRIPT = 'scripts/op-import-dev-vars.mjs';

function findImporter() {
  for (const dir of CANDIDATES) {
    const p = resolve(dir, SCRIPT);
    if (existsSync(p)) return p;
  }
  return null;
}

const importer = findImporter();
if (!importer) {
  // ⚠️ A person must never see a bare failure: say what happened, what it needs
  // and how to get it.
  console.error('Cannot find the shared vault importer, so nothing was imported.');
  console.error('');
  console.error(`It lives in the library_catalog repo, at ${SCRIPT}.`);
  console.error('Looked in:');
  for (const dir of CANDIDATES) console.error(`  ${resolve(dir, SCRIPT)}`);
  console.error('');
  console.error('Fix: clone library_catalog beside this repo, or point at it:');
  console.error('  PowerShell   $env:LIBRARY_CATALOG_DIR = "C:\\path\\to\\library_catalog"');
  console.error('  bash         export LIBRARY_CATALOG_DIR=/path/to/library_catalog');
  process.exit(1);
}

/**
 * ⚠️ `--bare` is a CLAIM about these names, not a convenience. In
 * `docs/access/keys/` one FILE is one value and the file name IS that secret's
 * name across the whole estate — `ESTATE_EVENTS_TOKEN` means one value whether
 * `estate-auth`, `catalog-index` or `audiobook-worker` is holding it. Nothing
 * else uses those names for anything else, so nothing gets a `<holder>.` scope.
 * A `.dev.vars` is the opposite case (one instance's view), which is why the
 * flag is per-run and not the default.
 */
const args = [
  importer,
  '--keys-dir',
  KEYS_DIR,
  '--bare',
  '--tag',
  'catalog-platform',
  ...process.argv.slice(2),
];

console.log(`importer: ${importer}`);
const child = spawn(process.execPath, args, { stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 1));
