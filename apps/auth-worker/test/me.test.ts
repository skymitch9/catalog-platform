import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { EstateUserRow } from '../src/env.js';
import { meAnswer } from '../src/me.js';

/**
 * The default `billing_denied` (0016): nothing switched off anywhere. An EMPTY
 * policy table is exactly today's behaviour (§3.3 rank 17), so this is what
 * every one of these envelopes must carry until somebody writes a rule.
 */
const NO_DENIALS = { library: [], library2: [], games: [], audiobook: [], estate: [] };

function row(over: Partial<EstateUserRow> = {}): EstateUserRow {
  return {
    id: 1,
    email: 'bob@example.com',
    firebase_uid: 'uid-bob',
    display_name: 'Bob',
    status: 'pending',
    is_approver: 0,
    is_devops: 0,
    // 0011's DB default: nobody holds the dev lane by hand until an approver
    // grants it. A fixture starting at 1 would hide the devops-implies OR,
    // which is the whole of what that migration is for.
    dev_access: 0,
    origin: 'seen:library',
    note: null,
    first_seen_at: '2026-08-14 00:00:00',
    decided_at: null,
    decided_by: null,
    vis_audiobook: 1,
    vis_library: 1,
    vis_games: 1,
    // Mirrors the DB defaults: 0002's three are DEFAULT 1, 0007's library2
    // is DEFAULT 0 — a fixture that granted it silently would hide the point.
    vis_library2: 0,
    // 0008 joins with the same reasoning: DEFAULT 0 in the DB, so a fixture
    // that granted the ebook shelf by accident would hide exactly what that
    // migration is for. (There is no dl_ebooks here: 0009 left the row shape
    // on 2026-08-17 — see the note above the removed download tests below.)
    vis_ebooks: 0,
    ...over,
  };
}

test('meAnswer: not in the directory → status null, never an error shape', () => {
  assert.deepEqual(meAnswer(null, false), {
    status: null,
    is_approver: false,
    is_devops: false,
    dev_access: false,
    // The public slice — the same thing the anonymous internet sees (§4.5).
    visibility: ['audiobook'],
    // 0016: nothing is switched off, because the default answer is the empty
    // one — an empty policy table is exactly today's behaviour (§3.3 rank 17).
    billing_denied: NO_DENIALS,
  });
});

test('meAnswer: pending → the public slice, whatever the stored flags say', () => {
  assert.deepEqual(meAnswer(row({ status: 'pending' }), false), {
    status: 'pending',
    is_approver: false,
    is_devops: false,
    dev_access: false,
    visibility: ['audiobook'],
    billing_denied: NO_DENIALS,
  });
});

test('meAnswer: approved → the stored set, narrowing included', () => {
  assert.deepEqual(meAnswer(row({ status: 'approved' }), false), {
    status: 'approved',
    is_approver: false,
    is_devops: false,
    dev_access: false,
    visibility: ['audiobook', 'library', 'games'],
    billing_denied: NO_DENIALS,
  });
  assert.deepEqual(
    meAnswer(row({ status: 'approved', vis_library: 0, vis_games: 0 }), false).visibility,
    ['audiobook'],
  );
  // An approver may have narrowed to nothing — approved with {} is legal.
  assert.deepEqual(
    meAnswer(row({ status: 'approved', vis_audiobook: 0, vis_library: 0, vis_games: 0 }), false)
      .visibility,
    [],
  );
});

test('meAnswer: library2 (0007) appears ONLY when deliberately granted, appended last', () => {
  // The fixture's defaults mirror the DB's: approval alone never grants it.
  assert.deepEqual(meAnswer(row({ status: 'approved' }), false).visibility, [
    'audiobook',
    'library',
    'games',
  ]);
  // Granted by hand → it rides the answer, canonical order (last).
  assert.deepEqual(meAnswer(row({ status: 'approved', vis_library2: 1 }), false).visibility, [
    'audiobook',
    'library',
    'games',
    'library2',
  ]);
  // Her own shape: library2 alone is a legal stored set.
  assert.deepEqual(
    meAnswer(row({ status: 'approved', vis_audiobook: 0, vis_library: 0, vis_games: 0, vis_library2: 1 }), false)
      .visibility,
    ['library2'],
  );
  // Pending/revoked rules unchanged: the flag is inert off-approval.
  assert.deepEqual(meAnswer(row({ status: 'pending', vis_library2: 1 }), false).visibility, ['audiobook']);
  assert.deepEqual(meAnswer(row({ status: 'revoked', vis_library2: 1 }), false).visibility, []);
});

test('meAnswer: revoked → {} — revocation beats the public slice', () => {
  assert.deepEqual(meAnswer(row({ status: 'revoked' }), false), {
    status: 'revoked',
    is_approver: false,
    is_devops: false,
    dev_access: false,
    visibility: [],
    billing_denied: NO_DENIALS,
  });
});

test('meAnswer: is_approver mirrors the raw flag requireApprover reads', () => {
  assert.equal(meAnswer(row({ status: 'approved', is_approver: 1 }), false).is_approver, true);
  assert.equal(meAnswer(row({ status: 'approved', is_approver: 0 }), false).is_approver, false);
  // Not gated on status — /me reports exactly what the admin gate would honour.
  assert.equal(meAnswer(row({ status: 'revoked', is_approver: 1 }), false).is_approver, true);
});

