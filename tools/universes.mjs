#!/usr/bin/env node
// tools/universes.mjs
//
// The LOCAL editor for data/universes.json. Deliberately a CLI and not a web UI:
// a browser cannot commit to a git repo, and the value of this file is that
// every decision is version-controlled with its reasoning. A web editor would
// need a second representation of the list, and two representations drift —
// which is the failure this whole design exists to avoid.
//
// Thin on purpose. Argument parsing and printing live here; every decision is
// in tools/lib/universes.mjs.
//
//   node tools/universes.mjs                       # this help
//   node tools/universes.mjs list
//   node tools/universes.mjs show "Cosmere"
//   node tools/universes.mjs who --title "Tress of the Emerald Sea"
//   node tools/universes.mjs validate
//   node tools/universes.mjs fixtures
//
// Every mutating command requires --why. That is not a nicety; an entry that
// cannot say why it exists is refused.

import {
  DATA_PATH,
  UniversesError,
  addBook,
  addSeries,
  buildIndex,
  canonicalName,
  findUniverse,
  holdOut,
  load,
  loadFixtures,
  removeBook,
  removeSeries,
  restore,
  runFixtures,
  save,
  universeFor,
  validate,
} from './lib/universes.mjs';

/* ------------------------------ arguments ------------------------------ */

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const name = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) flags[name] = true;
      else {
        flags[name] = next;
        i += 1;
      }
    } else positional.push(a);
  }
  return { positional, flags };
}

const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
const flag = (flags, name) => flags[name] ?? flags[camel(name)];

/* -------------------------------- output -------------------------------- */

const out = (...args) => console.log(...args);

function printFindings(findings) {
  const errors = findings.filter((f) => f.level === 'error');
  const warns = findings.filter((f) => f.level === 'warn');
  for (const f of errors) out(`  ERROR  [${f.code}] ${f.message}`);
  for (const f of warns) out(`  warn   [${f.code}] ${f.message}`);
  return errors.length;
}

/** Never write a file that would not pass validation. */
function saveChecked(data, message, { dryRun }) {
  const findings = validate(data);
  const errors = findings.filter((f) => f.level === 'error');
  if (errors.length) {
    out('The edit would leave the file invalid, so nothing was written:');
    printFindings(errors);
    process.exitCode = 1;
    return;
  }
  if (dryRun) {
    out(`[dry run] ${message}`);
    out(`[dry run] ${DATA_PATH} unchanged.`);
    return;
  }
  save(data);
  out(message);
  out(`Wrote ${DATA_PATH}. Commit it: git commit -F <message-file>  (never -m on Windows).`);
}

/* ------------------------------- commands ------------------------------- */

// ⚠️ HELP is a FUNCTION, not a constant, because it quotes a COUNT — and a
// hardcoded count goes stale silently. It said "Six exist" from the day it was
// written until 2026-08-26, by which time there were seventeen; the help text
// was the last place anybody thought to look. Derive every number that has a
// live source, or do not print it.
//
// The count is read defensively: help must work when the data file is missing
// or malformed, because "the CLI cannot even print help" is the worst possible
// way to learn that data/universes.json is broken. When it cannot be read the
// sentence simply drops the number instead of guessing one.
function helpText() {
  let existing = 'The universes that exist each carry';
  try {
    const n = load().universes.length;
    if (Number.isInteger(n) && n > 0) existing = `${n} exist, each with`;
  } catch {
    /* fall through to the number-free wording */
  }
  return `
The shared universe list — local editor.

  data/universes.json is the ONE copy. library_catalog and audiobook_catalog
  both read it; neither keeps its own. Edits happen here so the reason for each
  one lands in git alongside the change.

READING
  list                                  every universe, with what it claims
  show <universe>                       one universe in full, including refusals
  who --title T [--series S]            resolve a catalog row to a universe
  canon <name>                          fold a spelling onto the owner's
  validate                              structural checks; exit 1 on any error
  fixtures                              run data/universes.fixtures.json

EDITING  (every command needs --why; --dry-run shows the result without writing)
  add-series <universe> --series S --why W [--decided-how seed|llm|human]
  remove-series <universe> --series S --why W
  add-book <universe> --title T --why W [--exclude]
  remove-book <universe> --title T --why W [--exclude]
  hold-out --series S | --title T --why W [--subject "..."]
  restore <universe> --series S | --title T --why W

  --exclude targets bookExclusions instead of bookOverrides. An exclusion is how
  a book inside a universe's series is kept OUT of it — The Frugal Wizard's
  Handbook is the reason the mechanism exists.

  This CLI does not create or delete universes. ${existing} owner
  sign-off recorded in its \`confirmed\` field; the next one is a decision to
  make in the file, with its evidence, not a command to run.
`;
}

function cmdList(data) {
  out('');
  for (const u of data.universes) {
    const series = (u.series ?? []).length;
    const ov = (u.bookOverrides ?? []).length;
    const ex = (u.bookExclusions ?? []).length;
    out(`  ${u.name.padEnd(14)}  ${String(series).padStart(2)} series  ${String(ov).padStart(2)} book overrides  ${String(ex).padStart(2)} exclusions   [${u.decidedHow}]`);
  }
  const held = (data._refused ?? []).flatMap((r) => [...(r.heldOutSeries ?? []), ...(r.heldOutTitles ?? [])]);
  out('');
  out(`  ${data.universes.length} universes. ${(data._refused ?? []).length} recorded refusals, holding out ${held.length} named series/titles.`);
  if (held.length) out(`  Held out: ${held.join(', ')}`);
  out('');
}

