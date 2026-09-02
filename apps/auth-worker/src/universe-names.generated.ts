/**
 * universe-names.generated.ts — GENERATED. DO NOT EDIT.
 *
 * Written by `node scripts/gen-universe-names.mjs` from data/universes.json,
 * which is the ONE copy of the estate's universe list. Kept honest by
 * scripts/test/universe-names-generated-parity.test.mjs, which regenerates this
 * in memory and diffs it — so a stale copy fails `npm test`, which every
 * deploy runs first.
 *
 * Only two things are projected here: the canonical names, and the alias fold.
 * The 145 KB of `notes` prose and `_changelog` in the source file is history
 * that belongs in git, not in a Worker bundle.
 */

/** Every universe's canonical name, in data/universes.json's own order. */
export const UNIVERSE_NAMES: readonly string[] = [
  "The Cosmere",
  "Runnerverse",
  "CAL Verse",
  "Maasverse",
  "Riordanverse",
  "Solaria",
  "Willverse",
  "Marvel",
  "Disney",
  "Star Wars",
  "Alliances",
  "Cytoverse",
  "Reckoners",
  "Middle-earth",
  "Dungeon Crawler Carl",
  "Innworld",
  "DotHack"
];

/**
 * Normalised alias -> the owner's spelling. `"cosmere" -> "The Cosmere"`.
 * ⚠️ Keys are ALREADY normalised (lowercased, quotes folded, whitespace
 * collapsed) — normalise the typed name before looking it up, never the key.
 */
export const CANONICAL_NAMES: Readonly<Record<string, string>> = {
  "the cosmere": "The Cosmere",
  "cosmere": "The Cosmere",
  "cosmere universe": "The Cosmere",
  "the cosmere universe": "The Cosmere",
  "runnerverse": "Runnerverse",
  "the runnerverse": "Runnerverse",
  "arand multiverse": "Runnerverse",
  "the arand multiverse": "Runnerverse",
  "arandverse": "Runnerverse",
  "cal verse": "CAL Verse",
  "calverse": "CAL Verse",
  "the cal verse": "CAL Verse",
  "divine dungeon universe": "CAL Verse",
  "maasverse": "Maasverse",
  "the maasverse": "Maasverse",
  "riordanverse": "Riordanverse",
  "the riordanverse": "Riordanverse",
  "solaria": "Solaria",
  "zodiac academy universe": "Solaria",
  "willverse": "Willverse",
  "the willverse": "Willverse",
  "will wight multiverse": "Willverse",
  "wightverse": "Willverse",
  "marvel": "Marvel",
  "disney": "Disney",
  "star wars": "Star Wars",
  "alliances": "Alliances",
  "stan lee's alliances": "Alliances",
  "cytoverse": "Cytoverse",
  "the cytoverse": "Cytoverse",
  "reckoners": "Reckoners",
  "the reckoners": "Reckoners",
  "middle-earth": "Middle-earth",
  "middle earth": "Middle-earth",
  "tolkien legendarium": "Middle-earth",
  "dungeon crawler carl": "Dungeon Crawler Carl",
  "innworld": "Innworld",
  "the innworld": "Innworld",
  "innverse": "Innworld",
  "the wandering inn universe": "Innworld",
  "dothack": "DotHack",
  ".hack": "DotHack",
  "dot hack": "DotHack",
  "dot-hack": "DotHack",
  "dothack universe": "DotHack"
};

/**
 * The owner's PINNED spellings — aliases whose answer is a recorded decision
 * rather than a preference. Carried so the Worker's refusal wording can say
 * "that is a spelling of X" with the same authority `tools/universes.mjs canon`
 * has locally.
 */
export const PINNED_CANONICAL_NAMES: Readonly<Record<string, string>> = {
  "cosmere": "The Cosmere",
  "arand multiverse": "Runnerverse"
};
