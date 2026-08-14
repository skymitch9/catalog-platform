import assert from 'node:assert/strict';
import { test } from 'node:test';
import { declareAuthPosture, type EstateAuthConfig } from '../src/config.js';

test('a coherent private posture declares and freezes', () => {
  const c = declareAuthPosture({ public: false, app: 'library', defaultRole: 'reader' });
  assert.equal(c.public, false);
  assert.ok(Object.isFrozen(c));
});

test('public surfaces cannot carry a default role', () => {
  assert.throws(
    () => declareAuthPosture({ public: true, app: 'audiobook', defaultRole: 'reader' }),
    /public surface/,
  );
  const ok = declareAuthPosture({ public: true, app: 'audiobook', defaultRole: null });
  assert.equal(ok.public, true);
});

test('an implicit posture is refused — public must be explicitly boolean', () => {
  // JS caller shape: the whole point is that nobody inherits a posture.
  const sneaky = { app: 'newsite', defaultRole: null } as unknown as EstateAuthConfig;
  assert.throws(() => declareAuthPosture(sneaky), /explicitly true or false/);
});

test('the app must be named', () => {
  assert.throws(
    () => declareAuthPosture({ public: false, app: '', defaultRole: null }),
    /name the consumer/,
  );
});
