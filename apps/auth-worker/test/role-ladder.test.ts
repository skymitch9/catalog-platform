import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  canGrant,
  effectiveLadderRole,
  GRANT_FLOOR,
  isLadderRole,
  isSiteRole,
  ROLE_CAPABILITIES,
  ROLE_LADDER,
  roleAtLeast,
  roleRank,
  SITE_ROLES,
  type LadderRole,
} from '../src/role-ladder.js';

// ---------------------------------------------------------------------------
// The ladder itself — order, membership, what is/isn't stored/grantable.
// ---------------------------------------------------------------------------

test('ROLE_LADDER: the exact cumulative order, viewer lowest, owner highest', () => {
  assert.deepEqual(ROLE_LADDER, ['viewer', 'reader', 'contributor', 'moderator', 'admin', 'owner']);
});

test('SITE_ROLES: the grantable subset excludes viewer (never stored) and owner (DB-only)', () => {
  assert.deepEqual(SITE_ROLES, ['reader', 'contributor', 'moderator', 'admin']);
  assert.ok(!(SITE_ROLES as readonly string[]).includes('viewer'));
  assert.ok(!(SITE_ROLES as readonly string[]).includes('owner'));
});

test('GRANT_FLOOR is moderator — reader/contributor hold no grant power at all', () => {
  assert.equal(GRANT_FLOOR, 'moderator');
});

test('isLadderRole / isSiteRole: type guards agree with the arrays', () => {
  for (const r of ROLE_LADDER) assert.ok(isLadderRole(r));
  assert.ok(!isLadderRole('overlord'));
  assert.ok(!isLadderRole(undefined));
  for (const r of SITE_ROLES) assert.ok(isSiteRole(r));
  assert.ok(!isSiteRole('viewer'));
  assert.ok(!isSiteRole('owner'));
});

// ---------------------------------------------------------------------------
// roleRank / roleAtLeast — the one comparison every check should route through
// ---------------------------------------------------------------------------

test('roleRank: strictly increasing along the ladder', () => {
  const ranks = ROLE_LADDER.map(roleRank);
  assert.deepEqual(ranks, [0, 1, 2, 3, 4, 5]);
});

test('roleAtLeast: reflexive, and correct in both directions', () => {
  assert.ok(roleAtLeast('admin', 'admin'));
  assert.ok(roleAtLeast('admin', 'moderator'));
  assert.ok(!roleAtLeast('moderator', 'admin'));
  assert.ok(roleAtLeast('owner', 'viewer'));
  assert.ok(!roleAtLeast('viewer', 'reader'));
});

// ---------------------------------------------------------------------------
// canGrant — THE escalation matrix. Every case named in the build brief,
// plus the boundary cases that make the rule airtight.
// ---------------------------------------------------------------------------

test('canGrant: admin -> admin FAILS (no self-escalation, no peer-promotion — admin may not mint admins)', () => {
  const r = canGrant('admin', 'admin');
  assert.equal(r.ok, false);
});

test('canGrant: admin -> moderator PASSES (strictly beneath)', () => {
  assert.equal(canGrant('admin', 'moderator').ok, true);
});

test('canGrant: moderator -> admin FAILS (cannot grant a role above your own)', () => {
  assert.equal(canGrant('moderator', 'admin').ok, false);
});

test('canGrant: moderator -> contributor and moderator -> reader both PASS', () => {
  assert.equal(canGrant('moderator', 'contributor').ok, true);
  assert.equal(canGrant('moderator', 'reader').ok, true);
});

test('canGrant: moderator -> moderator FAILS (peer-promotion)', () => {
  assert.equal(canGrant('moderator', 'moderator').ok, false);
});

test('canGrant: owner -> admin PASSES (owner is the only granter of admin, per ROLES.md)', () => {
  assert.equal(canGrant('owner', 'admin').ok, true);
});

test('canGrant: owner -> owner FAILS — no path for owner to touch owner, not even itself', () => {
  const r = canGrant('owner', 'owner');
  assert.equal(r.ok, false);
});

