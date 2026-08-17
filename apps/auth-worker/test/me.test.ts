import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { EstateUserRow } from '../src/env.js';
import { downloadEbooks, meAnswer } from '../src/me.js';

function row(over: Partial<EstateUserRow> = {}): EstateUserRow {
  return {
    id: 1,
    email: 'bob@example.com',
    firebase_uid: 'uid-bob',
    display_name: 'Bob',
    status: 'pending',
    is_approver: 0,
    is_devops: 0,
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
    // 0008/0009 join with the same reasoning: DEFAULT 0 in the DB, so a
    // fixture that granted the ebook shelf or its downloads by accident would
    // hide exactly what those migrations are for.
    vis_ebooks: 0,
    dl_ebooks: 0,
    ...over,
  };
}

test('meAnswer: not in the directory → status null, never an error shape', () => {
  assert.deepEqual(meAnswer(null, false), {
    status: null,
    is_approver: false,
    is_devops: false,
    // The public slice — the same thing the anonymous internet sees (§4.5).
    visibility: ['audiobook'],
    // 0009: a stranger holds no download grant. `ebooks` is not in the public
    // slice either, so there is nothing to download and nothing to see.
    download_ebooks: false,
  });
});

test('meAnswer: pending → the public slice, whatever the stored flags say', () => {
  assert.deepEqual(meAnswer(row({ status: 'pending' }), false), {
    status: 'pending',
    is_approver: false,
    is_devops: false,
    visibility: ['audiobook'],
    download_ebooks: false,
  });
});

test('meAnswer: approved → the stored set, narrowing included', () => {
  assert.deepEqual(meAnswer(row({ status: 'approved' }), false), {
    status: 'approved',
    is_approver: false,
    is_devops: false,
    visibility: ['audiobook', 'library', 'games'],
    download_ebooks: false,
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
    visibility: [],
    download_ebooks: false,
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
  // included — and hold the download grant. The owner is the estate's
  // operator, and break-glass is never narrowable.
  const want = {
    status: 'approved',
    is_approver: true,
    is_devops: true,
    visibility: ['audiobook', 'library', 'games', 'library2', 'ebooks'],
    download_ebooks: true,
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
// 0008/0009 — the ebook gate the owner asked for on 2026-08-17 ("ebooks should
// be like the other site where we grant permission to view it. I don't want
// people scraping my books"), and the download side permission beside it.
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

test('downloadEbooks: the owner model — admin+ by default, grantable at any level', () => {
  // A plain member: no.
  assert.equal(downloadEbooks(row({ status: 'approved' }), false), false);
  // Granted by hand, still a plain member: yes. ("individually grantable to
  // any person at any ladder level")
  assert.equal(downloadEbooks(row({ status: 'approved', dl_ebooks: 1 }), false), true);
  // An estate approver holds it WITHOUT the column being set — the admin+
  // half is computed, never stored (0009's header argues why).
  assert.equal(downloadEbooks(row({ status: 'approved', is_approver: 1 }), false), true);
  assert.equal(row({ is_approver: 1 }).dl_ebooks, 0);
  // The owner, with no row at all.
  assert.equal(downloadEbooks(null, true), true);
  // A stranger.
  assert.equal(downloadEbooks(null, false), false);
});

test('⚠️ download NEVER implies the shelf — a granted download with no vis_ebooks sees nothing', () => {
  // The trap this pins: `download_ebooks` is a side permission, not a way in.
  // Someone reading only the capability would conclude this person can reach
  // the files; they cannot, because the manifest gate reads `visibility`.
  const answer = meAnswer(row({ status: 'approved', dl_ebooks: 1 }), false);
  assert.equal(answer.download_ebooks, true);
  assert.equal(answer.visibility.includes('ebooks'), false);
});

test('a revoked person keeps no download in practice — the shelf is gone either way', () => {
  // dl_ebooks is deliberately NOT status-gated (it is a capability, not a
  // power), so the flag still reads true here. What makes that safe is that
  // the visibility half is empty, so there is nothing to download.
  const answer = meAnswer(row({ status: 'revoked', dl_ebooks: 1, vis_ebooks: 1 }), false);
  assert.deepEqual(answer.visibility, []);
});