function cmdShow(data, name) {
  const u = findUniverse(data, name);
  out('');
  out(`  ${u.name}   [decided: ${u.decidedHow}]`);
  if (u.confirmed) out(`  confirmed: ${u.confirmed}`);
  if (u.evidence) out(`  evidence:  ${u.evidence}`);
  if (u.notes) out(`  notes:     ${u.notes}`);
  if (u.penNames) out(`  pen names: ${u.penNames.join(', ')}`);
  out('');
  out(`  SERIES (${(u.series ?? []).length})`);
  for (const s of u.series ?? []) out(`    + ${s}`);
  if ((u.notSeries ?? []).length) {
    out(`  DELIBERATELY NOT (${u.notSeries.length})`);
    for (const s of u.notSeries) out(`    - ${s}`);
  }
  if ((u.bookOverrides ?? []).length) {
    out(`  BOOK OVERRIDES (${u.bookOverrides.length})`);
    for (const b of u.bookOverrides) out(`    + ${b.title}\n        ${b.why}`);
  }
  if ((u.bookExclusions ?? []).length) {
    out(`  BOOK EXCLUSIONS (${u.bookExclusions.length})`);
    for (const b of u.bookExclusions) out(`    - ${b.title}\n        ${b.why}`);
  }
  for (const [label, key] of [['watch', 'watch'], ['data problems', 'dataProblems']]) {
    if ((u[key] ?? []).length) {
      out(`  ${label.toUpperCase()}`);
      for (const w of u[key]) out(`    ! ${w}`);
    }
  }
  out('');
}

function cmdWho(data, flags) {
  const title = flag(flags, 'title');
  const series = flag(flags, 'series');
  if (!title && !series) throw new UniversesError('who needs --title and/or --series');
  const answer = universeFor(buildIndex(data), { title, series });
  out('');
  out(`  title:  ${title ?? '(none)'}`);
  out(`  series: ${series ?? '(none)'}`);
  out(`  →       ${answer ?? 'no universe'}`);
  if (!answer) out('  (no universe is the default answer; the file only ever says yes on evidence)');
  out('');
}

function cmdValidate(data) {
  const findings = validate(data);
  out('');
  if (!findings.length) {
    out('  valid — no errors, no warnings.');
  } else {
    const errors = printFindings(findings);
    out('');
    out(errors ? `  ${errors} error(s).` : '  no errors.');
    if (errors) process.exitCode = 1;
  }
  out('');
}

function cmdFixtures(data) {
  const { passed, failures } = runFixtures(data, loadFixtures());
  out('');
  for (const f of failures) out(`  FAIL  ${f}`);
  out(`  ${passed} passed, ${failures.length} failed.`);
  out('');
  if (failures.length) process.exitCode = 1;
}

/* --------------------------------- main --------------------------------- */

function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const [command, arg1] = positional;
  if (!command || command === 'help' || flags.help) {
    out(helpText());
    return;
  }

  const data = load();
  const dryRun = Boolean(flags['dry-run'] ?? flags.dryRun);
  const why = flag(flags, 'why');
  const decidedHow = flag(flags, 'decided-how') ?? 'human';
  const exclude = Boolean(flag(flags, 'exclude'));

  switch (command) {
    case 'list':
      return cmdList(data);
    case 'show':
      if (!arg1) throw new UniversesError('show needs a universe name');
      return cmdShow(data, arg1);
    case 'who':
      return cmdWho(data, flags);
    case 'canon': {
      if (!arg1) throw new UniversesError('canon needs a name');
      const c = canonicalName(data, arg1);
      out(c ? `  "${arg1}" → ${c}` : `  "${arg1}" is not a known universe name`);
      if (!c) process.exitCode = 1;
      return;
    }
    case 'validate':
      return cmdValidate(data);
    case 'fixtures':
      return cmdFixtures(data);

    case 'add-series':
      return saveChecked(data, addSeries(data, { universe: arg1, series: flag(flags, 'series'), why, decidedHow }), { dryRun });
    case 'remove-series':
      return saveChecked(data, removeSeries(data, { universe: arg1, series: flag(flags, 'series'), why }), { dryRun });
    case 'add-book':
      return saveChecked(data, addBook(data, { universe: arg1, title: flag(flags, 'title'), why, exclude, decidedHow }), { dryRun });
    case 'remove-book':
      return saveChecked(data, removeBook(data, { universe: arg1, title: flag(flags, 'title'), why, exclude }), { dryRun });
    case 'hold-out':
      return saveChecked(
        data,
        holdOut(data, { series: flag(flags, 'series'), title: flag(flags, 'title'), subject: flag(flags, 'subject'), why, decidedHow }),
        { dryRun }
      );
    case 'restore':
      return saveChecked(
        data,
        restore(data, { universe: arg1, series: flag(flags, 'series'), title: flag(flags, 'title'), why, decidedHow }),
        { dryRun }
      );

    default:
      throw new UniversesError(`Unknown command "${command}". Run with no arguments for help.`);
  }
}

try {
  main();
} catch (err) {
  if (err instanceof UniversesError) {
    console.error(`\n  ${err.message}\n`);
    process.exitCode = 1;
  } else throw err;
}
