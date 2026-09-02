/**
 * universe-requests.test.ts — the "+ add a verse" doors, exercised against the
 * REAL exported `universeRequestRoutes` with a small in-memory D1.
 *
 * ⚠️ MOST OF THIS FILE IS ABOUT THINGS THE FEATURE MUST REFUSE, and that is the
 * shape of the risk. This queue is read by exactly one scarce person, and the
 * two ways it fails are both quiet: it accepts a request for a universe that
 * already exists under another spelling (the owner then declines something that
 * was never new), or it lets a member believe a verse exists when nothing in
 * `data/universes.json` has been touched. The happy paths are two tests; the
 * refusals are the rest.
 *
 * ⚠️ Identity is chosen by `DEV_EMAIL` — `resolveIdentity()`'s dev bypass fires
 * on `ENVIRONMENT === 'development'`, so each helper below passes the actor's
 * email in the env rather than minting Firebase tokens.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  APPROVED_STALE_DAYS,
  checkName,
  normName,
  parseRequestBody,
  toWire,
  universeRequestRoutes,
} from '../src/universe-requests.js';
import { UNIVERSE_NAMES } from '../src/universe-names.generated.js';

const OWNER = 'owner@example.com';
const MEMBER = 'member@example.com';
const OTHER = 'other@example.com';
const PENDING = 'pending@example.com';
const REVOKED = 'revoked@example.com';
const DEVOPS = 'devops@example.com';
const STRANGER = 'stranger@example.com';

interface UserRow {
  id: number;
  email: string;
  firebase_uid: string | null;
  display_name: string | null;
  status: string;
  is_approver: number;
  is_devops: number;
  dev_access: number;
  origin: string;
  note: string | null;
  first_seen_at: string;
  decided_at: string | null;
  decided_by: number | null;
  vis_audiobook: number;
  vis_library: number;
  vis_games: number;
  vis_library2: number;
  vis_ebooks: number;
}

interface ReqRow {
  id: number;
  name: string;
  name_key: string;
  payload: string;
  why: string;
  requested_by: number;
  requested_at: string;
  status: string;
  decided_by: number | null;
  decided_at: string | null;
  decided_why: string | null;
  landed_commit: string | null;
}

function user(id: number, email: string, over: Partial<UserRow> = {}): UserRow {
  return {
    id,
    email,
    firebase_uid: `uid-${id}`,
    display_name: email.split('@')[0] ?? null,
    status: 'approved',
    is_approver: 0,
    is_devops: 0,
    dev_access: 0,
    origin: 'test',
    note: null,
    first_seen_at: '2026-01-01T00:00:00.000Z',
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

/**
 * A D1 fake that understands exactly the statements this feature issues.
 *
 * ⚠️ `missingTable` reproduces D1's own "no such table" error rather than a
 * generic throw, because the WHOLE POINT of the 503 branch it exercises is that
 * a Worker shipped ahead of its migration says so in words instead of reading as
 * an outage.
 */
class FakeDB {
  users: UserRow[] = [
    user(1, OWNER, { is_approver: 1 }),
    user(2, MEMBER),
    user(3, OTHER),
    user(4, PENDING, { status: 'pending' }),
    user(5, REVOKED, { status: 'revoked' }),
    user(6, DEVOPS, { is_devops: 1 }),
  ];
  requests: ReqRow[] = [];
  nextId = 1;
  missingTable = false;

