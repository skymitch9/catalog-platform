// tools/lib/universes.mjs
//
// The reference implementation for data/universes.json: load, normalise, look
// up, validate, and the mutations the CLI performs. Zero dependencies, so
// `node tools/universes.mjs` works in a fresh checkout with no install.
//
// ⚠️ THIS FILE IS A CODE DEPENDENCY OF TWO OTHER REPOS. library_catalog reads
// the data through it at build time and shells out to the CLI's `validate`;
// audiobook_catalog reimplements the *lookup* in Python (app/core/universes.py)
// because a Python static build cannot call into Node. The two lookups are kept
// honest by data/universes.fixtures.json, which both run. If you change the
// resolution order here, change it there, and change `_lookup.order` in the
// data file that documents it.
//
// tools/universes.mjs is the entry point and stays thin; every decision is here.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(HERE, '..', '..');
export const DATA_PATH = join(REPO_ROOT, 'data', 'universes.json');
export const FIXTURES_PATH = join(REPO_ROOT, 'data', 'universes.fixtures.json');

export const SCHEMA_VERSION = 1;
export const DECIDED_HOW = ['seed', 'llm', 'human'];

/* ------------------------------------------------------------------ *
 * Normalisation
 * ------------------------------------------------------------------ */

/**
 * Lowercase, fold curly quotes to straight, collapse whitespace, trim.
 *
 * ⚠️ The curly-apostrophe fold is load-bearing and not cosmetic. The audiobook
 * catalog stores "The Frugal Wizard’s Handbook..." with U+2019, and that
 * row is the single exclusion proving a series-level mapping cannot work. Miss
 * the fold and the one row the design rests on silently resolves to Cosmere.
 */
