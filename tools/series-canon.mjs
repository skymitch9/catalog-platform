#!/usr/bin/env node
// tools/series-canon.mjs
//
// The LOCAL editor for data/series-canon.json. Same reasoning as
// tools/universes.mjs: a browser cannot commit to a git repo, and the value of
// this file is that every fold is version-controlled with its evidence.
//
//   node tools/series-canon.mjs                       # this help
//   node tools/series-canon.mjs list
//   node tools/series-canon.mjs canon "Ascend Online [publication order]"
//   node tools/series-canon.mjs validate
//   node tools/series-canon.mjs add --canonical "Name" --variant "Other Name" --why "..."

import {
  DATA_PATH,
  SeriesCanonError,
  addVariant,
  canonicalFor,
  load,
  save,
  validate,
} from './lib/series-canon.mjs';

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
const out = (...args) => console.log(...args);

function printFindings(findings) {
  const errors = findings.filter((f) => f.level === 'error');
  const warns = findings.filter((f) => f.level === 'warn');
  for (const f of errors) out(`  ERROR  [${f.code}] ${f.message}`);
  for (const f of warns) out(`  warn   [${f.code}] ${f.message}`);
  return errors.length;
}

const HELP = `
The estate series canon — local editor.

  data/series-canon.json is the ONE copy. library_catalog reads it live at
  backfill time; audiobook_catalog merges it into its own corrections layer via
  \`python -m app.tools.sync_series_canon\`. Edits happen here so the reason for
  each one lands in git alongside the change.

READING
  list                                   every entry, with its variants
  canon <name>                           fold a spelling onto its canonical form
  validate                               structural checks; exit 1 on any error

EDITING  (needs --why; --dry-run shows the result without writing)
  add --canonical C --variant V --why W [--decided-how seed|llm|human]
`;

function cmdList(data) {
  out('');
  for (const entry of data.entries ?? []) {
    out(`  ${entry.canonical}`);
    for (const v of entry.variants ?? []) {
      if (v === entry.canonical) continue;
      out(`    = ${v}`);
    }
  }
  out('');
  out(`  ${(data.entries ?? []).length} entries.`);
  out('');
}

function cmdCanon(data, name) {
  const c = canonicalFor(data, name);
  out(c === name ? `  "${name}" — no fold on record, passed through unchanged` : `  "${name}" -> "${c}"`);
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

function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const [command, arg1] = positional;
  if (!command || command === 'help' || flags.help) {
    out(HELP);
    return;
  }

  const data = load();
  const dryRun = Boolean(flags['dry-run'] ?? flags.dryRun);

  switch (command) {
    case 'list':
      return cmdList(data);
    case 'canon':
      if (!arg1) throw new SeriesCanonError('canon needs a name');
      return cmdCanon(data, arg1);
    case 'validate':
      return cmdValidate(data);
    case 'add':
      return saveChecked(
        data,
        addVariant(data, {
          canonical: flag(flags, 'canonical'),
          variant: flag(flags, 'variant'),
          why: flag(flags, 'why'),
          decidedHow: flag(flags, 'decided-how') ?? 'human',
        }),
        { dryRun }
      );
    default:
      throw new SeriesCanonError(`Unknown command "${command}". Run with no arguments for help.`);
  }
}

try {
  main();
} catch (err) {
  if (err instanceof SeriesCanonError) {
    console.error(`\n  ${err.message}\n`);
    process.exitCode = 1;
  } else throw err;
}
