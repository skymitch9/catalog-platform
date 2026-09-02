/**
 * universes-create.test.mjs — `tools/universes.mjs create`, the command this
 * CLI spent most of its life refusing to have.
 *
 * ⚠️ WHY THE REFUSAL WAS LIFTED, AND WHY THE TESTS BELOW ARE MOSTLY ABOUT
 * STRICTNESS. The header of `tools/universes.mjs` said a new universe is *"a
 * decision to make in the file, with its evidence, not a command to run"*. That
 * is right about decisions and wrong about syntax, and syntax is what it became:
 * there are seventeen universes and the CLI could only ever create zero of them,
 * so eleven arrived by hand-editing the JSON — the one path with no `--why`, no
 * canonicalNames registration and no `validate` gate.
 *
 * So `create` has to be STRICTER than the hand edit it replaces, and that is
 * what this file pins: `--confirmed` is required and nothing else in the CLI
 * requires it; the name is registered in `canonicalNames` in the same write; an
 * alias of an existing verse is refused by name.
 *
 * ⚠️ EVERY CASE RUNS AGAINST A SYNTHETIC DOCUMENT, and the one subprocess case
 * asserts data/universes.json is byte-identical afterwards. A test for a
 * mutation command that mutates the real file is a test that ships a universe.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { UniversesError, canonicalName, createUniverse, validate } from '../../tools/lib/universes.mjs';

const REPO_ROOT = new URL('../../', import.meta.url);
const DATA_PATH = fileURLToPath(new URL('data/universes.json', REPO_ROOT));
const CLI = fileURLToPath(new URL('tools/universes.mjs', REPO_ROOT));

/** A minimal document that `validate()` is happy with. */
function doc() {
  return {
    schemaVersion: 1,
    canonicalNames: { 'the cosmere': 'The Cosmere', cosmere: 'The Cosmere' },
    _pinnedCanonicalNames: { cosmere: 'The Cosmere' },
    universes: [
      {
        name: 'The Cosmere',
        decidedHow: 'human',
        series: ['Elantris'],
      },
    ],
    _refused: [],
  };
}

const OK = {
  name: 'Discworld',
  why: 'three shelves hold it and nothing groups them together',
  confirmed: 'owner, 2026-09-02: yes, Discworld is its own verse',
};

test('🔴 --confirmed is REQUIRED, and the refusal says why it is required', () => {
  const d = doc();
  assert.throws(
    () => createUniverse(d, { name: OK.name, why: OK.why }),
    (err) => {
      assert.ok(err instanceof UniversesError);
      assert.match(err.message, /--confirmed/);
      assert.match(err.message, /a hand edit of the\nJSON could always skip/);
      return true;
    },
  );
  assert.equal(d.universes.length, 1, 'nothing was added');
});

test('⚠️ a one-word --confirmed is not sign-off either', () => {
  assert.throws(() => createUniverse(doc(), { ...OK, confirmed: 'yes' }), UniversesError);
});

test('--why keeps the same 10-character floor every other mutation has', () => {
  assert.throws(() => createUniverse(doc(), { ...OK, why: 'idk' }), /at least 10 characters/);
});

test('a valid create adds the universe AND registers it in canonicalNames', () => {
  const d = doc();
  const msg = createUniverse(d, OK);
  assert.equal(d.universes.length, 2);
  const made = d.universes[1];
  assert.equal(made.name, 'Discworld');
  assert.equal(made.confirmed, OK.confirmed);
  assert.equal(made.why, OK.why);
  assert.equal(made.decidedHow, 'human');
  assert.deepEqual(made.series, []);

  // ⚠️ The step a hand edit forgets. Without it `validate()` errors
  // UNIVERSE_NOT_CANONICAL and no alias could ever fold onto the new name.
  assert.equal(d.canonicalNames.discworld, 'Discworld');
  assert.equal(canonicalName(d, 'DISCWORLD'), 'Discworld');

  // The message has to warn about the tripwire, because the next thing that
  // happens to whoever ran this is a red suite in another repo.
  assert.match(msg, /universes\.test\.ts/);
  assert.match(msg, /add-series/);
});

test('the result passes validate() — only the EMPTY_UNIVERSE warning a new verse earns', () => {
  const d = doc();
  createUniverse(d, OK);
  const findings = validate(d);
  assert.deepEqual(findings.filter((f) => f.level === 'error'), []);
  assert.deepEqual(
    findings.map((f) => f.code),
    ['EMPTY_UNIVERSE'],
    'a universe with no series claims nothing yet, and validate should say so',
  );
});

test('the change lands in _changelog with the sign-off, not just in git', () => {
  const d = doc();
  createUniverse(d, OK);
  const entry = d._changelog.at(-1);
  assert.equal(entry.action, 'create');
  assert.equal(entry.universe, 'Discworld');
  assert.equal(entry.confirmed, OK.confirmed);
});

test('⚠️ an existing name is refused, and so is a registered ALIAS of one', () => {
  assert.throws(() => createUniverse(doc(), { ...OK, name: 'The Cosmere' }), /already exists/);
  assert.throws(
    () => createUniverse(doc(), { ...OK, name: 'Cosmere' }),
    (err) => {
      assert.match(err.message, /registered spelling of The Cosmere/);
      return true;
    },
  );
});

test('--evidence rides along when given, and is absent when not', () => {
  const withIt = doc();
  createUniverse(withIt, { ...OK, evidence: 'the Discworld wiki lists 41 novels in one continuity' });
  assert.match(withIt.universes[1].evidence, /41 novels/);

  const without = doc();
  createUniverse(without, OK);
  assert.ok(!('evidence' in without.universes[1]));
});

test('⚠️ the CLI wires it up, and --dry-run leaves data/universes.json untouched', () => {
  const before = readFileSync(DATA_PATH, 'utf8');
  const out = execFileSync(
    process.execPath,
    [CLI, 'create', 'A Test Verse That Does Not Exist', '--why', OK.why, '--confirmed', OK.confirmed, '--dry-run'],
    { encoding: 'utf8' },
  );
  assert.match(out, /\[dry run\]/);
  assert.match(out, /unchanged/);
  assert.equal(readFileSync(DATA_PATH, 'utf8'), before, 'a dry run must not write the real file');
});

test('the CLI exits non-zero without --confirmed, and writes nothing', () => {
  const before = readFileSync(DATA_PATH, 'utf8');
  let failed = false;
  try {
    execFileSync(process.execPath, [CLI, 'create', 'A Test Verse', '--why', OK.why], { encoding: 'utf8', stdio: 'pipe' });
  } catch (err) {
    failed = true;
    assert.match(String(err.stderr ?? ''), /--confirmed/);
  }
  assert.ok(failed, 'the CLI should have exited non-zero');
  assert.equal(readFileSync(DATA_PATH, 'utf8'), before);
});

test('help mentions create, and still says the CLI does not DELETE universes', () => {
  const out = execFileSync(process.execPath, [CLI], { encoding: 'utf8' });
  assert.match(out, /create <name> --why W --confirmed/);
  assert.match(out, /does not DELETE universes/);
});
