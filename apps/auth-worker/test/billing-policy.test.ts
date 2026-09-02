/**
 * billing-policy.test.ts — the resolver, which is the whole design in one
 * function.
 *
 * 🔴 THE ASSERTION THIS FILE EXISTS FOR IS THE FIRST ONE: an EMPTY TABLE
 * CHANGES NOTHING ANYWHERE. Everything else here is about specificity and
 * about the two directions the resolver must never move in — it must never
 * GRANT, and it must never let a `system` rule and an `everyone` rule leak
 * into each other.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BILLING_SITES, featuresForSite } from '../src/billing-registry.js';
import {
  BILLING_POSTURES,
  parseBillingPosture,
  resolveDecisions,
  resolveDenied,
  resolveDeniedBySite,
  systemFeatureIds,
  unknownFeatures,
  type PolicyRule,
} from '../src/billing-policy.js';

let nextId = 1;
function rule(over: Partial<PolicyRule>): PolicyRule {
  return {
    id: nextId++,
    feature: '*',
    site: '*',
    principal_kind: 'everyone',
    principal_value: null,
    allow: 0,
    why: 'a test',
    updated_by: 'test@example.com',
    updated_at: '2026-09-02T00:00:00.000Z',
    ...over,
  };
}

const ALICE = { kind: 'person', userId: '7', localRole: 'moderator' } as const;
const CRON = { kind: 'system' } as const;

// ---------------------------------------------------------------------------
// The default
// ---------------------------------------------------------------------------

test('🔴 AN EMPTY TABLE IS EXACTLY TODAY’S BEHAVIOUR — nothing is denied, anywhere', () => {
  // This is the property the whole rollout rests on: migration 0016 can be
  // applied ahead of the Worker that reads it, unattended and remotely,
  // because an empty table is a no-op.
  for (const site of BILLING_SITES) {
    assert.deepEqual(resolveDenied([], site, ALICE), [], `${site} should be untouched`);
    assert.deepEqual(resolveDenied([], site, CRON), [], `${site} cron should be untouched`);
  }
  const map = resolveDeniedBySite([], ALICE);
  assert.deepEqual(Object.values(map).flat(), []);
});

test('rank 17 — a feature no rule reaches is allowed, and carries a null rule', () => {
  const d = resolveDecisions([rule({ feature: 'gabi.chat', site: 'estate' })], 'estate', ALICE);
  assert.equal(d.get('gabi.chat')?.denied, true);
  assert.equal(d.get('scan.photo')?.denied, false);
  assert.equal(d.get('scan.photo')?.rule, null, 'no rule matched, so there is no rule to name');
});

// ---------------------------------------------------------------------------
// Specificity (§3.3)
// ---------------------------------------------------------------------------

test('most specific wins: a user rule beats a role rule beats an everyone rule', () => {
  const rules = [
    rule({ feature: 'scan.photo', site: 'games', principal_kind: 'everyone', allow: 0 }),
    rule({ feature: 'scan.photo', site: 'games', principal_kind: 'role', principal_value: 'moderator', allow: 1 }),
  ];
  // The role rule un-denies the broader everyone deny — that is what an
  // `allow` row is FOR (§3.3), and it is the only thing it can do.
  assert.deepEqual(resolveDenied(rules, 'games', ALICE), []);

  rules.push(
    rule({ feature: 'scan.photo', site: 'games', principal_kind: 'user', principal_value: '7', allow: 0 }),
  );
  assert.deepEqual(resolveDenied(rules, 'games', ALICE), ['scan.photo'], 'the user rule is the most specific');
});

test('exact site beats wildcard site, at the same principal rung', () => {
  const rules = [
    rule({ feature: 'research.tier', site: '*', principal_kind: 'everyone', allow: 0 }),
    rule({ feature: 'research.tier', site: 'games', principal_kind: 'everyone', allow: 1 }),
  ];
  // "Switch it off everywhere, then back on for games alone" — the design's own
  // worked example of what an allow row is for.
  assert.deepEqual(resolveDenied(rules, 'games', ALICE), []);
});

test('exact feature beats wildcard feature, at the same principal rung', () => {
  const rules = [
    rule({ feature: '*', site: 'estate', principal_kind: 'everyone', allow: 0 }),
    rule({ feature: 'gabi.chat', site: 'estate', principal_kind: 'everyone', allow: 1 }),
  ];
  const denied = resolveDenied(rules, 'estate', ALICE);
  assert.ok(!denied.includes('gabi.chat'), 'the exact rule un-denies it');
  assert.ok(denied.includes('scan.photo'), 'the wildcard still covers everything else on the site');
  assert.ok(denied.includes('gabi.memory'));
});

test('a wildcard-everything deny reaches every feature ON THAT SITE and no others', () => {
  const rules = [rule({ feature: '*', site: '*', principal_kind: 'everyone', allow: 0 })];
  for (const site of BILLING_SITES) {
    const denied = resolveDenied(rules, site, ALICE);
    assert.deepEqual(
      denied.sort(),
      featuresForSite(site).map((f) => f.id).sort(),
      `${site} should be entirely off`,
    );
  }
  // ⚠️ `feature: '*'` means "everything HERE", never "everything anywhere" —
  // a games answer must not name a feature games does not implement, or a
  // consumer cannot trust the array as a complete list for its own surface.
  assert.ok(!resolveDenied(rules, 'games', ALICE).includes('gabi.panel'));
});

// ---------------------------------------------------------------------------
// The two directions it must never move in
// ---------------------------------------------------------------------------

test('🔴 THERE IS NO WAY TO GRANT — an allow row on an empty table denies nothing and opens nothing', () => {
  // The resolver's ONLY output is a set of DENIED ids. An `allow` row means
  // "not denied by this rule", full stop. A caller ANDs this with the gate it
  // already had, so there is no code path where a row here opens a call the
  // capability matrix, the missing secret or the env posture had closed.
  const rules = [rule({ feature: '*', site: '*', principal_kind: 'everyone', allow: 1 })];
  assert.deepEqual(resolveDenied(rules, 'library', ALICE), []);
  // And the same answer as with no rules at all — an allow row is a no-op
  // unless a broader deny exists for it to carve out of.
  assert.deepEqual(resolveDenied(rules, 'library', ALICE), resolveDenied([], 'library', ALICE));
});

test('⚠️ `system` RESOLVES ALONE — a cron ignores everyone rules, and a person ignores system rules', () => {
  // §3.1's reason, in both directions. Modelling a cron as `everyone` would
  // mean switching the sweep off also switches the whole household off; and an
  // `everyone` deny silently stopping an unattended sweep would make the
  // matrix's clock-icon row a lie about what the click did.
  const everyoneOff = [rule({ feature: 'sweep.details', site: 'games', principal_kind: 'everyone', allow: 0 })];
  assert.deepEqual(resolveDenied(everyoneOff, 'games', CRON), [], 'an everyone rule does not reach the cron');

  const systemOff = [rule({ feature: 'sweep.details', site: 'games', principal_kind: 'system', allow: 0 })];
  assert.deepEqual(resolveDenied(systemOff, 'games', CRON), ['sweep.details']);
  assert.deepEqual(resolveDenied(systemOff, 'games', ALICE), [], 'a system rule does not reach a person');
});

test('the unattended billers are reachable, and they are the clock-icon rows', () => {
  const ids = systemFeatureIds();
  assert.ok(ids.includes('sweep.details'), 'L8 and G7 must be switchable — it is the only way to stop them');
  assert.ok(ids.includes('warnings.web'), 'A5’s hourly fulfiller');
  assert.ok(ids.includes('pipeline.run'));
  assert.ok(!ids.includes('gabi.chat'), 'a Discord turn always has a person');
});

// ---------------------------------------------------------------------------
// local_role, and the mid-deploy consumer
// ---------------------------------------------------------------------------

test('⚠️ NO local_role ⇒ role rules are SKIPPED, never guessed at', () => {
  // §3.5 row 5: an old consumer mid-deploy keeps working. Guessing a rung
  // would deny (or fail to deny) the wrong person, silently.
  const rules = [
    rule({ feature: 'research.details', site: 'library', principal_kind: 'role', principal_value: 'moderator', allow: 0 }),
    rule({ feature: 'research.series', site: 'library', principal_kind: 'everyone', allow: 0 }),
  ];
  const noRole = { kind: 'person', userId: '7', localRole: null } as const;
  const denied = resolveDenied(rules, 'library', noRole);
  assert.ok(!denied.includes('research.details'), 'the role rule is unresolvable, so it is skipped');
  assert.ok(denied.includes('research.series'), 'user and everyone rules still apply');
});

test('a person not in the directory can still be reached by an everyone rule', () => {
  const stranger = { kind: 'person', userId: null, localRole: null } as const;
  const rules = [
    rule({ feature: 'scan.photo', site: 'estate', principal_kind: 'user', principal_value: '7', allow: 0 }),
    rule({ feature: 'gabi.chat', site: 'estate', principal_kind: 'everyone', allow: 0 }),
  ];
  assert.deepEqual(resolveDenied(rules, 'estate', stranger), ['gabi.chat']);
});

test('a user rule names ONE person and reaches nobody else', () => {
  const rules = [rule({ feature: 'gabi.chat', site: 'estate', principal_kind: 'user', principal_value: '7', allow: 0 })];
  assert.deepEqual(resolveDenied(rules, 'estate', ALICE), ['gabi.chat']);
  const bob = { kind: 'person', userId: '8', localRole: 'moderator' } as const;
  assert.deepEqual(resolveDenied(rules, 'estate', bob), []);
});

// ---------------------------------------------------------------------------
// Drift and failure direction
// ---------------------------------------------------------------------------

test('⚠️ a rule naming an unknown feature is IGNORED, not fatal — and it is REPORTED', () => {
  // §3.5 row 4: a registry that has moved on must never brick a Worker. But it
  // must not vanish either: silently dropping it shows a feature as ON while a
  // row in the table says otherwise.
  const rules = [
    rule({ feature: 'research.cover', site: 'library', allow: 0 }), // the singular typo
    rule({ feature: 'research.covers', site: 'nowhere', allow: 0 }),
  ];
  assert.deepEqual(resolveDenied(rules, 'library', ALICE), []);
  assert.equal(unknownFeatures(rules).length, 2);
  assert.equal(unknownFeatures([rule({ feature: '*', site: '*' })]).length, 0, 'wildcards are not unknown');
});

test('on a rank tie the FIRST rule wins — deterministic, not "whatever D1 returned"', () => {
  // A tie needs the unique index to have been bypassed (a hand-edited D1), but
  // "it depends on row order" is not an answer anybody can act on.
  const a = rule({ feature: 'gabi.chat', site: 'estate', principal_kind: 'everyone', allow: 0 });
  const b = rule({ feature: 'gabi.chat', site: 'estate', principal_kind: 'everyone', allow: 1 });
  assert.deepEqual(resolveDenied([a, b], 'estate', ALICE), ['gabi.chat']);
  assert.deepEqual(resolveDenied([b, a], 'estate', ALICE), []);
});

test('the decision names the exact rule, so “why was I denied” is answerable', () => {
  const r = rule({ feature: 'gabi.chat', site: 'estate', principal_kind: 'everyone', allow: 0, why: 'too chatty' });
  const d = resolveDecisions([r], 'estate', ALICE).get('gabi.chat');
  assert.equal(d?.denied, true);
  assert.equal(d?.rule?.id, r.id, 'the rule_id is the whole point of the shadow line');
  assert.equal(d?.rule?.why, 'too chatty');
});

// ---------------------------------------------------------------------------
// The posture
// ---------------------------------------------------------------------------

test('⚠️ an unrecognised posture falls to `off` AND says so', () => {
  assert.deepEqual([...BILLING_POSTURES], ['off', 'shadow', 'enforce']);
  assert.equal(parseBillingPosture(undefined), 'off');
  assert.equal(parseBillingPosture(''), 'off');
  assert.equal(parseBillingPosture('enforce'), 'enforce');
  assert.equal(parseBillingPosture(' Shadow '), 'shadow', 'whitespace and case are forgiven');

  // A typo in a wrangler var must not silently half-enable a money gate, and
  // it must not be silent either.
  const heard: string[] = [];
  assert.equal(parseBillingPosture('enfroce', (v) => heard.push(v)), 'off');
  assert.deepEqual(heard, ['enfroce']);
  // ⚠️ Note the fail direction: unrecognised → OFF, which BILLS. That is
  // deliberate and matches §3.5's third row — this system fails open on money
  // rather than turning an outage into "everything is broken". The ceilings
  // (SWEEP_LIMIT, max_tokens, the timeouts) are what bound the wallet.
  assert.equal(parseBillingPosture('ENFORCE'), 'enforce');
});
