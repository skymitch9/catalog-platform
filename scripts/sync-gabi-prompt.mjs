/**
 * Materialise GABI's canonical personality prompt into
 * `apps/discord-worker/src/gabi-prompt.ts`.
 *
 * ⚠️ **THE MIRROR of `library_catalog/scripts/sync-gabi-conversation.mjs`, and
 * the direction is the other way.** That script pulls this repo's conversation
 * substrate INTO the library; this one pulls the library's personality prompt
 * INTO this repo. One estate, two files, one voice.
 *
 * ## What this ends
 *
 * `gabi-prompt.ts` said, in its own header, *"Option (a) — copied text with a
 * comment pointing at the canonical source … A `scripts/sync-gabi-prompt.mjs`
 * (option b) can be added later"*. It was never added. So the Discord bot's
 * personality was a hand copy whose only test compared it against a literal it
 * kept itself — a pin that goes red when THIS repo changes and stays green
 * forever when the CANONICAL prompt changes, which is the drift that matters.
 *
 * ## ⚠️ How it differs from sync-gabi-conversation.mjs, and why it had to
 *
 * That script copies whole FILES into a gitignored `generated/` directory. Here
 * the two surfaces differ INSIDE the prompt's sections rather than after them —
 * Discord cannot write, so it must not be told about five write tools — and the
 * output is COMMITTED SOURCE rather than a build artifact, because the Worker
 * has to build in a clone with no sibling library checkout.
 *
 * So: shared paragraphs are extracted VERBATIM into a marked region, deltas are
 * pinned upstream by HASH, and the whole argument (with the measured
 * section-by-section table) lives in `scripts/lib/gabi-prompt-sync.mjs`.
 *
 * ## Usage
 *
 *   node scripts/sync-gabi-prompt.mjs            # rewrite the generated region
 *   node scripts/sync-gabi-prompt.mjs --check    # exit 1 if it is stale
 *
 * `--check` is this package's `pretest` and `pretypecheck`, the same wiring
 * `sync-gabi-conversation.mjs` has in the library's package.json.
 *
 * ⚠️ **`--check` SKIPS (exit 0) when the sibling library checkout is missing**,
 * loudly, on one line. The generated region is committed, so a clone without
 * the sibling still tests and deploys correctly — failing there would break
 * CI for a repo that has nothing wrong with it. Set
 * `SYNC_GABI_PROMPT_REQUIRE=1` to turn the skip into a failure.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT, findLibraryRepo, libraryRepoAdvice } from './lib/library-repo.mjs';
import {
  DELTAS,
  SOURCE_RELATIVE,
  TARGET_RELATIVE,
  checkDeltas,
  extractShared,
  readGabiSystem,
  readGenerated,
  renderGenerated,
  spliceGenerated,
} from './lib/gabi-prompt-sync.mjs';

const CHECK = process.argv.includes('--check');
const NAME = 'sync-gabi-prompt';

function fail(message) {
  console.error(`\n${NAME}: ${message}\n`);
  process.exit(1);
}

// ── find the source ────────────────────────────────────────────────────────

const found = findLibraryRepo();
if (!found?.dir) {
  const advice = libraryRepoAdvice(found?.tried);
  if (CHECK && process.env.SYNC_GABI_PROMPT_REQUIRE !== '1') {
    console.log(
      `${NAME}: SKIPPED — no bookbuddy/library_catalog checkout beside this repo, so the ` +
        'canonical prompt could not be read. The generated region is committed, so this is ' +
        'not a failure. Set SYNC_GABI_PROMPT_REQUIRE=1 to make it one.',
    );
    process.exit(0);
  }
  fail(advice);
}
console.log(`${NAME}: library_catalog found via ${found.how} → ${found.dir}`);

let system;
try {
  system = readGabiSystem(found.dir);
} catch (err) {
  fail(err.message);
}

// ── the deltas: pinned upstream, never copied ──────────────────────────────

const drift = checkDeltas(system);
if (drift.length > 0) {
  const report = drift
    .map(
      (d) =>
        `  • ${d.key}\n` +
        `    why this paragraph is DIFFERENT on Discord: ${d.why}\n` +
        `    pinned hash: ${d.expected}\n` +
        `    upstream now: ${d.actual}\n` +
        `    ── upstream text as it stands ──\n` +
        d.text
          .split('\n')
          .map((l) => `    | ${l}`)
          .join('\n'),
    )
    .join('\n\n');
  fail(
    `${drift.length} of ${DELTAS.length} DELIBERATE DELTAS moved upstream.\n\n` +
      'Nothing is broken. These are the paragraphs the Discord surface words\n' +
      'differently ON PURPOSE, so they are pinned rather than copied — and one of\n' +
      'them has been edited in library_catalog. Read the new text, decide whether\n' +
      "Discord's wording still follows from it, edit gabi-prompt.ts OUTSIDE the\n" +
      'markers if it does not, then paste the new hash into DELTAS in\n' +
      'scripts/lib/gabi-prompt-sync.mjs and say in the commit what you decided.\n\n' +
      `${report}\n`,
  );
}

// ── the shared paragraphs: extracted verbatim ──────────────────────────────

let body;
try {
  body = renderGenerated(extractShared(system));
} catch (err) {
  fail(err.message);
}

const targetPath = join(REPO_ROOT, TARGET_RELATIVE);
const before = readFileSync(targetPath, 'utf8');
const current = readGenerated(before);
if (current === null) {
  fail(
    `${TARGET_RELATIVE} has no generated-region markers.\n` +
      'They are added by hand once, around the SHARED block; this script will not\n' +
      'guess where the boundary goes.',
  );
}

if (CHECK) {
  if (current === body) {
    console.log(
      `${NAME}: OK — ${TARGET_RELATIVE}'s generated region matches GABI_SYSTEM in ` +
        `library_catalog/${SOURCE_RELATIVE.replace(/\\/g, '/')}, and all ${DELTAS.length} ` +
        'deliberate deltas are as last reviewed.',
    );
    process.exit(0);
  }
  fail(
    `${TARGET_RELATIVE}'s generated region is STALE.\n\n` +
      "GABI's canonical personality prompt changed in library_catalog and this\n" +
      'repo has not picked it up (or somebody edited inside the markers by hand).\n\n' +
      '  Fix: node scripts/sync-gabi-prompt.mjs\n\n' +
      '⚠️ Then look at the diff before committing — this is the bot\'s VOICE, and\n' +
      "the pin in apps/discord-worker/test/gabi-edge.test.ts holds the prompt the\n" +
      'owner would be reverting to. Update that literal in the same commit and say so.\n',
  );
}

let after;
try {
  after = spliceGenerated(before, body);
} catch (err) {
  fail(err.message);
}

if (after === before) {
  console.log(`${NAME}: already in sync — ${TARGET_RELATIVE} unchanged.`);
  process.exit(0);
}

writeFileSync(targetPath, after, 'utf8');
console.log(
  `${NAME}: rewrote the generated region of ${TARGET_RELATIVE}.\n` +
    "⚠️ This is the bot's VOICE. Read the diff, and update the pinned literal in\n" +
    'apps/discord-worker/test/gabi-edge.test.ts in the same commit.',
);
