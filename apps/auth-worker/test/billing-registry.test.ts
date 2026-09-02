/**
 * billing-registry.test.ts — THE PIN.
 *
 * ⚠️ THE BUG THIS FILE EXISTS FOR CANNOT BE FOUND ANY OTHER WAY. A consumer
 * that checks `research.cover` against a registry holding `research.covers`
 * gets no error, no log line and no denial — it is **allowed, forever,
 * invisibly**, which is exactly the failure the design's §3.2 names ("a flag
 * flipped, the sweep updated three places, and the missed copy was always a
 * comment or a README"). A money gate that fails open in silence has to be
 * caught by a literal assertion at build time, because nothing at run time
 * will ever raise its hand.
 *
 * So: the id list is pinned LITERALLY, not derived from the table it
 * describes. Deriving it would make the test agree with any typo.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  BILLING_FEATURES,
  BILLING_FEATURE_IDS,
  BILLING_GROUPS,
  BILLING_GROUP_LABELS,
  BILLING_SITES,
  billingFeature,
  billingRefusalBody,
  billingRefusalSentence,
  featuresForSite,
  isBillingFeatureId,
  isBillingSite,
} from '../src/billing-registry.js';

test('⚠️ THE PIN — the 18 feature ids of design §3.2, spelled exactly', () => {
  assert.deepEqual(
    [...BILLING_FEATURE_IDS],
    [
      'research.details',
      'research.covers',
      'research.series',
      'research.tier',
      'research.isbn',
      'barcode.paid',
      'warnings.web',
      'chapters.llm',
      'scan.photo',
      'gabi.panel',
      'gabi.chat',
      'gabi.memory',
      'gabi.confirm',
      'sweep.details',
      'authors.match',
      'pipeline.run',
      'cli.backfill',
      'prompts.generate',
    ],
  );
});

test('the table and the pin cannot drift — same ids, same order, no duplicates', () => {
  assert.deepEqual(
    BILLING_FEATURES.map((f) => f.id),
    [...BILLING_FEATURE_IDS],
    'BILLING_FEATURES and BILLING_FEATURE_IDS must be the same list in the same order',
  );
  assert.equal(new Set(BILLING_FEATURE_IDS).size, BILLING_FEATURE_IDS.length, 'a duplicate id would silently shadow one feature');
});

test('the site vocabulary is its own, and is NOT the catalog vocabulary', () => {
  assert.deepEqual([...BILLING_SITES], ['library', 'library2', 'games', 'audiobook', 'estate']);
  // `ebooks` is a catalog somebody may SEE; it bills nothing, so it must never
  // appear here. `estate` bills (the apex scanner, the Discord bot) and is not
  // a catalog anyone is granted. Two questions, two vocabularies.
  assert.ok(!(BILLING_SITES as readonly string[]).includes('ebooks'));
  assert.ok(isBillingSite('estate'));
  assert.ok(!isBillingSite('ebooks'));
  assert.ok(!isBillingSite('Library'));
});

test('every feature is complete — a row nobody can read is a row nobody will use', () => {
  for (const f of BILLING_FEATURES) {
    assert.ok(/^[a-z]+\.[a-z]+$/.test(f.id), `${f.id} should be lowercase dotted`);
    assert.ok(f.label.length > 3, `${f.id} needs a label`);
    assert.ok(
      f.detail.length > 25,
      `${f.id} needs a sentence — the owner is switching off something he must be able to recognise`,
    );
    assert.ok(BILLING_GROUPS.includes(f.group), `${f.id} has an unknown group`);
    assert.ok(f.sites.length > 0, `${f.id} exists nowhere — delete it`);
    for (const s of f.sites) assert.ok(isBillingSite(s), `${f.id} names an unknown site ${s}`);
    assert.ok(f.paths.length > 0, `${f.id} names no §2 inventory row — the audit trail is the point`);
    for (const p of f.paths) assert.ok(/^[LGAE]\d+$/.test(p), `${f.id} path ${p} is not a §2 row id`);
    // ⚠️ The cost is the CODE'S OWN ESTIMATE (§7.1), and every row carries one
    // because the owner is switching off something whose price he can see.
    assert.ok(f.cost.length > 2, `${f.id} needs a cost estimate`);
    assert.ok(f.principals.length > 0, `${f.id} has no principal — who triggers it?`);
    for (const p of f.principals) assert.ok(p === 'person' || p === 'system', `${f.id} bad principal ${p}`);
  }
});

test('every group has a label — the matrix draws headings from this map', () => {
  for (const g of BILLING_GROUPS) {
    assert.ok(BILLING_GROUP_LABELS[g], `group ${g} has no label`);
  }
});

test('⚠️ the two unattended billers are `system`, and nothing else pretends to be', () => {
  // §2.5: L8 and G7 have no user at all, so a per-person toggle is structurally
  // inapplicable and a `system` rule is the only thing that can stop them.
  const sweep = billingFeature('sweep.details');
  assert.ok(sweep);
  assert.deepEqual([...sweep.principals], ['system']);
  assert.deepEqual([...sweep.paths], ['L8', 'G7']);
  // warnings.web is BOTH — a person pressing A3's button, and A5's hourly
  // Action paying for the queue it fills.
  const warnings = billingFeature('warnings.web');
  assert.ok(warnings);
  assert.deepEqual([...warnings.principals], ['person', 'system']);
});

test('⚠️ every one of design §2’s 36 money paths is covered, and the DOUBLE covers are the doc’s own', () => {
  // A path in no feature is a path no switch can reach — that is the failure
  // this asserts against. A path in TWO features is legal here and safe by
  // construction, because policy can only DENY: the path is refused if EITHER
  // switch denies it. §3.2's own table does exactly that twice (L9 under both
  // `research.covers` and `cli.backfill`; L10 under both `research.isbn` and
  // `cli.backfill`), and the mapping is reproduced verbatim rather than
  // "tidied" — the doc is the source, and a union of denies fails safe.
  const seen = new Map<string, string[]>();
  for (const f of BILLING_FEATURES) {
    for (const p of [...f.paths, ...(f.frontedBy ?? [])]) {
      seen.set(p, [...(seen.get(p) ?? []), f.id]);
    }
  }

  const doubled = [...seen.entries()].filter(([, ids]) => ids.length > 1).map(([p]) => p).sort();
  assert.deepEqual(
    doubled,
    ['E7', 'L10', 'L9'],
    'a NEW double cover appeared — check it is deliberate before widening this list',
  );
  // ⚠️ E7 is covered as a RUNG, not a path of its own: it fronts E1/E2/E4/E5
  // across three different features, so denying any of them stops both rungs —
  // no Groq attempt and no Haiku fall-through.
  assert.deepEqual(seen.get('E7'), ['gabi.chat', 'gabi.memory', 'gabi.confirm']);

  const expected = [
    ...Array.from({ length: 13 }, (_, i) => `L${i + 1}`),
    ...Array.from({ length: 7 }, (_, i) => `G${i + 1}`),
    ...Array.from({ length: 9 }, (_, i) => `A${i + 1}`),
    ...Array.from({ length: 7 }, (_, i) => `E${i + 1}`),
  ];
  // ⚠️ A6 is DELIBERATELY ABSENT: the ebook cover classifier is keyed on a
  // secret that is absent from `.env` on purpose (§2.3), so it bills zero
  // today. Registering a dead path would be a switch that does nothing, which
  // is worse than no switch — the design's own warning about dead rows.
  const notCovered = expected.filter((p) => !seen.has(p));
  assert.deepEqual(notCovered, ['A6'], 'only A6 (deliberately dead) may be uncovered');
});

test('featuresForSite draws the matrix column — and n/a is a real answer', () => {
  const estate = featuresForSite('estate').map((f) => f.id);
  assert.deepEqual(estate, ['scan.photo', 'gabi.chat', 'gabi.memory', 'gabi.confirm']);
  // The games site has no GABI panel and no cover search — those cells render
  // `n/a`, not `on`, and drawing them as `on` would invite a click that does
  // nothing.
  const games = featuresForSite('games').map((f) => f.id);
  assert.ok(!games.includes('gabi.panel'));
  assert.ok(!games.includes('research.covers'));
  assert.ok(games.includes('research.tier'));
  assert.ok(featuresForSite('library2').length > 0, 'the second instance runs the same source and gets the same rows');
});

test('isBillingFeatureId rejects the near-misses that would fail open', () => {
  assert.ok(isBillingFeatureId('research.covers'));
  // The exact typo §3.2 warns about.
  assert.ok(!isBillingFeatureId('research.cover'));
  assert.ok(!isBillingFeatureId('Research.Covers'));
  assert.ok(!isBillingFeatureId(''));
  assert.ok(!isBillingFeatureId(null));
  assert.ok(!isBillingFeatureId(42));
});

test('⚠️ the refusal says WHAT, WHAT IT NEEDS and HOW — and never the owner’s `why`', () => {
  const site = billingRefusalSentence('research.covers', 'site');
  const person = billingRefusalSentence('research.covers', 'person');
  assert.notEqual(site, person, 'the site/person split is load-bearing (§6)');
  assert.match(site, /this catalogue/);
  assert.match(person, /for you/);
  assert.match(person, /Ask the owner/);

  const body = billingRefusalBody('research.covers', 'person');
  assert.equal(body.error, 'billing_denied');
  assert.ok(body.detail.length > 20, 'a person must never meet a bare status');
  assert.ok(body.needs.length > 0);
  assert.match(body.how, /10 minutes/, 'the ten-minute delay is stated, or the owner presses it twice');
  // The refusal must not leak the rule's internal note — it may name people.
  assert.ok(!('why' in body));
});

test('an unknown id still produces a sentence rather than "undefined"', () => {
  // A registry that has moved on must not brick a Worker (§3.5 row 4) and must
  // not render the word `undefined` at a person either.
  const s = billingRefusalSentence('research.cover', 'site');
  assert.ok(!/undefined/.test(s));
  assert.match(s, /switched off/);
});