test('canGrant: NOTHING can touch owner — every actor, including owner, refused as a target', () => {
  for (const actor of ROLE_LADDER) {
    const r = canGrant(actor, 'owner');
    assert.equal(r.ok, false, `${actor} -> owner should be refused`);
  }
});

test('canGrant: contributor holds NO grant power, even over reader (ROLES.md\'s own answer: "moderator+", not contributor+)', () => {
  assert.equal(canGrant('contributor', 'reader').ok, false);
  assert.equal(canGrant('contributor', 'contributor').ok, false);
  assert.equal(canGrant('contributor', 'viewer').ok, false);
});

test('canGrant: reader and viewer hold no grant power over anything, including viewer itself', () => {
  assert.equal(canGrant('reader', 'viewer').ok, false);
  assert.equal(canGrant('viewer', 'viewer').ok, false);
});

test('canGrant: a denial always names a reason (the clear 403 the brief asks for)', () => {
  const belowFloor = canGrant('contributor', 'reader');
  assert.equal(belowFloor.ok, false);
  if (!belowFloor.ok) assert.ok(belowFloor.reason.length > 0);

  const peerOrAbove = canGrant('admin', 'admin');
  assert.equal(peerOrAbove.ok, false);
  if (!peerOrAbove.ok) assert.ok(peerOrAbove.reason.length > 0);
});

test('canGrant: the full legal-grant matrix for moderator/admin/owner (every SITE_ROLES entry)', () => {
  const expectMod = { reader: true, contributor: true, moderator: false, admin: false };
  const expectAdmin = { reader: true, contributor: true, moderator: true, admin: false };
  const expectOwner = { reader: true, contributor: true, moderator: true, admin: true };
  for (const role of SITE_ROLES) {
    assert.equal(canGrant('moderator', role).ok, expectMod[role], `moderator -> ${role}`);
    assert.equal(canGrant('admin', role).ok, expectAdmin[role], `admin -> ${role}`);
    assert.equal(canGrant('owner', role).ok, expectOwner[role], `owner -> ${role}`);
  }
});

// ---------------------------------------------------------------------------
// effectiveLadderRole — OWNER_EMAILS always wins; otherwise the stored
// Firestore value; otherwise viewer. This is where the two-owner-accounts
// requirement actually gets proven at the ladder layer (not just the env
// parser layer — see env.test.ts for that half).
// ---------------------------------------------------------------------------

const TWO_OWNERS: readonly [string, string] = ['owner-primary@example.com', 'owner-second@example.com'];

test('effectiveLadderRole: BOTH owner accounts resolve to owner, independently, regardless of any stored role', () => {
  for (const email of TWO_OWNERS) {
    assert.equal(
      effectiveLadderRole({ email, ownerEmails: TWO_OWNERS, storedRole: null }),
      'owner',
    );
    // Even if a stray/legacy doc says something else (e.g. the second
    // owner account's real Firestore doc holds role:'admin' today, per the
    // build note — OWNER_EMAILS still wins over any stored value).
    assert.equal(
      effectiveLadderRole({ email, ownerEmails: TWO_OWNERS, storedRole: 'admin' }),
      'owner',
    );
  }
});

test('effectiveLadderRole: the SECOND owner account is not silently dropped by a naive single-entry check', () => {
  const role = effectiveLadderRole({
    email: 'owner-second@example.com',
    ownerEmails: TWO_OWNERS,
    storedRole: null,
  });
  assert.equal(role, 'owner');
});

test('effectiveLadderRole: case/whitespace-insensitive against the owner list', () => {
  assert.equal(
    effectiveLadderRole({ email: '  Owner-Second@Example.COM  ', ownerEmails: TWO_OWNERS, storedRole: null }),
    'owner',
  );
});

test('effectiveLadderRole: a non-owner with a recognized stored role gets exactly that role', () => {
  assert.equal(
    effectiveLadderRole({ email: 'mod@example.com', ownerEmails: TWO_OWNERS, storedRole: 'moderator' }),
    'moderator',
  );
});