export function normText(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/[‘’ʼ′]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/* ------------------------------------------------------------------ *
 * Loading
 * ------------------------------------------------------------------ */

export class UniversesError extends Error {}

/** Read and parse the data file. Malformed JSON throws with the path in the message. */
export function load(path = DATA_PATH) {
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    throw new UniversesError(`Cannot read the universe list at ${path}: ${err.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new UniversesError(`${path} is not valid JSON: ${err.message}`);
  }
}

export function loadFixtures(path = FIXTURES_PATH) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new UniversesError(`Cannot read the fixtures at ${path}: ${err.message}`);
  }
}

/** Write the file back, pretty-printed, with a trailing newline. */
export function save(data, path = DATA_PATH) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

/* ------------------------------------------------------------------ *
 * Lookup
 * ------------------------------------------------------------------ */

/**
 * Build the in-memory index. Six universes and ~50 keys, so this is a handful
 * of Maps and nothing needs a database.
 */
export function buildIndex(data) {
  const series = new Map();
  const overrideTitles = new Map();
  const excludedTitles = new Map();
  const notSeries = new Map();

  for (const u of data.universes ?? []) {
    for (const s of u.series ?? []) series.set(normText(s), u.name);
    for (const s of u.notSeries ?? []) {
      const k = normText(s);
      if (!notSeries.has(k)) notSeries.set(k, []);
      notSeries.get(k).push(u.name);
    }
    for (const b of u.bookOverrides ?? []) overrideTitles.set(normText(b.title), u.name);
    for (const b of u.bookExclusions ?? []) excludedTitles.set(normText(b.title), u.name);
  }
  return { series, overrideTitles, excludedTitles, notSeries };
}

/**
 * Resolve one catalog row to a universe name, or null.
 *
 * The order is fixed by data/universes.json `_lookup.order` and pinned by the
 * fixtures. Exclusions FIRST, so the answer never depends on which rule fires.
 */
export function universeFor(index, { title, series } = {}) {
  const t = normText(title);
  if (t && index.excludedTitles.has(t)) return null;
  if (t && index.overrideTitles.has(t)) return index.overrideTitles.get(t);
  const s = normText(series);
  if (s && index.series.has(s)) return index.series.get(s);
  return null;
}

/** Fold an alias onto the owner's spelling. Unknown names return null — never a guess. */
export function canonicalName(data, name) {
  const map = data.canonicalNames ?? {};
  const hit = map[normText(name)];
  return typeof hit === 'string' ? hit : null;
}

/** Find a universe by any registered spelling. Throws if it is not one. */
export function findUniverse(data, name) {
  const canon = canonicalName(data, name);
  if (!canon) {
    const known = (data.universes ?? []).map((u) => u.name).join(', ');
    throw new UniversesError(
      `"${name}" is not a known universe name. Known: ${known}.\n` +
        `If it is a new spelling of an existing one, add it to canonicalNames with a reason.\n` +
        `If it is a genuinely new universe, this CLI does not create universes — that is an owner decision, ` +
        `made in the file with its evidence, then validated.`
    );
  }
  const u = (data.universes ?? []).find((x) => x.name === canon);
  if (!u) throw new UniversesError(`canonicalNames maps "${name}" to "${canon}", which is not a universe. Run validate.`);
  return u;
}

/* ------------------------------------------------------------------ *
 * Validation
 * ------------------------------------------------------------------ */

const err = (code, message) => ({ level: 'error', code, message });
const warn = (code, message) => ({ level: 'warn', code, message });

/**
 * Every structural rule this file has to obey. Returns a flat list of findings;
 * the caller decides how loud to be. Nothing here reaches the network or a
 * database — it is a pure function of the parsed document.
 */
export function validate(data) {
  const out = [];
  const universes = data.universes ?? [];

  if (data.schemaVersion !== SCHEMA_VERSION) {
    out.push(err('SCHEMA_VERSION', `schemaVersion is ${JSON.stringify(data.schemaVersion)}, expected ${SCHEMA_VERSION}`));
  }
  if (!Array.isArray(universes) || universes.length === 0) {
    out.push(err('NO_UNIVERSES', '`universes` is missing or empty'));
    return out;
  }

  const canonMap = data.canonicalNames ?? {};
  const canonEntries = Object.entries(canonMap).filter(([k]) => !k.startsWith('_'));
  const canonTargets = new Set(canonEntries.map(([, v]) => v));
  const realNames = new Set(universes.map((u) => u.name));

  // canonicalNames hygiene ------------------------------------------------
  for (const [key, target] of canonEntries) {
    if (key !== normText(key)) {
      out.push(err('CANON_KEY_NOT_NORMALISED', `canonicalNames key "${key}" is not normalised — it should be "${normText(key)}"`));
    }
    if (typeof target !== 'string' || !realNames.has(target)) {
      out.push(err('CANON_TARGET_UNKNOWN', `canonicalNames["${key}"] points at "${target}", which is not a universe name`));
      continue;
    }
    if (canonMap[normText(target)] !== target) {
      out.push(
        err(
          'CANON_TARGET_NOT_SELF_CANONICAL',
          `canonicalNames["${key}"] → "${target}", but "${target}" does not map to itself. Every canonical name must be registered under its own normalised spelling.`
        )
      );
    }
  }

  // ⚠️ The owner's pinned spellings, asserted as answers rather than as map
  // hygiene. A consistent rename would satisfy every check above and still
  // reverse the decision; this is the check that does not let it.
  for (const [alias, want] of Object.entries(data._pinnedCanonicalNames ?? {})) {
    if (alias.startsWith('_')) continue;
    const got = canonicalName(data, alias);
    if (got !== want) {
      out.push(
        err(
          'PINNED_NAME_BROKEN',
          `"${alias}" must resolve to "${want}" and resolves to ${JSON.stringify(got)}. This is an owner decision recorded in _pinnedCanonicalNames, not a preference.`
        )
      );
    }
  }

  // Universe-level ---------------------------------------------------------
  const seenNames = new Map();
  const seriesOwner = new Map(); // normalised series → [universe names]
  const overrideOwner = new Map(); // normalised title → [universe names]
  const exclusionOwner = new Map(); // normalised title → [universe names]

  for (const u of universes) {
    const label = u.name ?? '(unnamed)';
    if (!u.name || typeof u.name !== 'string') {
      out.push(err('UNIVERSE_NO_NAME', 'a universe has no name'));
      continue;
    }
    const key = normText(u.name);
    if (seenNames.has(key)) {
      out.push(err('DUPLICATE_UNIVERSE', `"${u.name}" and "${seenNames.get(key)}" are the same universe under two spellings`));
    }
    seenNames.set(key, u.name);

    if (!canonTargets.has(u.name)) {
      out.push(
        err(
          'UNIVERSE_NOT_CANONICAL',
          `"${u.name}" is not registered in canonicalNames. Every universe must appear there as a canonical target, or an alias can never fold onto it.`
        )
      );
    } else if (canonMap[key] !== u.name) {
      out.push(
        err(
          'UNIVERSE_NAME_NOT_CANONICAL',
          `"${u.name}" normalises to "${key}", which canonicalNames folds onto "${canonMap[key]}". The owner's spelling wins — rename the universe or fix the map.`
        )
      );
    }

    if (!DECIDED_HOW.includes(u.decidedHow)) {
      out.push(err('BAD_DECIDED_HOW', `${label}: decidedHow is ${JSON.stringify(u.decidedHow)}, expected one of ${DECIDED_HOW.join(' / ')}`));
    }

    const seriesSeen = new Set();
    for (const s of u.series ?? []) {
      const k = normText(s);
      if (seriesSeen.has(k)) out.push(err('DUPLICATE_SERIES_IN_UNIVERSE', `${label}: "${s}" is listed twice`));
      seriesSeen.add(k);
      if (!seriesOwner.has(k)) seriesOwner.set(k, []);
      seriesOwner.get(k).push(u.name);
    }
    for (const s of u.notSeries ?? []) {
      if (seriesSeen.has(normText(s))) {
        out.push(err('SERIES_IN_AND_OUT', `${label}: "${s}" is in both series and notSeries — the entry contradicts itself`));
      }
    }

    for (const [field, sink] of [['bookOverrides', overrideOwner], ['bookExclusions', exclusionOwner]]) {
      const titlesSeen = new Set();
      for (const b of u[field] ?? []) {
        if (!b || typeof b.title !== 'string' || !b.title.trim()) {
          out.push(err('BOOK_NO_TITLE', `${label}: a ${field} entry has no title`));
          continue;
        }
        if (typeof b.why !== 'string' || !b.why.trim()) {
          out.push(
            err(
              'BOOK_NO_REASON',
              `${label}: ${field} "${b.title}" carries no \`why\`. An unexplained mapping is indistinguishable from a typo, which is the one thing this file exists to prevent.`
            )
          );
        }
        const k = normText(b.title);
        if (titlesSeen.has(k)) out.push(err('DUPLICATE_BOOK_IN_UNIVERSE', `${label}: ${field} lists "${b.title}" twice`));
        titlesSeen.add(k);
        if (!sink.has(k)) sink.set(k, []);
        sink.get(k).push(u.name);
      }
    }

    if ((u.series ?? []).length === 0 && (u.bookOverrides ?? []).length === 0) {
      out.push(warn('EMPTY_UNIVERSE', `${label}: no series and no book overrides — it claims nothing`));
    }
  }

  // Cross-universe collisions ---------------------------------------------
  for (const [k, owners] of seriesOwner) {
    if (owners.length > 1) {
      out.push(err('SERIES_CLAIMED_TWICE', `series "${k}" is claimed by ${owners.join(' and ')} — a series belongs to at most one universe`));
    }
  }
  for (const [k, owners] of overrideOwner) {
    if (owners.length > 1) out.push(err('BOOK_CLAIMED_TWICE', `book "${k}" is claimed by ${owners.join(' and ')}`));
  }
  for (const [k, owners] of exclusionOwner) {
    if (overrideOwner.has(k)) {
      out.push(
        err(
          'BOOK_IN_AND_OUT',
          `book "${k}" is a bookOverride of ${overrideOwner.get(k).join('/')} and a bookExclusion of ${owners.join('/')} — included and excluded at once`
        )
      );
    }
  }

  // Refusals ---------------------------------------------------------------
  for (const r of data._refused ?? []) {
    const who = r.subject ?? '(no subject)';
    for (const field of ['subject', 'decision', 'why']) {
      if (typeof r[field] !== 'string' || !r[field].trim()) out.push(err('REFUSAL_INCOMPLETE', `_refused "${who}": missing ${field}`));
    }
    if (!DECIDED_HOW.includes(r.decidedHow)) {
      out.push(err('REFUSAL_BAD_DECIDED_HOW', `_refused "${who}": decidedHow is ${JSON.stringify(r.decidedHow)}`));
    }
    for (const s of r.heldOutSeries ?? []) {
      const k = normText(s);
      if (seriesOwner.has(k)) {
        out.push(
          err(
            'HELD_OUT_SERIES_IN_USE',
            `series "${s}" is held out by _refused "${who}" and also claimed by ${seriesOwner.get(k).join('/')}. A refusal is a decision; swept-in is exactly what it forbids.`
          )
        );
      }
    }
    for (const t of r.heldOutTitles ?? []) {
      const k = normText(t);
      if (overrideOwner.has(k)) {
        out.push(err('HELD_OUT_TITLE_IN_USE', `title "${t}" is held out by _refused "${who}" and also a bookOverride of ${overrideOwner.get(k).join('/')}`));
      }
    }
  }

  return out;
}