test('meAnswer: OWNER_EMAILS break-glass wins over every table state (§4.3)', () => {
  // Owners see EVERY catalog — the DEFAULT 0 of library2 AND of ebooks
  // included. The owner is the estate's operator, and break-glass is never
  // narrowable. (Downloading is the audiobook ladder's question since
  // 2026-08-17; OWNER_EMAILS forces `owner` there too.)
  const want = {
    status: 'approved',
    is_approver: true,
    is_devops: true,
    // 0011 rides the break-glass too: an owner locked out of the dev lane by
    // the directory being wrong about its own owner is the failure §4.3 exists
    // to make impossible.
    dev_access: true,
    visibility: ['audiobook', 'library', 'games', 'library2', 'ebooks'],
    // 0016 rides the break-glass too: an owner cannot have his spending
    // switched off, for the same reason his visibility cannot be narrowed.
    billing_denied: NO_DENIALS,
  };
  // No row at all — the empty-directory bootstrap.
  assert.deepEqual(meAnswer(null, true), want);
  // A revoked row — the directory being wrong about its own owner.
  assert.deepEqual(meAnswer(row({ status: 'revoked' }), true), want);
  // A narrowed row — the break-glass cannot be narrowed into a lockout.
  assert.deepEqual(
    meAnswer(row({ status: 'approved', vis_audiobook: 0, vis_library: 0, vis_games: 0 }), true),
    want,
  );
});

test('meAnswer: is_devops is EFFECTIVE — raw flag OR approver (0003)', () => {
  assert.equal(meAnswer(row({ status: 'approved', is_devops: 1 }), false).is_devops, true);
  assert.equal(meAnswer(row({ status: 'approved', is_devops: 0 }), false).is_devops, false);
  // Approvers hold every devops surface implicitly — /me must say so, or the
  // status page's Operations section would hide from the people who run it.
  assert.equal(meAnswer(row({ status: 'approved', is_approver: 1, is_devops: 0 }), false).is_devops, true);
});

// ---------------------------------------------------------------------------
// 0008 — the ebook gate the owner asked for on 2026-08-17 ("ebooks should be
// like the other site where we grant permission to view it. I don't want people
// scraping my books"). ⚠️ 0009's download half was REMOVED from this Worker the
// next day by a second directive — see the two tests at the bottom.
// ---------------------------------------------------------------------------

test('meAnswer: `ebooks` (0008) appears ONLY when deliberately granted, appended last', () => {
  // Approval alone never grants it — the fixture mirrors the DB defaults.
  assert.equal(meAnswer(row({ status: 'approved' }), false).visibility.includes('ebooks'), false);
  assert.deepEqual(meAnswer(row({ status: 'approved', vis_ebooks: 1 }), false).visibility, [
    'audiobook',
    'library',
    'games',
    'ebooks',
  ]);
  // Inert off-approval, like every flag: the shelf is for approved members.
  assert.deepEqual(meAnswer(row({ status: 'pending', vis_ebooks: 1 }), false).visibility, ['audiobook']);
  assert.deepEqual(meAnswer(row({ status: 'revoked', vis_ebooks: 1 }), false).visibility, []);
});

test('⚠️ /me answers NOTHING about downloads — that is the ladder’s question now', () => {
  // The round trip this pins, so nobody re-adds the field believing it was
  // simply forgotten:
  //   2026-08-16  0009 adds `dl_ebooks` + a `download_ebooks` answer here
  //   2026-08-17  the owner supersedes it — *"For ebooks I don't want a
  //               download check box, I want to use roles we have. Set up the
  //               roles to match library."*
  //
  // So this Worker answers WHO MAY SEE the shelf and stops there. Whether a
  // person may take a file away is `can(role, 'download')` against the
  // audiobook ladder (floor `admin`), resolved by audiobook-worker from the
  // caller's site_roles doc — nothing in D1 and nothing on this answer.
  for (const answer of [
    meAnswer(null, false),
    meAnswer(null, true),
    meAnswer(row({ status: 'approved', vis_ebooks: 1 }), false),
    meAnswer(row({ status: 'approved', is_approver: 1, vis_ebooks: 1 }), false),
  ]) {
    assert.deepEqual(
      Object.keys(answer).sort(),
      // ⚠️ `dev_access` (0011) is NOT a download key — it is the /dev/ lane
      // curtain's answer, and it gates no bytes. The assertion below still
      // pins the absence of any download field on every branch.
      // `billing_denied` (0016) joined 2026-09-02 and is not a download key
      // either — it is the SPENDING curtain, per site, and it opens nothing.
      ['billing_denied', 'dev_access', 'is_approver', 'is_devops', 'status', 'visibility'],
      'no download key on any branch, including the owner break-glass',
    );
  }
});

test('the ebook shelf stays a VIEW grant, and revocation still closes it', () => {
  // The half that did NOT change on 2026-08-17. `vis_ebooks` still admits a
  // person to the shelf and to reading in the browser viewer, and it is still
  // inert off approval — the download rework touched none of this.
  assert.equal(meAnswer(row({ status: 'approved', vis_ebooks: 1 }), false).visibility.includes('ebooks'), true);
  assert.deepEqual(meAnswer(row({ status: 'revoked', vis_ebooks: 1 }), false).visibility, []);
});