  prepare(sql: string) {
    const db = this;
    let args: unknown[] = [];
    const touchesRequests = /universe_request/.test(sql);
    const guard = () => {
      if (db.missingTable && touchesRequests) throw new Error('D1_ERROR: no such table: universe_request');
    };
    const stmt = {
      bind(...a: unknown[]) {
        args = a;
        return stmt;
      },
      async all() {
        guard();
        if (/FROM universe_request r/.test(sql)) {
          let rows = [...db.requests];
          if (/WHERE r\.requested_by/.test(sql)) rows = rows.filter((r) => r.requested_by === Number(args[0]));
          rows.sort((a, b) => b.id - a.id);
          return {
            results: rows.map((r) => {
              const u = db.users.find((x) => x.id === r.requested_by);
              const d = db.users.find((x) => x.id === r.decided_by);
              return {
                ...r,
                requester_name: u?.display_name ?? null,
                requester_email: u?.email ?? null,
                decider_name: d?.display_name ?? null,
                decider_email: d?.email ?? null,
              };
            }),
          };
        }
        return { results: [] };
      },
      async first() {
        if (/FROM estate_user WHERE email/.test(sql)) {
          return db.users.find((u) => u.email === args[0]) ?? null;
        }
        if (/FROM estate_user WHERE id/.test(sql)) {
          return db.users.find((u) => u.id === Number(args[0])) ?? null;
        }
        guard();
        if (/INSERT INTO universe_request/.test(sql)) {
          const [name, nameKey, payload, why, by, at] = args as [string, string, string, string, number, string];
          const row: ReqRow = {
            id: db.nextId++,
            name,
            name_key: nameKey,
            payload,
            why,
            requested_by: by,
            requested_at: at,
            status: 'pending',
            decided_by: null,
            decided_at: null,
            decided_why: null,
            landed_commit: null,
          };
          db.requests.push(row);
          return { id: row.id };
        }
        if (/SELECT id, requested_by, status FROM universe_request WHERE name_key/.test(sql)) {
          return (
            db.requests.find((r) => r.name_key === args[0] && (r.status === 'pending' || r.status === 'approved')) ??
            null
          );
        }
        if (/SELECT id, status, requested_by FROM universe_request WHERE id/.test(sql)) {
          return db.requests.find((r) => r.id === Number(args[0])) ?? null;
        }
        if (/SELECT id, status FROM universe_request WHERE id/.test(sql)) {
          return db.requests.find((r) => r.id === Number(args[0])) ?? null;
        }
        return null;
      },
      async run() {
        guard();
        if (/UPDATE universe_request SET status = \?1, decided_by/.test(sql)) {
          const [status, by, at, why, id] = args as [string, number, string, string | null, number];
          const row = db.requests.find((r) => r.id === Number(id) && r.status === 'pending');
          if (row) Object.assign(row, { status, decided_by: by, decided_at: at, decided_why: why });
          return { success: true };
        }
        if (/SET status = 'landed'/.test(sql)) {
          const [commit, id] = args as [string, number];
          const row = db.requests.find((r) => r.id === Number(id) && r.status === 'approved');
          if (row) Object.assign(row, { status: 'landed', landed_commit: commit });
          return { success: true };
        }
        if (/SET status = 'withdrawn'/.test(sql)) {
          const [at, id] = args as [string, number];
          const row = db.requests.find((r) => r.id === Number(id) && r.status === 'pending');
          if (row) Object.assign(row, { status: 'withdrawn', decided_at: at });
          return { success: true };
        }
        return { success: true };
      },
    };
    return stmt;
  }
  async batch() {
    return [];
  }
}

function env(db: FakeDB, as: string | null, over: Record<string, unknown> = {}) {
  return {
    DB: db as unknown as D1Database,
    OWNER_EMAILS: OWNER,
    FIREBASE_PROJECT_ID: 'test-project',
    // The dev-bypass identity — only honoured when ENVIRONMENT === 'development'
    // (the affirmative check the canonical verifier insists on). `as === null`
    // therefore means "nobody is signed in".
    ENVIRONMENT: as ? 'development' : 'production',
    ...(as ? { DEV_EMAIL: as } : {}),
    ...over,
  };
}

function call(db: FakeDB, as: string | null, path: string, init?: RequestInit) {
  return universeRequestRoutes.request(path, init as never, env(db, as));
}

