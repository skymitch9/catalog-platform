import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  UNAUTHENTICATED,
  estateSignInRefusal,
  unauthenticatedRefusal,
  type RefusalClauses,
} from '../src/refusals.js';

const CLAUSES: RefusalClauses = {
  what: 'You are not signed in, so the estate index answered nothing.',
  needs: 'a signed-in estate account',
  how: 'Sign in at https://heygabi.ai and try again.',
};

// --- The frozen contract: adding words must not move the code. -------------

test('⚠️ the `error` code is exactly `unauthenticated` — probes and pages branch on it', () => {
  assert.equal(UNAUTHENTICATED, 'unauthenticated');
  assert.equal(unauthenticatedRefusal(CLAUSES).error, 'unauthenticated');
  assert.equal(estateSignInRefusal('the estate index').error, 'unauthenticated');
});

test('the body is ADDITIVE — it adds fields beside the code and removes none', () => {
  const body = unauthenticatedRefusal(CLAUSES);
  // A client that only reads `error` (tools/estate-probes) is unaffected;
  // a client that reads `detail` (permission-ux.js) now gets a sentence.
  assert.deepEqual(Object.keys(body).sort(), ['detail', 'error', 'how', 'needs', 'what']);
});

// --- The load-bearing one: `detail` alone must carry all three clauses. ----

test('⚠️ `detail` alone carries WHAT, NEEDS and HOW — every live client prints only it', () => {
  const { detail } = unauthenticatedRefusal(CLAUSES);
  assert.ok(detail.includes('You are not signed in'), 'what');
  assert.ok(detail.includes('a signed-in estate account'), 'needs');
  assert.ok(detail.includes('https://heygabi.ai'), 'how');
  assert.equal(
    detail,
    'You are not signed in, so the estate index answered nothing. ' +
      'This needs a signed-in estate account. ' +
      'Sign in at https://heygabi.ai and try again.',
  );
});

test('the three clauses also travel as their own fields, unwrapped', () => {
  const body = unauthenticatedRefusal(CLAUSES);
  assert.equal(body.what, CLAUSES.what);
  assert.equal(body.needs, CLAUSES.needs);
  assert.equal(body.how, CLAUSES.how);
});

// --- Refusing to invent a clause. ------------------------------------------

test('⚠️ a missing clause THROWS — it is never defaulted into a plausible sentence', () => {
  for (const missing of ['what', 'needs', 'how'] as const) {
    const broken = { ...CLAUSES, [missing]: '' };
    assert.throws(() => unauthenticatedRefusal(broken), new RegExp(missing), `empty ${missing}`);
  }
});

test('a whitespace-only clause is a missing clause, not a clause', () => {
  assert.throws(() => unauthenticatedRefusal({ ...CLAUSES, how: '   ' }), /`how`/);
});

test('a non-string clause from a JS caller throws rather than stringifying', () => {
  const sneaky = { ...CLAUSES, needs: null } as unknown as RefusalClauses;
  assert.throws(() => unauthenticatedRefusal(sneaky), /`needs`/);
});

test('clauses are trimmed, so a stray newline cannot double-space the sentence', () => {
  const body = unauthenticatedRefusal({ what: ' A. ', needs: ' b ', how: ' C. ' });
  assert.equal(body.detail, 'A. This needs b. C.');
});

// --- The default estate sentence. ------------------------------------------

test('estateSignInRefusal names the surface it refused and how to clear it', () => {
  const body = estateSignInRefusal('the estate index');
  assert.ok(body.detail.startsWith('You are not signed in, so the estate index answered nothing.'));
  assert.equal(body.needs, 'a signed-in estate account');
  assert.ok(body.how.includes('https://heygabi.ai'), 'names where to sign in');
  assert.ok(body.how.includes('owner'), 'and the escalation when signing in is not enough');
});

test('⚠️ two Workers asking for the same refusal get the SAME sentence — the drift this replaces', () => {
  const index = estateSignInRefusal('the estate index');
  const board = estateSignInRefusal('the estate index');
  assert.deepEqual(index, board);
  // and a different surface differs ONLY in the clause that names it
  const library = estateSignInRefusal('this catalog');
  assert.equal(library.needs, index.needs);
  assert.equal(library.how, index.how);
  assert.notEqual(library.what, index.what);
});

test('an empty surface name throws — an unnamed refusal is a bare status with punctuation', () => {
  assert.throws(() => estateSignInRefusal(''), /non-empty/);
});
