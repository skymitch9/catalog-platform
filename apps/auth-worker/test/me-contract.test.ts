/**
 * RESPONSE CONTRACT TEST — GET /api/estate/me (2026-08-24).
 *
 * The failure this pins is the one the estate keeps hitting from the other
 * direction: a producer quietly stops sending a field a consumer reads, every
 * test on both sides stays green (each half is internally consistent), and the
 * break only shows up live — a page that hides its Admin card, a /status gate
 * that fails closed for an approver. `me.test.ts` beside this asserts what each
 * FIELD means; this asserts the SET is complete against the browsers that read
 * it, and goes RED the moment `meAnswer()` drops one of them.
 *
 * DERIVED, NOT HAND-MAINTAINED. The required set is read out of the consumer
 * code itself — every `body?.X` / `me?.X` access on the parsed /me body in the
 * two in-repo browser consumers — so it cannot drift out of step with what the
 * front end actually reads. If a consumer starts reading a new field, this
 * test demands the producer provide it; if the producer removes one a consumer
 * still reads, this test fails here rather than in someone's browser.
 *
 * Own-property, so present-but-null is distinguished from absent (an explicit
 * `is_devops: false` is a real answer; a missing key is the bug).
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { EstateUserRow } from '../src/env.js';
import { meAnswer } from '../src/me.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../..');

/**
 * The in-repo browser consumers of GET /api/estate/me. Each names the parsed
 * body `body` (gate.js) or `me` (apex-admin-link.js) and reads fields off it as
 * `body?.is_devops`, `me?.is_approver`, etc. — a scope in which those two
 * identifiers are ONLY the /me response, so the extraction has no noise.
 */
const CONSUMERS = [
  'sites/heygabi-home/public/status/lib/gate.js',
  'sites/heygabi-home/public/assets/apex-admin-link.js',
];

function requiredMeFields(): string[] {
  const fields = new Set<string>();
  for (const rel of CONSUMERS) {
    const src = readFileSync(resolve(REPO, rel), 'utf8');
    for (const m of src.matchAll(/\b(?:body|me)(?:\?\.|\.)([a-z_][a-z0-9_]*)/g)) {
      if (m[1]) fields.add(m[1]);
    }
  }
  return [...fields];
}

function row(over: Partial<EstateUserRow> = {}): EstateUserRow {
  return {
    id: 1,
    email: 'bob@example.com',
    firebase_uid: 'uid-bob',
    display_name: 'Bob',
    status: 'approved',
    is_approver: 0,
    is_devops: 0,
    dev_access: 0,
    origin: 'seen:library',
    note: null,
    first_seen_at: '2026-08-14 00:00:00',
    decided_at: null,
    decided_by: null,
    vis_audiobook: 1,
    vis_library: 1,
    vis_games: 1,
    vis_library2: 0,
    vis_ebooks: 0,
    ...over,
  };
}

test('the /me consumers read a NON-EMPTY set, including the two the gate turns on', () => {
  // If the extraction ever silently finds nothing (a renamed variable, a moved
  // file), the contract below would pass vacuously — so anchor it. is_devops
  // and is_approver are the two the /status gate and the Admin card both read.
  const required = requiredMeFields();
  assert.ok(required.length >= 2, `derived too few fields from consumers: ${required.join(', ')}`);
  assert.ok(required.includes('is_devops'), 'consumers read is_devops (the gate) — derivation missed it');
  assert.ok(required.includes('is_approver'), 'consumers read is_approver — derivation missed it');
});

test('meAnswer() provides EVERY field its browser consumers read — on every branch', () => {
  const required = requiredMeFields();
  const answers: Record<string, ReturnType<typeof meAnswer>> = {
    'owner break-glass': meAnswer(null, true),
    'not in directory': meAnswer(null, false),
    'approved plain': meAnswer(row({ status: 'approved' }), false),
    'revoked': meAnswer(row({ status: 'revoked' }), false),
    'approver': meAnswer(row({ status: 'approved', is_approver: 1 }), false),
  };
  for (const [label, answer] of Object.entries(answers)) {
    for (const field of required) {
      assert.ok(
        Object.hasOwn(answer as object, field),
        `meAnswer (${label}) is MISSING "${field}", which a browser consumer reads off /api/estate/me. ` +
          `A dropped field white-screens no page but silently changes what the front end decides ` +
          `(a hidden Admin card, a gate that fails closed). Restore it on MeAnswer or stop the consumer reading it.`,
      );
    }
  }
});
