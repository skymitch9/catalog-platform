/**
 * notify-prefs.test.ts — which events are worth interrupting the owner for.
 *
 * ⚠️ THE FAILURE THIS FILE EXISTS FOR IS SILENCE. Every other surface in this
 * Worker fails loudly; this one fails by NOT buzzing a phone, which is
 * indistinguishable from "nothing went wrong" until something did. So the tests
 * are mostly about what happens when the stored value is missing, corrupt or
 * unrecognised — every one of those paths must land on a SAFE default, never on
 * "notify about nothing".
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  NOTIFY_CLASSES,
  NOTIFY_PREFS_KEY,
  defaultPrefs,
  parsePrefs,
  parsePrefsBody,
} from '../src/notify-prefs.js';

test('⚠️ the defaults are asymmetric ON PURPOSE — red on, the rest off', () => {
  const d = defaultPrefs();
  // Missing a failure is the reason the status page exists.
  assert.equal(d.red, true);
  // A phone that buzzes for every routine success gets silenced, and a silenced
  // phone misses the red one too.
  assert.equal(d.agent_landed, false);
  assert.equal(d.window_complete, false);
  assert.equal(d.archive_done, false);
});

test('every class carries a label AND a sentence saying what it means', () => {
  assert.ok(NOTIFY_CLASSES.length >= 4);
  for (const c of NOTIFY_CLASSES) {
    assert.ok(c.key && /^[a-z_]+$/.test(c.key), `${c.key} should be a plain snake_case key`);
    assert.ok(c.label && c.label.length > 3, `${c.key} needs a label`);
    assert.ok(c.detail && c.detail.length > 20, `${c.key} needs a sentence — a toggle nobody understands gets guessed at`);
    assert.equal(typeof c.default, 'boolean');
  }
});

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

test('parsePrefs: a stored choice wins over the default', () => {
  const p = parsePrefs('{"red":false,"agent_landed":true}');
  assert.equal(p.red, false, 'he is allowed to turn red off — it is his phone');
  assert.equal(p.agent_landed, true);
  assert.equal(p.window_complete, false, 'unmentioned classes keep their default');
});

test('⚠️ AN UNREADABLE ROW FALLS BACK TO DEFAULTS, NEVER TO SILENCE', () => {
  // A corrupted value turning every notification off would be experienced as
  // "the estate went quiet", which reads exactly like "nothing went wrong".
  for (const bad of ['{ truncated', '[]', '"a string"', 'null', '']) {
    assert.deepEqual(parsePrefs(bad), defaultPrefs(), `expected defaults for ${JSON.stringify(bad)}`);
  }
  assert.deepEqual(parsePrefs(null), defaultPrefs());
  assert.deepEqual(parsePrefs(undefined), defaultPrefs());
});

test('parsePrefs: junk VALUES and unknown KEYS are ignored, the rest still applies', () => {
  const p = parsePrefs('{"red":"yes","agent_landed":true,"nonsense":true}');
  assert.equal(p.red, true, 'a non-boolean cannot switch an alert off');
  assert.equal(p.agent_landed, true);
  assert.equal(p.nonsense, undefined, 'an unknown key is not adopted');
});

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

test('parsePrefsBody: a good body round-trips with defaults filled in', () => {
  const r = parsePrefsBody({ agent_landed: true });
  assert.ok('prefs' in r);
  assert.equal(r.prefs.agent_landed, true);
  assert.equal(r.prefs.red, true, 'unmentioned classes keep their default rather than vanishing');
});

test('⚠️ IT REFUSES, IT NEVER STRIPS', () => {
  // Silently dropping an unknown key means he toggles something, gets a 200,
  // and it does nothing — the estate has that bug on record elsewhere.
  const unknown = parsePrefsBody({ red: true, teapot: true });
  assert.ok('error' in unknown);
  assert.equal(unknown.error, 'unknown_class');
  assert.match(unknown.detail, /teapot/);
  assert.match(unknown.detail, /Known:/, 'the refusal names what IS accepted');

  const wrongType = parsePrefsBody({ red: 'yes' });
  assert.ok('error' in wrongType);
  assert.equal(wrongType.error, 'not_a_boolean');
  assert.match(wrongType.detail, /true or false/);
});

test('parsePrefsBody: a non-object is refused with a usable sentence', () => {
  for (const bad of [null, [], 'string', 42]) {
    const r = parsePrefsBody(bad);
    assert.ok('error' in r, `expected refusal for ${JSON.stringify(bad)}`);
    assert.equal(r.error, 'not_an_object');
    assert.match(r.detail, /JSON object/);
  }
});

test('turning EVERYTHING off is allowed and is stored as such', () => {
  // ⚠️ This must work: it is his phone, and a settings page that refuses to
  // honour "leave me alone" gets ignored wholesale. The estate's job is to make
  // the choice visible, not to overrule it.
  const r = parsePrefsBody({ red: false, agent_landed: false, window_complete: false, archive_done: false });
  assert.ok('prefs' in r);
  assert.deepEqual(Object.values(r.prefs), [false, false, false, false]);
});

test('the storage key is stable — it is what the conductor reads', () => {
  assert.equal(NOTIFY_PREFS_KEY, 'notify');
});
