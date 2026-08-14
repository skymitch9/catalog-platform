/**
 * The shared universe list, imported from this repo's own `data/` at build
 * time and indexed once at module load.
 *
 * ⚠️ This Worker is the one consumer that reads `data/universes.json` from
 * home — the two book catalogs materialise gitignored copies at build time
 * because a bundler needs a static path across repos. Here the static path is
 * simply the file. The editor is still `node tools/universes.mjs`; nothing in
 * this app writes to the list.
 */

import document from '../../../data/universes.json' with { type: 'json' };
import { buildUniverseIndex, type UniverseIndex, type UniversesDocument } from './universes.js';

/** ⚠️ Bump in lockstep with `schemaVersion` in the data file. */
export const EXPECTED_SCHEMA_VERSION = 1;

export const universesDocument = document as unknown as UniversesDocument;

if (universesDocument.schemaVersion !== EXPECTED_SCHEMA_VERSION) {
  throw new Error(
    `data/universes.json is schemaVersion ${universesDocument.schemaVersion}, this Worker expects ${EXPECTED_SCHEMA_VERSION}`,
  );
}

export const universeIndex: UniverseIndex = buildUniverseIndex(universesDocument);