test('effectiveLadderRole: no doc (null) -> viewer', () => {
  assert.equal(
    effectiveLadderRole({ email: 'nobody@example.com', ownerEmails: TWO_OWNERS, storedRole: null }),
    'viewer',
  );
});

test('effectiveLadderRole: an unrecognized stored value never gets silently promoted -> viewer', () => {
  assert.equal(
    effectiveLadderRole({ email: 'x@example.com', ownerEmails: TWO_OWNERS, storedRole: 'overlord' }),
    'viewer',
  );
});

test('effectiveLadderRole: a stray hand-seeded role:"owner" doc IS trusted on read (write path stays API-closed)', () => {
  // Reading trusts the DB (a direct D1/Firestore edit is the only way
  // 'owner' is ever written); the API never writes it — proven separately
  // by SITE_ROLES excluding 'owner' and roleBodySchema (site-roles.test.ts)
  // refusing it as a POST body value.
  assert.equal(
    effectiveLadderRole({ email: 'hand-seeded@example.com', ownerEmails: [], storedRole: 'owner' }),
    'owner',
  );
});

test('effectiveLadderRole + canGrant together: an owner row is immune even when the actor is the OTHER owner account', () => {
  const [ownerA, ownerB] = TWO_OWNERS;
  const actorRole = effectiveLadderRole({ email: ownerA, ownerEmails: TWO_OWNERS, storedRole: null });
  const targetCurrentRole = effectiveLadderRole({ email: ownerB, ownerEmails: TWO_OWNERS, storedRole: 'admin' });
  assert.equal(actorRole, 'owner');
  assert.equal(targetCurrentRole, 'owner');
  const check = canGrant(actorRole, targetCurrentRole);
  assert.equal(check.ok, false, 'one owner account must never be able to touch the other via the grant API');
});

// ---------------------------------------------------------------------------
// ROLE_CAPABILITIES — the role tree / capability map endpoint's data.
// ---------------------------------------------------------------------------

test('ROLE_CAPABILITIES: one row per ladder role, in ladder order, ranks match roleRank', () => {
  assert.equal(ROLE_CAPABILITIES.length, ROLE_LADDER.length);
  ROLE_CAPABILITIES.forEach((cap, i) => {
    assert.equal(cap.role, ROLE_LADDER[i]);
    assert.equal(cap.rank, roleRank(cap.role as LadderRole));
  });
});

test('ROLE_CAPABILITIES: viewer and owner are both present and both apiGrantable:false', () => {
  const viewer = ROLE_CAPABILITIES.find((c) => c.role === 'viewer');
  const owner = ROLE_CAPABILITIES.find((c) => c.role === 'owner');
  assert.ok(viewer);
  assert.ok(owner);
  assert.equal(viewer?.apiGrantable, false);
  assert.equal(owner?.apiGrantable, false);
});

test('ROLE_CAPABILITIES: exactly reader/contributor/moderator/admin are apiGrantable (matches SITE_ROLES)', () => {
  const grantable = ROLE_CAPABILITIES.filter((c) => c.apiGrantable).map((c) => c.role).sort();
  assert.deepEqual(grantable, [...SITE_ROLES].sort());
});

test('ROLE_CAPABILITIES: reader/contributor are marked NOT rules-enforced (the stated firestore.rules limitation)', () => {
  const reader = ROLE_CAPABILITIES.find((c) => c.role === 'reader');
  const contributor = ROLE_CAPABILITIES.find((c) => c.role === 'contributor');
  assert.equal(reader?.rulesEnforced, false);
  assert.equal(contributor?.rulesEnforced, false);
});

test('ROLE_CAPABILITIES: moderator/admin ARE marked rules-enforced (true today, per firestore.rules)', () => {
  const moderator = ROLE_CAPABILITIES.find((c) => c.role === 'moderator');
  const admin = ROLE_CAPABILITIES.find((c) => c.role === 'admin');
  assert.equal(moderator?.rulesEnforced, true);
  assert.equal(admin?.rulesEnforced, true);
});
