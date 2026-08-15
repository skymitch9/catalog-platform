// tools/lib/series-canon.mjs
//
// The reference implementation for data/series-canon.json: load, normalise,
// fold, validate, and the one mutation the CLI performs. Zero dependencies,
// mirroring tools/lib/universes.mjs deliberately — same shape, same
// normalisation, same "every edit needs a reason" rule — because the two files
// solve adjacent problems (series identity vs. universe membership) and a
// reader who has learned one should not have to relearn the other.
//
// ⚠️ THIS FILE IS A CODE DEPENDENCY OF library_catalog, which reads the fold
// live from the sibling checkout in scripts/lib/series-canon.mjs (its own
// small file, not this one — there is no shared JS runtime across repos).
// audiobook_catalog reads it only through `python -m app.tools.sync_series_canon`,
// which merges these entries into its OWN corrections layer once and does not
// read this file again until the next sync.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(HERE, '..', '..');
export const DATA_PATH = join(REPO_ROOT, 'data', 'series-canon.json');

export const SCHEMA_VERSION = 1;
export const DECIDED_HOW = ['seed', 'llm', 'human'];

/* ------------------------------------------------------------------ *
 * Normalisation — identical fold to tools/lib/universes.mjs normText.
 * One estate rule for comparing names, not a second one drifting from it.
 * ------------------------------------------------------------------ */

export function normText(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/[‘’ʼ′]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export class SeriesCanonError extends Error {}

export function load(path = DATA_PATH) {
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    throw new SeriesCanonError(`Cannot read the series canon at ${path}: ${err.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new SeriesCanonError(`${path} is not valid JSON: ${err.message}`);
  }
}

export function save(data, path = DATA_PATH) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

/** Build a flat normalised-variant -> canonical map, including each canonical onto itself. */
export function buildIndex(data) {
  const map = new Map();
  for (const entry of data.entries ?? []) {
    if (!entry.canonical) continue;
    for (const variant of [...(entry.variants ?? []), entry.canonical]) {
      map.set(normText(variant), entry.canonical);
    }
  }
  return map;
}

/**
 * Fold a series name onto its canonical spelling.
 *
 * ⚠️ Unlike universes.json canonicalName(), an UNKNOWN name is returned
 * UNCHANGED, not null. A series with no cross-catalog drift is still a series,
 * correctly spelled, and the fold must hand it back rather than erase it.
 */
export function canonicalFor(data, name) {
  if (!name) return name;
  const map = data._index ?? buildIndex(data);
  return map.get(normText(name)) ?? name;
}

/* ------------------------------------------------------------------ *
 * Validation
 * ------------------------------------------------------------------ */

const err = (code, message) => ({ level: 'error', code, message });
const warn = (code, message) => ({ level: 'warn', code, message });

export function validate(data) {
  const out = [];
  if (data.schemaVersion !== SCHEMA_VERSION) {
    out.push(err('SCHEMA_VERSION', `schemaVersion is ${JSON.stringify(data.schemaVersion)}, expected ${SCHEMA_VERSION}`));
  }
  const entries = data.entries;
  if (!Array.isArray(entries)) {
    out.push(err('NO_ENTRIES', '`entries` is missing or not an array'));
    return out;
  }

  const variantOwner = new Map(); // normalised variant -> [canonical names it was claimed by]
  const canonSeen = new Set();

  for (const [i, entry] of entries.entries()) {
    const label = entry?.canonical ?? `entries[${i}]`;
    if (!entry.canonical || typeof entry.canonical !== 'string') {
      out.push(err('ENTRY_NO_CANONICAL', `entries[${i}] has no canonical spelling`));
      continue;
    }
    const canonKey = normText(entry.canonical);
    if (canonSeen.has(canonKey)) out.push(err('DUPLICATE_CANONICAL', `"${entry.canonical}" is the canonical spelling of two entries`));
    canonSeen.add(canonKey);

    if (!DECIDED_HOW.includes(entry.decidedHow)) {
      out.push(err('BAD_DECIDED_HOW', `${label}: decidedHow is ${JSON.stringify(entry.decidedHow)}, expected one of ${DECIDED_HOW.join(' / ')}`));
    }
    if (typeof entry.evidence !== 'string' || !entry.evidence.trim()) {
      out.push(err('ENTRY_NO_EVIDENCE', `${label}: no evidence — an unexplained fold is indistinguishable from a typo`));
    }

    const variants = entry.variants ?? [];
    if (!Array.isArray(variants) || variants.length === 0) {
      out.push(err('ENTRY_NO_VARIANTS', `${label}: no variants — an entry that folds nothing documents nothing`));
      continue;
    }
    const allSpellings = new Set([...variants, entry.canonical].map(normText));
    if (allSpellings.size < 2) {
      out.push(warn('ENTRY_TRIVIAL', `${label}: every variant normalises the same as the canonical spelling — this entry folds nothing real`));
    }

    for (const v of [...variants, entry.canonical]) {
      const k = normText(v);
      if (!variantOwner.has(k)) variantOwner.set(k, []);
      variantOwner.get(k).push(entry.canonical);
    }
  }

  for (const [k, owners] of variantOwner) {
    const distinctOwners = [...new Set(owners)];
    if (distinctOwners.length > 1) {
      out.push(err('VARIANT_CLAIMED_TWICE', `spelling "${k}" is claimed by both ${distinctOwners.join(' and ')}`));
    }
  }

  return out;
}

/* ------------------------------------------------------------------ *
 * Mutation — the CLI's `add` command. One mutation, same reason
 * requirement as tools/lib/universes.mjs.
 * ------------------------------------------------------------------ */

function requireReason(why) {
  const text = typeof why === 'string' ? why.trim() : '';
  if (text.length < 10) {
    throw new SeriesCanonError(
      'Adding a fold needs a reason of at least 10 characters (--why "...").\n' +
        'Every existing entry in this file records its evidence. The edit is refused.'
    );
  }
  return text;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Add a variant spelling to an entry, creating the entry if `canonical` is new.
 * Refuses a variant already claimed by a DIFFERENT canonical — remove it there
 * first, same rule as universes.mjs add-series.
 */
export function addVariant(data, { canonical, variant, why, decidedHow = 'human' }) {
  const reason = requireReason(why);
  if (!DECIDED_HOW.includes(decidedHow)) {
    throw new SeriesCanonError(`--decided-how must be one of ${DECIDED_HOW.join(' / ')}`);
  }
  if (!canonical || !variant) throw new SeriesCanonError('add needs --canonical and --variant');

  const vKey = normText(variant);
  data.entries = data.entries ?? [];
  for (const entry of data.entries) {
    const claimed = new Set([entry.canonical, ...(entry.variants ?? [])].map(normText));
    if (claimed.has(vKey) && normText(entry.canonical) !== normText(canonical)) {
      throw new SeriesCanonError(`"${variant}" is already a variant of "${entry.canonical}". Remove it there first, with a reason.`);
    }
  }

  let entry = data.entries.find((e) => normText(e.canonical) === normText(canonical));
  if (!entry) {
    entry = { canonical, variants: [], evidence: reason, decidedHow };
    data.entries.push(entry);
  }
  entry.variants = entry.variants ?? [];
  if (!entry.variants.some((v) => normText(v) === vKey) && normText(canonical) !== vKey) {
    entry.variants.push(variant);
  }

  data._changelog = data._changelog ?? [];
  data._changelog.push({ date: today(), action: 'add-variant', canonical: entry.canonical, variant, why: reason, decidedHow });
  return `"${variant}" now folds to "${entry.canonical}".`;
}