/** Run data/universes.fixtures.json against this implementation. */
export function runFixtures(data, fixtures) {
  const index = buildIndex(data);
  const failures = [];
  let passed = 0;

  for (const c of fixtures.cases ?? []) {
    const got = universeFor(index, { title: c.title, series: c.series });
    const want = c.expect ?? null;
    if (got === want) passed += 1;
    else failures.push(`${c.name}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
  }
  for (const c of fixtures.canonicalNameCases ?? []) {
    const got = canonicalName(data, c.input);
    const want = c.expect ?? null;
    if (got === want) passed += 1;
    else failures.push(`canonicalName(${JSON.stringify(c.input)}): expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
  }
  return { passed, failures };
}

/* ------------------------------------------------------------------ *
 * Mutations
 *
 * ⚠️ Every one of these takes a mandatory `why`. That is the whole reason this
 * CLI exists rather than a text editor: an edit that cannot say why it happened
 * is refused, not accepted with a blank field.
 * ------------------------------------------------------------------ */

function requireReason(why, what) {
  const text = typeof why === 'string' ? why.trim() : '';
  if (text.length < 10) {
    throw new UniversesError(
      `${what} needs a reason of at least 10 characters (--why "...").\n` +
        `Every existing entry in this file records its evidence. An unexplained mapping is\n` +
        `indistinguishable from a typo, and nobody ever re-checks one. The edit is refused.`
    );
  }
  return text;
}

function requireDecidedHow(how) {
  if (!DECIDED_HOW.includes(how)) {
    throw new UniversesError(`--decided-how must be one of ${DECIDED_HOW.join(' / ')} (got ${JSON.stringify(how)})`);
  }
  return how;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

/** Append to the in-file audit trail, so a removal leaves a reason behind. */
function logChange(data, entry) {
  if (!Array.isArray(data._changelog)) {
    data._changelogDoc =
      data._changelogDoc ??
      'Every mutation made through tools/universes.mjs, newest last. Git records WHAT changed; this records WHY a thing was removed, which a deleted line cannot.';
    data._changelog = [];
  }
  data._changelog.push({ date: today(), ...entry });
}

/**
 * CREATE A UNIVERSE — the seventeenth-and-onward decision, made through the
 * tool instead of by hand.
 *
 * ⚠️ THIS CLI REFUSED TO HAVE THIS COMMAND, IN WRITING, FOR MOST OF ITS LIFE:
 * *"a seventh is a decision to make in the file, with its evidence, not a
 * command to run."* Read as an argument about DECISIONS that was exactly right.
 * Read as an argument about SYNTAX it failed, and syntax is what it became —
 * there are seventeen universes now, not six, so the file has been hand-edited
 * eleven times, and a hand edit is the ONE path with no `--why` enforcement, no
 * canonicalNames registration and no `validate` gate in front of it. The
 * refusal was protecting the decision; it ended up protecting the text editor.
 *
 * 🔴 SO THIS IS STRICTER THAN THE HAND EDIT IT REPLACES, NEVER LOOSER:
 *   --why        the reason, ≥10 chars — the same floor every mutation here has
 *   --confirmed  ⚠️ REQUIRED, and required by NOTHING ELSE in this file. It is
 *                the owner's own words, landing in the field the data file
 *                already reserves for sign-off. Every existing universe carries
 *                one; a hand edit could simply omit it.
 * and the write still goes through `saveChecked()`, so `validate()` runs before
 * anything reaches disk.
 *
 * ⚠️ IT REGISTERS THE NAME IN `canonicalNames` IN THE SAME BREATH. A universe
 * that is not a canonical target can never have an alias folded onto it —
 * `validate()` errors UNIVERSE_NOT_CANONICAL for exactly that — and it is the
 * step a hand edit forgets, because the file's shape does not make it obvious.
 *
 * ⚠️ WHAT THIS STILL CANNOT DO, AND MUST NOT: make the verse real. The tripwire
 * in library_catalog/packages/core/test/universes.test.ts will now FAIL, which
 * is that test working — it is the thing standing between this file and two
 * catalogs that disagree with it. Editing it in the same commit is the intended
 * workflow; the returned message says so, because the next person to run this
 * will meet a red suite ten minutes later and should already know why.
 */
export function createUniverse(data, { name, why, confirmed, evidence, decidedHow = 'human' }) {
  const reason = requireReason(why, 'Creating a universe');
  requireDecidedHow(decidedHow);

  const label = typeof name === 'string' ? name.trim() : '';
  if (!label) throw new UniversesError('create needs a universe name');

  const sign = typeof confirmed === 'string' ? confirmed.trim() : '';
  if (sign.length < 10) {
    throw new UniversesError(
      `Creating a universe needs --confirmed "<the owner's own words>" (at least 10 characters).\n` +
        `Every universe in this file carries a \`confirmed\` field recording who said yes and in what words.\n` +
        `That is the difference between a decision and a typo, and it is the one thing a hand edit of the\n` +
        `JSON could always skip. This command exists to make skipping it impossible, so the edit is refused.`
    );
  }

  const key = normText(label);
  const existing = canonicalName(data, label);
  if (existing) {
    throw new UniversesError(
      existing === label
        ? `"${label}" already exists.`
        : `"${label}" is a registered spelling of ${existing} — the estate already has that universe under\n` +
          `that name. If this is genuinely a different fiction, choose a name that is not one of its aliases;\n` +
          `if it is the same one, there is nothing to create.`
    );
  }
  for (const u of data.universes ?? []) {
    if (normText(u.name) === key) {
      throw new UniversesError(`"${label}" already exists as ${u.name} (and is missing from canonicalNames — run validate).`);
    }
  }

  const entry = { name: label, decidedHow, confirmed: sign, why: reason };
  if (typeof evidence === 'string' && evidence.trim()) entry.evidence = evidence.trim();
  entry.series = [];

  data.universes = data.universes ?? [];
  data.universes.push(entry);
  data.canonicalNames = data.canonicalNames ?? {};
  data.canonicalNames[key] = label;

  logChange(data, { action: 'create', universe: label, why: reason, confirmed: sign, decidedHow });

  return (
    `Created "${label}". It claims nothing yet — validate will warn EMPTY_UNIVERSE until it does.\n` +
    `  Next:   node tools/universes.mjs add-series "${label}" --series "<a series>" --why "${reason}"\n` +
    `  ⚠️ Then: library_catalog/packages/core/test/universes.test.ts pins the list of universe names and\n` +
    `          their counts. It will FAIL until you add "${label}" there in the same commit — that test\n` +
    `          failing is it working, and it is what stops a universe existing here and nowhere else.`
  );
}

export function addSeries(data, { universe, series, why, decidedHow = 'human' }) {
  const reason = requireReason(why, 'Adding a series');
  requireDecidedHow(decidedHow);
  const u = findUniverse(data, universe);
  const k = normText(series);
  if (!k) throw new UniversesError('--series must not be empty');

  for (const other of data.universes) {
    if ((other.series ?? []).some((s) => normText(s) === k)) {
      throw new UniversesError(`"${series}" is already claimed by ${other.name}. Remove it there first, with a reason.`);
    }
  }
  for (const r of data._refused ?? []) {
    if ((r.heldOutSeries ?? []).some((s) => normText(s) === k)) {
      throw new UniversesError(
        `"${series}" is held out by _refused "${r.subject}".\n` +
          `Use \`restore\` to bring it back — that removes the refusal and records why it was overturned,\n` +
          `rather than leaving a refusal in the file that the data silently contradicts.`
      );
    }
  }

  u.series = u.series ?? [];
  u.series.push(series);
  logChange(data, { action: 'add-series', universe: u.name, series, why: reason, decidedHow });
  return `Added series "${series}" to ${u.name}.`;
}

export function removeSeries(data, { universe, series, why }) {
  const reason = requireReason(why, 'Removing a series');
  const u = findUniverse(data, universe);
  const k = normText(series);
  const before = (u.series ?? []).length;
  u.series = (u.series ?? []).filter((s) => normText(s) !== k);
  if (u.series.length === before) throw new UniversesError(`${u.name} does not list a series "${series}".`);
  logChange(data, { action: 'remove-series', universe: u.name, series, why: reason });
  return `Removed series "${series}" from ${u.name}. ⚠️ It is now in NO universe and NOT held out — use \`hold-out\` if it is pending verification.`;
}

export function addBook(data, { universe, title, why, exclude = false, decidedHow = 'human' }) {
  const reason = requireReason(why, exclude ? 'Excluding a book' : 'Adding a book override');
  requireDecidedHow(decidedHow);
  const u = findUniverse(data, universe);
  const k = normText(title);
  if (!k) throw new UniversesError('--title must not be empty');

  for (const other of data.universes) {
    for (const field of ['bookOverrides', 'bookExclusions']) {
      if ((other[field] ?? []).some((b) => normText(b.title) === k)) {
        throw new UniversesError(`"${title}" is already listed in ${other.name} ${field}. Remove it there first, with a reason.`);
      }
    }
  }

  const field = exclude ? 'bookExclusions' : 'bookOverrides';
  u[field] = u[field] ?? [];
  u[field].push({ title, why: reason });
  logChange(data, { action: exclude ? 'exclude-book' : 'add-book', universe: u.name, title, why: reason, decidedHow });
  return `Added "${title}" to ${u.name} ${field}.`;
}

export function removeBook(data, { universe, title, why, exclude = false }) {
  const reason = requireReason(why, 'Removing a book entry');
  const u = findUniverse(data, universe);
  const field = exclude ? 'bookExclusions' : 'bookOverrides';
  const k = normText(title);
  const before = (u[field] ?? []).length;
  u[field] = (u[field] ?? []).filter((b) => normText(b.title) !== k);
  if (u[field].length === before) throw new UniversesError(`${u.name} ${field} does not list "${title}".`);
  logChange(data, { action: exclude ? 'unexclude-book' : 'remove-book', universe: u.name, title, why: reason });
  return `Removed "${title}" from ${u.name} ${field}.`;
}

/**
 * Move a series or a title out of every universe and into `_refused`.
 * This is the "pending verification" path — the one the owner used five times.
 */
export function holdOut(data, { series, title, why, subject, decidedHow = 'human' }) {
  const reason = requireReason(why, 'Holding something out');
  requireDecidedHow(decidedHow);
  if (!series && !title) throw new UniversesError('hold-out needs --series or --title');
  if (series && title) throw new UniversesError('hold-out takes --series or --title, not both');

  const value = series ?? title;
  const k = normText(value);
  const removedFrom = [];

  for (const u of data.universes) {
    if (series) {
      const before = (u.series ?? []).length;
      u.series = (u.series ?? []).filter((s) => normText(s) !== k);
      if (u.series.length !== before) removedFrom.push(`${u.name}.series`);
    } else {
      for (const field of ['bookOverrides', 'bookExclusions']) {
        const before = (u[field] ?? []).length;
        u[field] = (u[field] ?? []).filter((b) => normText(b.title) !== k);
        if ((u[field] ?? []).length !== before) removedFrom.push(`${u.name}.${field}`);
      }
    }
  }

  data._refused = data._refused ?? [];
  const existing = data._refused.find((r) => normText(r.subject) === normText(subject ?? value));
  if (existing) {
    const list = series ? 'heldOutSeries' : 'heldOutTitles';
    existing[list] = existing[list] ?? [];
    if (!existing[list].some((x) => normText(x) === k)) existing[list].push(value);
    existing.why = `${existing.why} — ${today()}: ${reason}`;
  } else {
    const entry = {
      subject: subject ?? value,
      decidedHow,
      decision: 'LEAVE OUT until verified',
      why: reason,
    };
    if (series) entry.heldOutSeries = [value];
    else entry.heldOutTitles = [value];
    data._refused.push(entry);
  }

  logChange(data, { action: 'hold-out', [series ? 'series' : 'title']: value, removedFrom, why: reason, decidedHow });
  return removedFrom.length
    ? `Held out "${value}"; removed from ${removedFrom.join(', ')}.`
    : `Held out "${value}". It was in no universe already — the refusal is now recorded rather than implied.`;
}

/** Bring a held-out series or title back into a universe. The reverse of hold-out. */
export function restore(data, { universe, series, title, why, decidedHow = 'human' }) {
  const reason = requireReason(why, 'Restoring a held-out entry');
  requireDecidedHow(decidedHow);
  if (!series && !title) throw new UniversesError('restore needs --series or --title');
  if (series && title) throw new UniversesError('restore takes --series or --title, not both');

  const value = series ?? title;
  const k = normText(value);
  const u = findUniverse(data, universe);

  const touched = [];
  for (const r of data._refused ?? []) {
    let hit = false;
    for (const list of ['heldOutSeries', 'heldOutTitles']) {
      const before = (r[list] ?? []).length;
      if (before) {
        r[list] = r[list].filter((x) => normText(x) !== k);
        if (r[list].length !== before) hit = true;
        if (r[list].length === 0) delete r[list];
      }
    }
    if (hit) touched.push(r);
  }
  if (!touched.length) {
    throw new UniversesError(
      `"${value}" is not held out by any _refused entry.\n` +
        `If it is simply new, use add-series / add-book instead. \`restore\` exists to overturn a\n` +
        `recorded refusal, and overturning one that does not exist would hide that fact.`
    );
  }

  // ⚠️ A refusal that no longer holds anything out must SAY it was overturned.
  // Leaving it reading "LEAVE OUT until verified" with nothing held out is a
  // zombie decision — the file would assert a refusal the data contradicts, and
  // the next reader has no way to tell which one is current.
  for (const r of touched) {
    const stillHolds = (r.heldOutSeries ?? []).length + (r.heldOutTitles ?? []).length;
    r.overturned = stillHolds
      ? `${today()}: "${value}" restored into ${u.name} — ${reason} (the rest of this refusal still stands)`
      : `${today()}: fully overturned — "${value}" restored into ${u.name}. ${reason}`;
  }

  if (series) {
    u.series = u.series ?? [];
    u.series.push(value);
  } else {
    u.bookOverrides = u.bookOverrides ?? [];
    u.bookOverrides.push({ title: value, why: reason });
  }

  logChange(data, { action: 'restore', universe: u.name, [series ? 'series' : 'title']: value, why: reason, decidedHow });
  return `Restored "${value}" into ${u.name}.`;
}