function post(db: FakeDB, as: string | null, path: string, body: unknown) {
  return call(db, as, path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const GOOD = {
  name: 'Discworld',
  why: 'the whole Ankh-Morpork thing sits across three shelves and nothing groups it',
  series: ['The Watch', 'Death'],
};

// ---------------------------------------------------------------------------
// The name check — pure, and the part a naive implementation gets wrong
// ---------------------------------------------------------------------------

test('normName matches tools/lib/universes.mjs normText, curly apostrophes included', () => {
  assert.equal(normName('  The   Cosmere '), 'the cosmere');
  assert.equal(normName('The Frugal Wizard’s Handbook'), "the frugal wizard's handbook");
  assert.equal(normName(null), '');
});

test('an EXACT universe name is refused, whatever the casing', () => {
  for (const typed of ['The Cosmere', 'the cosmere', '  THE   COSMERE  ']) {
    const v = checkName(typed);
    assert.equal(v.kind, 'exists', `${typed} should already exist`);
    assert.equal((v as { universe: string }).universe, 'The Cosmere');
  }
});

test('⚠️ a KNOWN ALIAS is refused, and names the real verse — the case a naive check misses', () => {
  // "cosmere" is not a universe NAME; it is a canonicalNames key. String
  // equality lets it straight through, and the owner then declines a request
  // for a universe that already exists.
  const v = checkName('Cosmere');
  assert.equal(v.kind, 'alias');
  assert.equal((v as { universe: string }).universe, 'The Cosmere');
});

test('🔴 a near miss NEVER blocks — Marvel, Disney and Star Wars were split on purpose', () => {
  // universes.test.ts pins all three as separate universes. A similarity check
  // with a veto would have refused two of them.
  for (const typed of ['Marvelous Adventures', 'Disneyland Paris', 'Star Warriors']) {
    const v = checkName(typed);
    assert.equal(v.kind, 'free', `${typed} must be allowed through`);
  }
});

test('a near miss is REPORTED even though it does not block', () => {
  const v = checkName('Solariaa');
  assert.equal(v.kind, 'free');
  assert.deepEqual((v as { near: string[] }).near, ['Solaria']);
});

test('a genuinely new name is free and clean', () => {
  const v = checkName('Discworld');
  assert.equal(v.kind, 'free');
  assert.deepEqual((v as { near: string[] }).near, []);
});

test('the generated list is the one the check reads', () => {
  assert.ok(UNIVERSE_NAMES.includes('DotHack'), 'the generated list is stale — run scripts/gen-universe-names.mjs');
  assert.equal(checkName('DotHack').kind, 'exists');
});

// ---------------------------------------------------------------------------
// The body — refuses, never strips
// ---------------------------------------------------------------------------

test('⚠️ an unknown field is REFUSED, not silently dropped', () => {
  const r = parseRequestBody({ ...GOOD, colour: 'green' });
  assert.equal((r as { error: string }).error, 'unknown_field');
});

test('🔴 decidedHow is server-owned: a body that claims it is refused with the reason', () => {
  const r = parseRequestBody({ ...GOOD, decidedHow: 'human' });
  assert.equal((r as { error: string }).error, 'server_owned_field');
  assert.match((r as { detail: string }).detail, /not the same thing as a fact/);
});

test('⚠️ the form is not softer than the CLI: a short `why` is refused', () => {
  const r = parseRequestBody({ ...GOOD, why: 'idk' });
  assert.equal((r as { error: string }).error, 'no_reason');
  // The same 10-character floor requireReason() enforces in tools/lib/universes.mjs.
  assert.match((r as { detail: string }).detail, /at least 10 characters/);
});

test('a parsed body always carries decidedHow "human", set here and not by the caller', () => {
  const r = parseRequestBody(GOOD) as { payload: { decidedHow: string; series: string[] } };
  assert.equal(r.payload.decidedHow, 'human');
  assert.deepEqual(r.payload.series, ['The Watch', 'Death']);
});

test('blank rows in a repeatable field are dropped; a non-string is refused', () => {
  const ok = parseRequestBody({ ...GOOD, series: ['The Watch', '   ', ''] }) as { payload: { series: string[] } };
  assert.deepEqual(ok.payload.series, ['The Watch']);
  const bad = parseRequestBody({ ...GOOD, series: ['The Watch', 7] });
  assert.equal((bad as { error: string }).error, 'not_a_string');
});

// ---------------------------------------------------------------------------
// The doors
// ---------------------------------------------------------------------------

test('signed out: 401 that says what to do, never a bare status', async () => {
  const db = new FakeDB();
  const res = await post(db, null, '/estate/universes/requests', GOOD);
  assert.equal(res.status, 401);
  const body = (await res.json()) as { error: string; detail: string };
  assert.equal(body.error, 'unauthenticated');
  assert.match(body.detail, /Sign in/);
});

test('⚠️ pending and revoked get DIFFERENT sentences — the fixes are different', async () => {
  const db = new FakeDB();
  const p = await post(db, PENDING, '/estate/universes/requests', GOOD);
  assert.equal(p.status, 403);
  const pb = (await p.json()) as { error: string; detail: string };
  assert.equal(pb.error, 'estate_pending');
  assert.match(pb.detail, /awaiting approval/);
  assert.match(pb.detail, /nothing more for you to do/);

  const r = await post(db, REVOKED, '/estate/universes/requests', GOOD);
  const rb = (await r.json()) as { error: string; detail: string };
  assert.equal(rb.error, 'estate_revoked');
  assert.match(rb.detail, /Ask the owner/);
});

test('somebody with no directory row at all is told how to get one', async () => {
  const db = new FakeDB();
  const res = await post(db, STRANGER, '/estate/universes/requests', GOOD);
  assert.equal(res.status, 403);
  const body = (await res.json()) as { error: string; detail: string };
  assert.equal(body.error, 'estate_unknown');
  assert.match(body.detail, /heygabi\.ai/);
});

test('an approved member files a request, and is told a yes is not immediate', async () => {
  const db = new FakeDB();
  const res = await post(db, MEMBER, '/estate/universes/requests', GOOD);
  assert.equal(res.status, 201);
  const body = (await res.json()) as { id: number; status: string; detail: string };
  assert.equal(body.status, 'pending');
  assert.match(body.detail, /rebuilt/);
  assert.equal(db.requests.length, 1);
  assert.equal(db.requests[0]?.name_key, 'discworld');
  assert.equal(db.requests[0]?.requested_by, 2);
  // ⚠️ The stored payload carries decidedHow the SERVER set.
  assert.equal(JSON.parse(db.requests[0]?.payload ?? '{}').decidedHow, 'human');
});

test('⚠️ the alias check runs SERVER-side too — the browser copy is a convenience', async () => {
  const db = new FakeDB();
  const res = await post(db, MEMBER, '/estate/universes/requests', { ...GOOD, name: 'Cosmere' });
  assert.equal(res.status, 409);
  const body = (await res.json()) as { error: string; universe: string; detail: string };
  assert.equal(body.error, 'known_alias');
  assert.equal(body.universe, 'The Cosmere');
  assert.equal(db.requests.length, 0);
});

test('an existing universe is a worded 409, not a row', async () => {
  const db = new FakeDB();
  const res = await post(db, MEMBER, '/estate/universes/requests', { ...GOOD, name: 'Solaria' });
  assert.equal(res.status, 409);
  assert.equal(((await res.json()) as { error: string }).error, 'already_exists');
  assert.equal(db.requests.length, 0);
});

test('a second OPEN request for the same name is refused; a DECLINED one does not block a retry', async () => {
  const db = new FakeDB();
  await post(db, MEMBER, '/estate/universes/requests', GOOD);
  const dup = await post(db, OTHER, '/estate/universes/requests', GOOD);
  assert.equal(dup.status, 409);
  const dupBody = (await dup.json()) as { error: string; detail: string };
  assert.equal(dupBody.error, 'already_requested');
  // ⚠️ It does NOT say who asked — a member must not learn that from a refusal.
  assert.doesNotMatch(dupBody.detail, /member@example\.com/);

  await post(db, OWNER, '/estate/universes/requests/1/decide', {
    decision: 'declined',
    why: 'not enough of it is in the catalogs to be worth a verse yet',
  });
  const retry = await post(db, MEMBER, '/estate/universes/requests', GOOD);
  assert.equal(retry.status, 201, 'a decline plus a better argument is a legitimate sequence');
});

test('a near miss is stored on the row, so the approver sees what the requester saw', async () => {
  const db = new FakeDB();
  await post(db, MEMBER, '/estate/universes/requests', { ...GOOD, name: 'Solariaa' });
  assert.deepEqual(JSON.parse(db.requests[0]?.payload ?? '{}').near, ['Solaria']);
});

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

test('⚠️ a member sees only their OWN rows, and no requester names at all', async () => {
  const db = new FakeDB();
  await post(db, MEMBER, '/estate/universes/requests', GOOD);
  await post(db, OTHER, '/estate/universes/requests', { ...GOOD, name: 'Xanth' });

  const res = await call(db, MEMBER, '/estate/universes/requests');
  const body = (await res.json()) as { requests: Record<string, unknown>[]; scope: string; is_approver: boolean };
  assert.equal(body.scope, 'mine');
  assert.equal(body.is_approver, false);
  assert.equal(body.requests.length, 1);
  assert.equal(body.requests[0]?.name, 'Discworld');
  assert.ok(!('requested_by' in (body.requests[0] ?? {})), 'a member must not be handed other members’ identities');
  assert.equal(body.requests[0]?.mine, true);
});

test('⚠️ `mine` is computed server-side, so an approver keeps the withdraw button on their OWN row', async () => {
  // The page used to infer this from the absence of a requester name, which is
  // true for a member and false for an approver — whose own row is named like
  // every other one in the queue.
  const db = new FakeDB();
  await post(db, MEMBER, '/estate/universes/requests', GOOD);
  await post(db, OWNER, '/estate/universes/requests', { ...GOOD, name: 'Xanth' });

  const res = await call(db, OWNER, '/estate/universes/requests');
  const body = (await res.json()) as { requests: { name: string; mine: boolean; requested_by: string }[] };
  const own = body.requests.find((r) => r.name === 'Xanth');
  const theirs = body.requests.find((r) => r.name === 'Discworld');
  assert.equal(own?.mine, true);
  assert.equal(theirs?.mine, false);
  assert.equal(own?.requested_by, 'owner', 'the approver’s own row is named like every other');
});

test('an approver sees every row, with the requester named', async () => {
  const db = new FakeDB();
  await post(db, MEMBER, '/estate/universes/requests', GOOD);
  await post(db, OTHER, '/estate/universes/requests', { ...GOOD, name: 'Xanth' });

  const res = await call(db, OWNER, '/estate/universes/requests');
  const body = (await res.json()) as { requests: Record<string, unknown>[]; scope: string; is_approver: boolean };
  assert.equal(body.scope, 'all');
  assert.equal(body.is_approver, true);
  assert.equal(body.requests.length, 2);
  assert.equal(body.requests[0]?.requested_by, 'other');
});

test('the names route serves the generated list and its alias map', async () => {
  const db = new FakeDB();
  const res = await call(db, MEMBER, '/estate/universes/names');
  assert.equal(res.status, 200);
  const body = (await res.json()) as { names: string[]; canonical_names: Record<string, string>; source: string };
  assert.deepEqual(body.names, [...UNIVERSE_NAMES]);
  assert.equal(body.canonical_names.cosmere, 'The Cosmere');
  assert.equal(body.source, 'data/universes.json');
});

test('the names route is members-only', async () => {
  const db = new FakeDB();
  assert.equal((await call(db, null, '/estate/universes/names')).status, 401);
  assert.equal((await call(db, PENDING, '/estate/universes/names')).status, 403);
});

// ---------------------------------------------------------------------------
// Deciding
// ---------------------------------------------------------------------------

test('a plain member cannot decide, and is told whose call it is', async () => {
  const db = new FakeDB();
  await post(db, MEMBER, '/estate/universes/requests', GOOD);
  const res = await post(db, MEMBER, '/estate/universes/requests/1/decide', { decision: 'approved' });
  assert.equal(res.status, 403);
  assert.match(((await res.json()) as { detail: string }).detail, /approver/i);
  assert.equal(db.requests[0]?.status, 'pending');
});

test('🔴 a decline without a reason is refused AT THE ROUTE, not just in the form', async () => {
  const db = new FakeDB();
  await post(db, MEMBER, '/estate/universes/requests', GOOD);
  const res = await post(db, OWNER, '/estate/universes/requests/1/decide', { decision: 'declined', why: 'no' });
  assert.equal(res.status, 400);
  assert.equal(((await res.json()) as { error: string }).error, 'no_reason');
  assert.equal(db.requests[0]?.status, 'pending', 'nothing was decided');
});

test('an approval sets a status and says outright that it changed no file', async () => {
  const db = new FakeDB();
  await post(db, MEMBER, '/estate/universes/requests', GOOD);
  const res = await post(db, OWNER, '/estate/universes/requests/1/decide', { decision: 'approved' });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { status: string; detail: string };
  assert.equal(body.status, 'approved');
  assert.match(body.detail, /not live yet/);
  assert.match(body.detail, /data\/universes\.json/);
  assert.equal(db.requests[0]?.status, 'approved');
  assert.equal(db.requests[0]?.decided_by, 1);
});

test('deciding an already-decided request is a worded 409', async () => {
  const db = new FakeDB();
  await post(db, MEMBER, '/estate/universes/requests', GOOD);
  await post(db, OWNER, '/estate/universes/requests/1/decide', { decision: 'approved' });
  const again = await post(db, OWNER, '/estate/universes/requests/1/decide', { decision: 'declined', why: 'changed my mind about it' });
  assert.equal(again.status, 409);
  assert.equal(((await again.json()) as { error: string }).error, 'already_decided');
});

test('a decision on a request that does not exist is a 404 naming the id', async () => {
  const db = new FakeDB();
  const res = await post(db, OWNER, '/estate/universes/requests/99/decide', { decision: 'approved' });
  assert.equal(res.status, 404);
  assert.match(((await res.json()) as { detail: string }).detail, /#99/);
});

// ---------------------------------------------------------------------------
// Landing — the honest fourth status
// ---------------------------------------------------------------------------

test('🔴 approved ≠ landed: `landed` needs a real commit, and refuses without one', async () => {
  const db = new FakeDB();
  await post(db, MEMBER, '/estate/universes/requests', GOOD);
  await post(db, OWNER, '/estate/universes/requests/1/decide', { decision: 'approved' });

  const bare = await post(db, DEVOPS, '/estate/universes/requests/1/landed', {});
  assert.equal(bare.status, 400);
  assert.equal(((await bare.json()) as { error: string }).error, 'bad_commit');
  assert.equal(db.requests[0]?.status, 'approved');

  const ok = await post(db, DEVOPS, '/estate/universes/requests/1/landed', { commit: 'A1B2C3D' });
  assert.equal(ok.status, 200);
  assert.equal(db.requests[0]?.status, 'landed');
  assert.equal(db.requests[0]?.landed_commit, 'a1b2c3d');
});

test('⚠️ a DECLINED request can never be marked landed', async () => {
  const db = new FakeDB();
  await post(db, MEMBER, '/estate/universes/requests', GOOD);
  await post(db, OWNER, '/estate/universes/requests/1/decide', {
    decision: 'declined',
    why: 'that is The Cosmere under another name',
  });
  const res = await post(db, DEVOPS, '/estate/universes/requests/1/landed', { commit: 'abcdef1' });
  assert.equal(res.status, 409);
  assert.equal(((await res.json()) as { error: string }).error, 'not_approved');
  assert.equal(db.requests[0]?.status, 'declined');
});

test('landing is devops-gated — a plain member cannot claim a deploy happened', async () => {
  const db = new FakeDB();
  await post(db, MEMBER, '/estate/universes/requests', GOOD);
  await post(db, OWNER, '/estate/universes/requests/1/decide', { decision: 'approved' });
  const res = await post(db, MEMBER, '/estate/universes/requests/1/landed', { commit: 'abcdef1' });
  assert.equal(res.status, 403);
  assert.equal(db.requests[0]?.status, 'approved');
});

// ---------------------------------------------------------------------------
// Withdrawing (§6 Q4)
// ---------------------------------------------------------------------------

test('the requester may withdraw their own pending request', async () => {
  const db = new FakeDB();
  await post(db, MEMBER, '/estate/universes/requests', GOOD);
  const res = await post(db, MEMBER, '/estate/universes/requests/1/withdraw', {});
  assert.equal(res.status, 200);
  assert.equal(db.requests[0]?.status, 'withdrawn');
});

test('⚠️ nobody else may — an approver declines with a reason instead, which leaves a record', async () => {
  const db = new FakeDB();
  await post(db, MEMBER, '/estate/universes/requests', GOOD);
  const res = await post(db, OWNER, '/estate/universes/requests/1/withdraw', {});
  assert.equal(res.status, 403);
  assert.equal(((await res.json()) as { error: string }).error, 'not_yours');
  assert.equal(db.requests[0]?.status, 'pending');
});

test('an already-decided request cannot be withdrawn', async () => {
  const db = new FakeDB();
  await post(db, MEMBER, '/estate/universes/requests', GOOD);
  await post(db, OWNER, '/estate/universes/requests/1/decide', { decision: 'approved' });
  const res = await post(db, MEMBER, '/estate/universes/requests/1/withdraw', {});
  assert.equal(res.status, 409);
  assert.equal(((await res.json()) as { error: string }).error, 'not_pending');
});

// ---------------------------------------------------------------------------
// Staleness (§6 Q3) and the migration-lag branch
// ---------------------------------------------------------------------------

test('⚠️ only an APPROVED row goes stale — a pending one waits on a person, which is not the same failure', () => {
  const old = '2026-01-01T00:00:00.000Z';
  const now = Date.parse('2026-01-20T00:00:00.000Z');
  const base = {
    id: 1,
    name: 'Discworld',
    name_key: 'discworld',
    payload: '{}',
    why: 'because',
    requested_by: 2,
    requested_at: old,
    decided_by: 1,
    decided_at: old,
    decided_why: null,
    landed_commit: null,
  };
  assert.equal(toWire({ ...base, status: 'approved' }, now, true, 1).stale, true);
  assert.equal(toWire({ ...base, status: 'declined' }, now, true, 1).stale, false);
  assert.equal(toWire({ ...base, status: 'landed' }, now, true, 1).stale, false);

  const fresh = new Date(now - (APPROVED_STALE_DAYS - 1) * 86_400_000).toISOString();
  assert.equal(toWire({ ...base, status: 'approved', decided_at: fresh }, now, true, 1).stale, false);
});

test('⚠️ a Worker ahead of its migration SAYS SO, and the read still renders', async () => {
  const db = new FakeDB();
  db.missingTable = true;

  const read = await call(db, MEMBER, '/estate/universes/requests');
  assert.equal(read.status, 200, 'the page must still render, with an empty queue and an explanation');
  const readBody = (await read.json()) as { error: string; fix: string; requests: unknown[] };
  assert.equal(readBody.error, 'universe_request_table_missing');
  assert.match(readBody.fix, /0017_universe_requests\.sql/);
  assert.deepEqual(readBody.requests, []);

  const write = await post(db, MEMBER, '/estate/universes/requests', GOOD);
  assert.equal(write.status, 503, 'a write must NOT look like it succeeded');
  assert.match(((await write.json()) as { detail: string }).detail, /no request has been recorded/);
});
