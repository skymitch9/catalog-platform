/**
 * catalog-requests.test.ts — the "Request a catalog" doors, exercised against
 * the REAL exported `catalogRequestRoutes` with a small in-memory D1.
 *
 * Design: docs/info/request-a-catalog-design.md §3.6 (the pinned route
 * contract), §3.3 (the one reserved list), §4.3 (per-kind show/hide), §9 row 2
 * (only approved people may request).
 *
 * ⚠️ MOST OF THIS FILE IS ABOUT THINGS THE FEATURE MUST REFUSE, and that is the
 * shape of the risk. A row here is read by exactly one scarce person and, once
 * `live`, by the estate itself as the answer to "who owns a catalog". The ways
 * it fails quietly are all the same family: a `kind` that defaults instead of
 * refusing (a games request provisioned as books, and the two have entirely
 * different provisioning stories); an address that looks free because the table
 * could not be read; a name reserved on one card and not the other; a person
 * told yes for a catalog that will never be built. The happy paths are a
 * handful of tests; the refusals are the rest.
 *
 * ⚠️ Identity is chosen by `DEV_EMAIL` — `resolveIdentity()`'s dev bypass fires
 * on `ENVIRONMENT === 'development'`, so each helper below passes the actor's
 * email in the env rather than minting Firebase tokens.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  catalogRequestRoutes,
  catalogsForMe,
  parseExtra,
  parseSubmitBody,
  toWire,
  type CatalogRequestRow,
} from '../src/catalog-requests.js';
import {
  RESERVED_SUBDOMAINS,
  checkSubdomain,
  isCatalogKind,
  normaliseSubdomain,
} from '../src/catalog-names.js';

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

const OPEN_OR_LIVE = ['pending', 'accepted', 'live'];

/**
 * A D1 fake that understands exactly the statements this feature issues.
 *
 * ⚠️ `missingTable` reproduces D1's own "no such table" error rather than a
 * generic throw, because the WHOLE POINT of the 503 branch it exercises is that
 * a Worker shipped ahead of its migration says so in words instead of reading
 * as an outage — and that availability, which cannot be computed, is never
 * answered "free".
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
  requests: CatalogRequestRow[] = [];
  nextId = 1;
  missingTable = false;

  prepare(sql: string) {
    const db = this;
    let args: unknown[] = [];
    const touchesRequests = /catalog_request/.test(sql);
    const guard = () => {
      if (db.missingTable && touchesRequests) throw new Error('D1_ERROR: no such table: catalog_request');
    };
    const stmt = {
      bind(...a: unknown[]) {
        args = a;
        return stmt;
      },
      async all() {
        guard();
        if (/SELECT id, kind, status, desired_subdomain, display_name, provisioned_host FROM catalog_request/.test(sql)) {
          const rows = db.requests
            .filter((r) => r.requester_email === args[0] && OPEN_OR_LIVE.includes(r.status))
            .sort((a, b) => b.id - a.id);
          return { results: rows.map((r) => ({ ...r })) };
        }
        if (/FROM catalog_request/.test(sql)) {
          let rows = [...db.requests];
          if (/WHERE requester_email = \?1 ORDER BY/.test(sql)) rows = rows.filter((r) => r.requester_email === args[0]);
          rows.sort((a, b) => b.id - a.id);
          return { results: rows.map((r) => ({ ...r })) };
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
        if (/SELECT id FROM catalog_request WHERE desired_subdomain/.test(sql)) {
          const exclude = args[1] === null || args[1] === undefined ? null : Number(args[1]);
          return (
            db.requests.find(
              (r) => r.desired_subdomain === args[0] && OPEN_OR_LIVE.includes(r.status) && r.id !== exclude,
            ) ?? null
          );
        }
        if (/SELECT id, status FROM catalog_request WHERE requester_email/.test(sql)) {
          return (
            db.requests.find(
              (r) => r.requester_email === args[0] && r.kind === args[1] && OPEN_OR_LIVE.includes(r.status),
            ) ?? null
          );
        }
        if (/INSERT INTO catalog_request/.test(sql)) {
          const [kind, email, uid, name, sub, display, extra] = args as (string | null)[];
          const row: CatalogRequestRow = {
            id: db.nextId++,
            kind: kind as string,
            requester_email: email as string,
            requester_uid: uid ?? null,
            requester_display_name: name ?? null,
            desired_subdomain: sub as string,
            display_name: display as string,
            status: 'pending',
            extra: extra ?? null,
            decided_by: null,
            decided_at: null,
            decline_reason: null,
            provisioned_instance: null,
            provisioned_host: null,
            reader_key_set: 0,
            owner_key_set: 0,
            created_at: '2026-09-05T00:00:00.000Z',
          };
          db.requests.push(row);
          return { id: row.id };
        }
        if (/SELECT id, kind, requester_email/.test(sql)) {
          const found = db.requests.find((r) => r.id === Number(args[0]));
          return found ? { ...found } : null;
        }
        if (/SELECT id, status, requester_email FROM catalog_request WHERE id/.test(sql)) {
          return db.requests.find((r) => r.id === Number(args[0])) ?? null;
        }
        if (/SELECT id, status FROM catalog_request WHERE id/.test(sql)) {
          return db.requests.find((r) => r.id === Number(args[0])) ?? null;
        }
        return null;
      },
      async run() {
        guard();
        if (/UPDATE catalog_request SET status = \?1, desired_subdomain/.test(sql)) {
          const [status, sub, display, by, at, reason, id] = args as [
            string,
            string,
            string,
            number,
            string,
            string | null,
            number,
          ];
          const row = db.requests.find((r) => r.id === Number(id) && r.status === 'pending');
          if (row) {
            Object.assign(row, {
              status,
              desired_subdomain: sub,
              display_name: display,
              decided_by: by,
              decided_at: at,
              decline_reason: reason,
            });
          }
          return { success: true };
        }
        if (/SET status = 'live'/.test(sql)) {
          const [instance, host, readerKey, ownerKey, id] = args as [
            string,
            string,
            number | null,
            number | null,
            number,
          ];
          const row = db.requests.find((r) => r.id === Number(id) && r.status === 'accepted');
          if (row) {
            Object.assign(row, {
              status: 'live',
              provisioned_instance: instance,
              provisioned_host: host,
              reader_key_set: readerKey ?? row.reader_key_set,
              owner_key_set: ownerKey ?? row.owner_key_set,
            });
          }
          return { success: true };
        }
        if (/SET status = 'cancelled'/.test(sql)) {
          const [at, id] = args as [string, number];
          const row = db.requests.find((r) => r.id === Number(id) && r.status === 'pending');
          if (row) Object.assign(row, { status: 'cancelled', decided_at: at });
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
    ENVIRONMENT: as ? 'development' : 'production',
    ...(as ? { DEV_EMAIL: as } : {}),
    ...over,
  };
}

function call(db: FakeDB, as: string | null, path: string, init?: RequestInit) {
  return catalogRequestRoutes.request(path, init as never, env(db, as));
}

function post(db: FakeDB, as: string | null, path: string, body: unknown) {
  return call(db, as, path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const GOOD = { kind: 'books', desired_subdomain: 'amber', display_name: 'Amber’s books' };
const GOOD_GAMES = { kind: 'games', desired_subdomain: 'amber-games', display_name: 'Amber’s games' };

/**
 * File a request and return its id, failing loudly if it did not land.
 *
 * ⚠️ The body is read ONCE. A `Response` body is a stream, so an assertion
 * message that interpolates `await res.text()` consumes it whether or not the
 * assertion fires — and every later `res.json()` then throws "Body is unusable"
 * on the HAPPY path, which reads like a routing bug and is not one.
 */
async function file(db: FakeDB, as: string, body: unknown = GOOD): Promise<number> {
  const res = await post(db, as, '/estate/catalogs/requests', body);
  const text = await res.text();
  assert.equal(res.status, 201, `expected the request to land: ${text}`);
  return (JSON.parse(text) as { id: number }).id;
}

// ---------------------------------------------------------------------------
// The name module — one list, one validator, both cards
// ---------------------------------------------------------------------------

test('normaliseSubdomain trims and lowercases, and repairs NOTHING else', () => {
  assert.equal(normaliseSubdomain('  Amber  '), 'amber');
  assert.equal(normaliseSubdomain('AMBER'), 'amber');
  assert.equal(normaliseSubdomain(null), '');
  // ⚠️ REFUSES, NEVER STRIPS. A space in the middle is a refusal with words, not
  // a silent repair into a different name than the person typed.
  assert.equal(checkSubdomain('am ber').ok, false);
  assert.equal(checkSubdomain('am_ber').ok, false);
});

test('the shape is 3–40 lowercase/digit/hyphen, never starting or ending with a hyphen', () => {
  assert.equal(checkSubdomain('ab').ok, false, 'two characters is under the floor');
  assert.equal(checkSubdomain('abc').ok, true);
  assert.equal(checkSubdomain('a'.repeat(40)).ok, true);
  assert.equal(checkSubdomain('a'.repeat(41)).ok, false);
  assert.equal(checkSubdomain('-amber').ok, false);
  assert.equal(checkSubdomain('amber-').ok, false);
  assert.equal(checkSubdomain('am-ber').ok, true);
  // The refusal says what a legal name looks like, never a bare "invalid".
  const bad = checkSubdomain('-amber');
  assert.equal(bad.ok, false);
  assert.match((bad as { detail: string }).detail, /lowercase letters/);
});

test('🔴 ONE reserved list covers BOTH cards — a games request cannot take bookcovers.', () => {
  // §3.3's whole argument: the list is a property of the heygabi.ai NAMESPACE,
  // not of a catalog kind. A per-kind copy would let a games request take
  // `bookcovers.` because the games validator had never heard of it.
  for (const name of ['bookcovers', 'gamecovers', 'library', 'padhard', 'auth', 'www', 'admin', 'api']) {
    const v = checkSubdomain(name);
    assert.equal(v.ok, false, `${name} must be reserved`);
    assert.equal((v as { reason: string }).reason, 'reserved');
  }
});

test('⚠️ the reserved list also holds the hostnames §3.3 did not name, each for a stated reason', () => {
  // Measured 2026-09-05 by grepping every repo's wrangler route config and the
  // whole home site for `*.heygabi.ai`. The module header carries the citation
  // for each; this pins that they did not get dropped in an edit.
  for (const name of ['audiobook-api', 'shelf', 'sam', 'books', 'search']) {
    assert.equal(checkSubdomain(name).ok, false, `${name} is routed, retired or decided-against — reserve it`);
  }
  // ⚠️ And `amber` is NOT reserved: it is the design doc's worked EXAMPLE of a
  // third instance, not a host anything routes. Reserving example values would
  // grow the list without bound, and this is the name every test here uses.
  assert.equal(checkSubdomain('amber').ok, true);
});

test('every entry in the reserved list is itself a legal subdomain shape', () => {
  // A reserved entry that could never be typed is dead weight, and usually a
  // typo — it silently protects nothing.
  for (const name of RESERVED_SUBDOMAINS) {
    assert.equal(normaliseSubdomain(name), name, `${name} is not already normalised`);
  }
  assert.equal(new Set(RESERVED_SUBDOMAINS).size, RESERVED_SUBDOMAINS.length, 'the list has duplicates');
});

test('the kind vocabulary is closed', () => {
  assert.equal(isCatalogKind('books'), true);
  assert.equal(isCatalogKind('games'), true);
  assert.equal(isCatalogKind('Books'), false);
  assert.equal(isCatalogKind('audiobooks'), false);
  assert.equal(isCatalogKind(undefined), false);
});

// ---------------------------------------------------------------------------
// The body — refuses, never strips
// ---------------------------------------------------------------------------

test('🔴 a MISSING kind is a 400, never a default', () => {
  // The column's `DEFAULT 'books'` is the migration's safety net. Defaulting
  // HERE would file a books request for somebody who pressed the Games "+",
  // and the two have entirely different provisioning stories (§7.6, §8).
  const { kind: _dropped, ...noKind } = GOOD;
  const r = parseSubmitBody(noKind);
  assert.equal((r as { error: string }).error, 'bad_kind');
  assert.match((r as { detail: string }).detail, /books or games/);
});

test('an UNKNOWN kind is a 400 too — the vocabulary is closed, not merely suggested', () => {
  assert.equal((parseSubmitBody({ ...GOOD, kind: 'audiobooks' }) as { error: string }).error, 'bad_kind');
  assert.equal((parseSubmitBody({ ...GOOD, kind: 'Books' }) as { error: string }).error, 'bad_kind');
});

test('⚠️ an unknown field is REFUSED, not silently dropped — and there is no email field', () => {
  const r = parseSubmitBody({ ...GOOD, requester_email: 'someone@else.com' });
  assert.equal((r as { error: string }).error, 'unknown_field');
  assert.match((r as { detail: string }).detail, /taken from the sign-in/);
});

test('a display name is required and bounded', () => {
  const { display_name: _d, ...noName } = GOOD;
  assert.equal((parseSubmitBody(noName) as { error: string }).error, 'no_display_name');
  assert.equal((parseSubmitBody({ ...GOOD, display_name: '   ' }) as { error: string }).error, 'no_display_name');
  assert.equal(
    (parseSubmitBody({ ...GOOD, display_name: 'x'.repeat(81) }) as { error: string }).error,
    'display_name_too_long',
  );
});

test('extra is an object or absent, and it is bounded', () => {
  assert.equal((parseSubmitBody({ ...GOOD, extra: 'theme=cyberpunk' }) as { error: string }).error, 'bad_extra');
  assert.equal((parseSubmitBody({ ...GOOD, extra: ['a'] }) as { error: string }).error, 'bad_extra');
  const ok = parseSubmitBody({ ...GOOD, extra: { theme: 'cyberpunk' } });
  assert.deepEqual((ok as { extra: Record<string, unknown> }).extra, { theme: 'cyberpunk' });
});

test('⚠️ extra is read TOLERANTLY — unreadable JSON degrades to {}, never to a 500', () => {
  // §3.4: the shape will grow, which is the whole reason it is an opaque blob.
  // A reader that threw on tomorrow's field would make growing it a breaking
  // change.
  assert.deepEqual(parseExtra(null), {});
  assert.deepEqual(parseExtra('not json at all'), {});
  assert.deepEqual(parseExtra('[1,2,3]'), {}, 'an array is not the object shape the renderer expects');
  assert.deepEqual(parseExtra('{"theme":"retro"}'), { theme: 'retro' });
});

// ---------------------------------------------------------------------------
// The doors — who may ask (owner decision §9 row 2: "only approved people")
// ---------------------------------------------------------------------------

test('signed out: 401 that says what to do, never a bare status', async () => {
  const db = new FakeDB();
  const res = await post(db, null, '/estate/catalogs/requests', GOOD);
  assert.equal(res.status, 401);
  const body = (await res.json()) as { error: string; detail: string };
  assert.equal(body.error, 'unauthenticated');
  assert.match(body.detail, /Sign in/);
});

test('⚠️ pending and revoked get DIFFERENT sentences — the fixes are different', async () => {
  const db = new FakeDB();
  const p = await post(db, PENDING, '/estate/catalogs/requests', GOOD);
  assert.equal(p.status, 403);
  const pb = (await p.json()) as { error: string; detail: string };
  assert.equal(pb.error, 'estate_pending');
  assert.match(pb.detail, /awaiting approval/);

  const r = await post(db, REVOKED, '/estate/catalogs/requests', GOOD);
  assert.equal(r.status, 403);
  assert.equal(((await r.json()) as { error: string }).error, 'estate_revoked');
  assert.equal(db.requests.length, 0);
});

test('somebody with no directory row at all is told how to get one', async () => {
  const db = new FakeDB();
  const res = await post(db, STRANGER, '/estate/catalogs/requests', GOOD);
  assert.equal(res.status, 403);
  assert.equal(((await res.json()) as { error: string }).error, 'estate_unknown');
});

test('🔴 the OWNER break-glass still gets in, even with a wrong directory row', async () => {
  // requireApprovedMember() admits an OWNER_EMAILS actor regardless of table
  // state, and refuseIfNotApproved() honours that deliberately: §4.3 defines an
  // owner as approved regardless of the table, and meAnswer() says the same.
  // The second barrier exists to refuse everybody ELSE whose row is not
  // approved — not to lock the owner out of his own estate.
  const db = new FakeDB();
  db.users = db.users.map((u) => (u.email === OWNER ? { ...u, status: 'revoked' } : u));
  const res = await post(db, OWNER, '/estate/catalogs/requests', GOOD);
  assert.equal(res.status, 201);
});

// ---------------------------------------------------------------------------
// Submitting
// ---------------------------------------------------------------------------

test('an approved member files a request, and is told a yes is not immediate', async () => {
  const db = new FakeDB();
  const res = await post(db, MEMBER, '/estate/catalogs/requests', GOOD);
  assert.equal(res.status, 201);
  const body = (await res.json()) as { id: number; kind: string; status: string; detail: string };
  assert.equal(body.status, 'pending');
  assert.equal(body.kind, 'books');
  assert.match(body.detail, /between “accepted” and “live”/);
  assert.equal(db.requests.length, 1);
});

test('⚠️ identity is SNAPSHOTTED from the actor at submit, never taken from the body', async () => {
  const db = new FakeDB();
  await file(db, MEMBER);
  const row = db.requests[0];
  assert.equal(row?.requester_email, MEMBER, 'lowercased, the estate join key');
  assert.equal(row?.requester_uid, 'uid-2', 'the Firebase uid as it was at submit');
  assert.equal(row?.requester_display_name, 'member', 'the SSO display name as it was at submit');
});

test('⚠️ the stored email is LOWERCASED even when the sign-in is not', async () => {
  // `requester_email` is the estate join key — /me reads the caller's rows by
  // it and `withdraw` decides ownership by it. If a mixed-case sign-in stored a
  // mixed-case row, that person's own "+" would never hide and they could not
  // withdraw their own request, both silently.
  const db = new FakeDB();
  db.users.push(user(7, 'mixed@example.com'));
  await post(db, 'Mixed@Example.com', '/estate/catalogs/requests', GOOD);
  assert.equal(db.requests[0]?.requester_email, 'mixed@example.com');
  assert.deepEqual(
    (await catalogsForMe(db as unknown as D1Database, 'MIXED@Example.com'))?.map((c) => c.desired_subdomain),
    ['amber'],
    'and the read side lowercases its lookup too, or the join is one-way',
  );
});

test('the server-side checks run again on submit — the form is a convenience', async () => {
  const db = new FakeDB();
  const reserved = await post(db, MEMBER, '/estate/catalogs/requests', { ...GOOD, desired_subdomain: 'library' });
  assert.equal(reserved.status, 400);
  assert.equal(((await reserved.json()) as { error: string }).error, 'reserved');

  const shape = await post(db, MEMBER, '/estate/catalogs/requests', { ...GOOD, desired_subdomain: 'no' });
  assert.equal(shape.status, 400);
  assert.equal(((await shape.json()) as { error: string }).error, 'bad_subdomain');

  const kind = await post(db, MEMBER, '/estate/catalogs/requests', { ...GOOD, kind: 'audiobooks' });
  assert.equal(kind.status, 400);
  assert.equal(((await kind.json()) as { error: string }).error, 'bad_kind');

  assert.equal(db.requests.length, 0, 'nothing was recorded by any of the three');
});

test('🔴 the address namespace is checked ACROSS KINDS — one heygabi.ai DNS, not two', async () => {
  // A books catalog at amber. and a games catalog at amber. are the SAME
  // hostname and cannot both exist. This is the check a per-kind implementation
  // gets wrong, and it fails by handing two people one address.
  const db = new FakeDB();
  await file(db, MEMBER, GOOD);
  const clash = await post(db, OTHER, '/estate/catalogs/requests', { ...GOOD_GAMES, desired_subdomain: 'amber' });
  assert.equal(clash.status, 409);
  const body = (await clash.json()) as { error: string; detail: string };
  assert.equal(body.error, 'taken');
  // ⚠️ It names the ADDRESS and nothing about who holds it — a refusal that
  // said who asked would leak the queue to anyone with a form and a word list.
  assert.doesNotMatch(body.detail, /member@example\.com/);
});

test('⚠️ the PERSON check is per KIND — owning books does not block asking for games', async () => {
  // §4.3: a person who owns a books catalog may still ask for a games one, so
  // their Books "+" is gone and their Games "+" is not.
  const db = new FakeDB();
  await file(db, MEMBER, GOOD);
  const again = await post(db, MEMBER, '/estate/catalogs/requests', { ...GOOD, desired_subdomain: 'amber2' });
  assert.equal(again.status, 409);
  assert.equal(((await again.json()) as { error: string }).error, 'already_requested');

  const games = await post(db, MEMBER, '/estate/catalogs/requests', GOOD_GAMES);
  assert.equal(games.status, 201, 'a books catalog must not block a games request');
});

test('a DECLINED request frees the name and lets the person ask again', async () => {
  // The reason 0018 has no UNIQUE index on desired_subdomain: a DB constraint
  // would hold a declined request's address hostage forever.
  const db = new FakeDB();
  const id = await file(db, MEMBER, GOOD);
  await post(db, OWNER, `/estate/catalogs/requests/${id}/decide`, {
    decision: 'decline',
    reason: 'let us wait until the games machinery exists',
  });
  const retry = await post(db, OTHER, '/estate/catalogs/requests', GOOD);
  assert.equal(retry.status, 201, 'a declined name is free again, for anybody');
});

// ---------------------------------------------------------------------------
// Availability
// ---------------------------------------------------------------------------

test('availability answers free / reserved / shape / taken, each in words', async () => {
  const db = new FakeDB();
  const read = async (name: string) => {
    const res = await call(db, MEMBER, `/estate/catalogs/availability?name=${encodeURIComponent(name)}`);
    return (await res.json()) as { available: boolean; reason: string | null; detail: string; name: string };
  };

  assert.deepEqual(
    { available: (await read('amber')).available, reason: (await read('amber')).reason },
    { available: true, reason: null },
  );
  assert.equal((await read('library')).reason, 'reserved');
  assert.equal((await read('no')).reason, 'shape');
  assert.equal((await read('AMBER')).name, 'amber', 'the answer is about the normalised name');

  await file(db, MEMBER, GOOD);
  const taken = await read('amber');
  assert.equal(taken.available, false);
  assert.equal(taken.reason, 'taken');
  assert.match(taken.detail, /amber\.heygabi\.ai is already in use/);
});

test('availability is members-only', async () => {
  const db = new FakeDB();
  assert.equal((await call(db, null, '/estate/catalogs/availability?name=amber')).status, 401);
  assert.equal((await call(db, PENDING, '/estate/catalogs/availability?name=amber')).status, 403);
});

test('🔴 when the table is missing, availability is UNKNOWN — and never rendered as free', async () => {
  // No guessing to unblock. "Unknown" answered as "available" is one keystroke
  // before somebody files a request for a name the estate already routes.
  const db = new FakeDB();
  db.missingTable = true;
  const res = await call(db, MEMBER, '/estate/catalogs/availability?name=amber');
  assert.equal(res.status, 503);
  const body = (await res.json()) as { error: string; fix: string };
  assert.equal(body.error, 'catalog_request_table_missing');
  assert.match(body.fix, /0018_catalog_requests\.sql/);
});

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

test('⚠️ a member sees only their OWN rows, and no requester identities at all', async () => {
  const db = new FakeDB();
  await file(db, MEMBER, GOOD);
  await file(db, OTHER, { ...GOOD, desired_subdomain: 'birch' });

  const res = await call(db, MEMBER, '/estate/catalogs/requests');
  const body = (await res.json()) as { requests: Record<string, unknown>[]; scope: string; is_approver: boolean };
  assert.equal(body.scope, 'mine');
  assert.equal(body.is_approver, false);
  assert.equal(body.requests.length, 1);
  assert.equal(body.requests[0]?.desired_subdomain, 'amber');
  assert.ok(!('requester_email' in (body.requests[0] ?? {})), 'a member must not be handed other members’ identities');
  assert.equal(body.requests[0]?.mine, true);
});

test('an approver sees every row, with the requester named', async () => {
  const db = new FakeDB();
  await file(db, MEMBER, GOOD);
  await file(db, OTHER, { ...GOOD, desired_subdomain: 'birch' });

  const res = await call(db, OWNER, '/estate/catalogs/requests');
  const body = (await res.json()) as { requests: Record<string, unknown>[]; scope: string };
  assert.equal(body.scope, 'all');
  assert.equal(body.requests.length, 2);
  assert.equal(body.requests[0]?.requester_email, OTHER, 'newest first');
  assert.equal(body.requests[0]?.requester_display_name, 'other');
});

test('⚠️ `mine` is computed server-side, so an approver keeps the withdraw control on their OWN row', () => {
  // The page used to infer this from the absence of a requester name, which is
  // true for a member and false for an approver — whose own row is named like
  // every other one in the queue. universe-requests.ts found this the hard way.
  const base: CatalogRequestRow = {
    id: 1,
    kind: 'books',
    requester_email: OWNER,
    requester_uid: 'uid-1',
    requester_display_name: 'owner',
    desired_subdomain: 'amber',
    display_name: 'Amber',
    status: 'pending',
    extra: null,
    decided_by: null,
    decided_at: null,
    decline_reason: null,
    provisioned_instance: null,
    provisioned_host: null,
    reader_key_set: 0,
    owner_key_set: 0,
    created_at: '2026-09-05T00:00:00.000Z',
  };
  assert.equal(toWire(base, true, OWNER).mine, true);
  assert.equal(toWire(base, true, MEMBER).mine, false);
});

test('🔴 the key columns cross the wire as BOOLEANS and nothing else', () => {
  const row: CatalogRequestRow = {
    id: 1,
    kind: 'books',
    requester_email: MEMBER,
    requester_uid: null,
    requester_display_name: null,
    desired_subdomain: 'amber',
    display_name: 'Amber',
    status: 'live',
    extra: null,
    decided_by: 1,
    decided_at: '2026-09-05T00:00:00.000Z',
    decline_reason: null,
    provisioned_instance: 'third',
    provisioned_host: 'amber.heygabi.ai',
    reader_key_set: 1,
    owner_key_set: 0,
    created_at: '2026-09-05T00:00:00.000Z',
  };
  const wire = toWire(row, true, MEMBER);
  assert.equal(wire.reader_key_set, true);
  assert.equal(wire.owner_key_set, false);
  // ⚠️ Nothing key-shaped is on the wire at all. §6: the sealed key never
  // reaches D1, and no decrypt-to-read path exists anywhere.
  assert.equal(JSON.stringify(wire).includes('sk-'), false);
});

// ---------------------------------------------------------------------------
// Deciding
// ---------------------------------------------------------------------------

test('a plain member cannot decide, and is told whose call it is', async () => {
  const db = new FakeDB();
  const id = await file(db, MEMBER);
  const res = await post(db, MEMBER, `/estate/catalogs/requests/${id}/decide`, { decision: 'accept' });
  assert.equal(res.status, 403);
  assert.match(((await res.json()) as { detail: string }).detail, /approver/i);
  assert.equal(db.requests[0]?.status, 'pending');
});

test('🔴 a decline without a reason is refused AT THE ROUTE, not just in the form', async () => {
  const db = new FakeDB();
  const id = await file(db, MEMBER);
  const res = await post(db, OWNER, `/estate/catalogs/requests/${id}/decide`, { decision: 'decline', reason: 'no' });
  assert.equal(res.status, 400);
  assert.equal(((await res.json()) as { error: string }).error, 'no_reason');
  assert.equal(db.requests[0]?.status, 'pending', 'nothing was decided');
});

test('an accept sets a status and says outright that it created nothing', async () => {
  const db = new FakeDB();
  const id = await file(db, MEMBER);
  const res = await post(db, OWNER, `/estate/catalogs/requests/${id}/decide`, { decision: 'accept' });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { status: string; detail: string };
  assert.equal(body.status, 'accepted');
  assert.match(body.detail, /Nothing has been created/);
  assert.equal(db.requests[0]?.status, 'accepted');
  assert.equal(db.requests[0]?.decided_by, 1, 'decided_by is the actor’s estate_user id');
});

test('⚠️ the owner may EDIT the address and name at accept — re-validated, and echoed back', async () => {
  const db = new FakeDB();
  const id = await file(db, MEMBER);
  const res = await post(db, OWNER, `/estate/catalogs/requests/${id}/decide`, {
    decision: 'accept',
    desired_subdomain: 'BIRCH',
    display_name: '  Birch Library  ',
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { desired_subdomain: string; display_name: string };
  // The ANSWER echoes the FINAL values, not the submitted ones — every surface
  // downstream must agree on which address was actually granted.
  assert.equal(body.desired_subdomain, 'birch');
  assert.equal(body.display_name, 'Birch Library');
  assert.equal(db.requests[0]?.desired_subdomain, 'birch');
});

test('🔴 an edited address is re-checked against the SAME rules submit used', async () => {
  const db = new FakeDB();
  const id = await file(db, MEMBER);
  const reserved = await post(db, OWNER, `/estate/catalogs/requests/${id}/decide`, {
    decision: 'accept',
    desired_subdomain: 'padhard',
  });
  assert.equal(reserved.status, 400);
  assert.equal(((await reserved.json()) as { error: string }).error, 'reserved');

  const bad = await post(db, OWNER, `/estate/catalogs/requests/${id}/decide`, {
    decision: 'accept',
    desired_subdomain: 'no',
  });
  assert.equal(bad.status, 400);
  assert.equal(((await bad.json()) as { error: string }).error, 'bad_subdomain');
  assert.equal(db.requests[0]?.status, 'pending', 'a refused edit decides nothing');
});

test('an edited address is checked for availability against OTHER rows, and never against itself', async () => {
  const db = new FakeDB();
  const mineId = await file(db, MEMBER, GOOD);
  await file(db, OTHER, { ...GOOD, desired_subdomain: 'birch' });

  // Somebody else holds `birch` — refused.
  const clash = await post(db, OWNER, `/estate/catalogs/requests/${mineId}/decide`, {
    decision: 'accept',
    desired_subdomain: 'birch',
  });
  assert.equal(clash.status, 409);
  assert.equal(((await clash.json()) as { error: string }).error, 'taken');

  // ⚠️ THE ROW HOLDS ITS OWN NAME. Without the exclusion, an owner who edits
  // only the display name would be told the address is taken — by himself.
  const same = await post(db, OWNER, `/estate/catalogs/requests/${mineId}/decide`, {
    decision: 'accept',
    desired_subdomain: 'amber',
    display_name: 'A new name',
  });
  assert.equal(same.status, 200);
});

test('🔴 a decision is never un-made — not into pending, not into the other decision', async () => {
  const db = new FakeDB();
  const id = await file(db, MEMBER);
  await post(db, OWNER, `/estate/catalogs/requests/${id}/decide`, { decision: 'accept' });
  const again = await post(db, OWNER, `/estate/catalogs/requests/${id}/decide`, {
    decision: 'decline',
    reason: 'changed my mind about the whole thing',
  });
  assert.equal(again.status, 409);
  assert.equal(((await again.json()) as { error: string }).error, 'not_pending');
  assert.equal(db.requests[0]?.status, 'accepted', 'an accept being provisioned cannot be pulled out from under it');
});

test('a decision on a request that does not exist is a 404 naming the id', async () => {
  const db = new FakeDB();
  const res = await post(db, OWNER, '/estate/catalogs/requests/99/decide', { decision: 'accept' });
  assert.equal(res.status, 404);
  assert.match(((await res.json()) as { detail: string }).detail, /#99/);
});

test('the decline reason is recorded verbatim, and the row is KEPT', async () => {
  const db = new FakeDB();
  const id = await file(db, MEMBER);
  const reason = 'the games machinery does not exist yet — ask again in a month';
  await post(db, OWNER, `/estate/catalogs/requests/${id}/decide`, { decision: 'decline', reason });
  assert.equal(db.requests.length, 1, 'rows are never deleted');
  assert.equal(db.requests[0]?.status, 'declined');
  assert.equal(db.requests[0]?.decline_reason, reason);
});

// ---------------------------------------------------------------------------
// Marking live — the honest gap between "accepted" and "it exists"
// ---------------------------------------------------------------------------

test('🔴 accepted ≠ live: `live` needs a real instance AND host, and refuses without them', async () => {
  const db = new FakeDB();
  const id = await file(db, MEMBER);
  await post(db, OWNER, `/estate/catalogs/requests/${id}/decide`, { decision: 'accept' });

  const bare = await post(db, DEVOPS, `/estate/catalogs/requests/${id}/live`, {});
  assert.equal(bare.status, 400);
  assert.equal(((await bare.json()) as { error: string }).error, 'no_instance');

  const noHost = await post(db, DEVOPS, `/estate/catalogs/requests/${id}/live`, { provisioned_instance: 'third' });
  assert.equal(noHost.status, 400);
  assert.equal(((await noHost.json()) as { error: string }).error, 'bad_host');
  assert.equal(db.requests[0]?.status, 'accepted');

  const ok = await post(db, DEVOPS, `/estate/catalogs/requests/${id}/live`, {
    provisioned_instance: 'third',
    provisioned_host: 'Amber.heygabi.ai',
  });
  assert.equal(ok.status, 200);
  assert.equal(db.requests[0]?.status, 'live');
  assert.equal(db.requests[0]?.provisioned_host, 'amber.heygabi.ai');
  assert.equal(db.requests[0]?.provisioned_instance, 'third');
});

test('⚠️ only an ACCEPTED request can be marked live', async () => {
  const db = new FakeDB();
  const id = await file(db, MEMBER);
  const res = await post(db, DEVOPS, `/estate/catalogs/requests/${id}/live`, {
    provisioned_instance: 'third',
    provisioned_host: 'amber.heygabi.ai',
  });
  assert.equal(res.status, 409);
  assert.equal(((await res.json()) as { error: string }).error, 'not_accepted');
  assert.equal(db.requests[0]?.status, 'pending');
});

test('marking live is devops-gated — a plain member cannot claim a catalog exists', async () => {
  const db = new FakeDB();
  const id = await file(db, MEMBER);
  await post(db, OWNER, `/estate/catalogs/requests/${id}/decide`, { decision: 'accept' });
  const res = await post(db, MEMBER, `/estate/catalogs/requests/${id}/live`, {
    provisioned_instance: 'third',
    provisioned_host: 'amber.heygabi.ai',
  });
  assert.equal(res.status, 403);
  assert.equal(db.requests[0]?.status, 'accepted');
});

test('🔴 the key flags take true/false and NOTHING else', async () => {
  const db = new FakeDB();
  const id = await file(db, MEMBER);
  await post(db, OWNER, `/estate/catalogs/requests/${id}/decide`, { decision: 'accept' });
  const res = await post(db, DEVOPS, `/estate/catalogs/requests/${id}/live`, {
    provisioned_instance: 'third',
    provisioned_host: 'amber.heygabi.ai',
    // The one field somebody will eventually try to be helpful with.
    owner_key_set: 'sk-ant-api03-REDACTED',
  });
  assert.equal(res.status, 400);
  assert.equal(((await res.json()) as { error: string }).error, 'bad_key_flag');
  assert.equal(db.requests[0]?.status, 'accepted', 'nothing was written');

  const ok = await post(db, DEVOPS, `/estate/catalogs/requests/${id}/live`, {
    provisioned_instance: 'third',
    provisioned_host: 'amber.heygabi.ai',
    owner_key_set: true,
  });
  assert.equal(ok.status, 200);
  assert.equal(db.requests[0]?.owner_key_set, 1);
  assert.equal(db.requests[0]?.reader_key_set, 0, 'an unsent flag is left alone, not zeroed');
});

// ---------------------------------------------------------------------------
// Withdrawing
// ---------------------------------------------------------------------------

test('the requester may withdraw their own pending request, and their "+" comes back', async () => {
  const db = new FakeDB();
  const id = await file(db, MEMBER);
  const res = await post(db, MEMBER, `/estate/catalogs/requests/${id}/withdraw`, {});
  assert.equal(res.status, 200);
  assert.equal(db.requests[0]?.status, 'cancelled');
  // `cancelled` is not an open status, so the name is free and so is the person.
  const again = await post(db, MEMBER, '/estate/catalogs/requests', GOOD);
  assert.equal(again.status, 201);
});

test('⚠️ nobody else may — an approver declines with a reason instead, which leaves a record', async () => {
  const db = new FakeDB();
  const id = await file(db, MEMBER);
  const res = await post(db, OWNER, `/estate/catalogs/requests/${id}/withdraw`, {});
  assert.equal(res.status, 403);
  assert.equal(((await res.json()) as { error: string }).error, 'not_yours');
  assert.equal(db.requests[0]?.status, 'pending');
});

test('⚠️ an ACCEPTED request cannot be withdrawn — real work has begun on it', async () => {
  const db = new FakeDB();
  const id = await file(db, MEMBER);
  await post(db, OWNER, `/estate/catalogs/requests/${id}/decide`, { decision: 'accept' });
  const res = await post(db, MEMBER, `/estate/catalogs/requests/${id}/withdraw`, {});
  assert.equal(res.status, 409);
  const body = (await res.json()) as { error: string; detail: string };
  assert.equal(body.error, 'not_pending');
  assert.match(body.detail, /ask the owner to stop/);
});

// ---------------------------------------------------------------------------
// The ownership signal /me grew (§4.2)
// ---------------------------------------------------------------------------

test('catalogsForMe answers the caller’s own open and live rows, newest first, with their kind', async () => {
  const db = new FakeDB();
  await file(db, MEMBER, GOOD);
  await file(db, MEMBER, GOOD_GAMES);
  await file(db, OTHER, { ...GOOD, desired_subdomain: 'birch' });

  const mine = await catalogsForMe(db as unknown as D1Database, MEMBER);
  assert.equal(mine?.length, 2, 'only this person’s rows');
  assert.equal(mine?.[0]?.kind, 'games', 'newest first');
  assert.equal(mine?.[1]?.kind, 'books');
  // ⚠️ Every entry carries its kind, because the show/hide is a per-card
  // question and a flat list of hostnames cannot answer it (§4.3).
  assert.deepEqual(
    mine?.map((c) => c.kind).sort(),
    ['books', 'games'],
  );
});

test('a DECIDED-AGAINST row is not an ownership fact', async () => {
  const db = new FakeDB();
  const id = await file(db, MEMBER, GOOD);
  await post(db, OWNER, `/estate/catalogs/requests/${id}/decide`, {
    decision: 'decline',
    reason: 'not right now, ask again after the games work',
  });
  assert.deepEqual(await catalogsForMe(db as unknown as D1Database, MEMBER), [], 'a decline hides no "+"');
});

test('🔴 catalogsForMe answers [] for "owns nothing" and undefined for "cannot answer"', async () => {
  // The two mean opposite things on the page: [] draws the "+", undefined
  // leaves it hidden. Collapsing them would draw a button whose route 503s.
  const db = new FakeDB();
  assert.deepEqual(await catalogsForMe(db as unknown as D1Database, MEMBER), []);
  db.missingTable = true;
  assert.equal(await catalogsForMe(db as unknown as D1Database, MEMBER), undefined);
});

test('⚠️ catalogsForMe NEVER throws — /me must answer even if this table is broken', async () => {
  // /me answers six other fields that every sign-in path on the estate depends
  // on. A catalog-table hiccup must cost the "+" and nothing else.
  const broken = {
    prepare() {
      throw new Error('D1_ERROR: something else entirely');
    },
  } as unknown as D1Database;
  assert.equal(await catalogsForMe(broken, MEMBER), undefined);
});

// ---------------------------------------------------------------------------
// The migration-lag branch
// ---------------------------------------------------------------------------

test('⚠️ a Worker ahead of its migration SAYS SO, and the read still renders', async () => {
  const db = new FakeDB();
  db.missingTable = true;

  const read = await call(db, MEMBER, '/estate/catalogs/requests');
  assert.equal(read.status, 200, 'the /admin panel must still render, with an empty queue and an explanation');
  const readBody = (await read.json()) as { error: string; fix: string; requests: unknown[] };
  assert.equal(readBody.error, 'catalog_request_table_missing');
  assert.match(readBody.fix, /0018_catalog_requests\.sql/);
  assert.deepEqual(readBody.requests, []);

  const write = await post(db, MEMBER, '/estate/catalogs/requests', GOOD);
  assert.equal(write.status, 503, 'a write must NOT look like it succeeded');
  assert.match(((await write.json()) as { detail: string }).detail, /no request has been recorded/);
});

test('every route answers the migration-lag case rather than a bare 500', async () => {
  const db = new FakeDB();
  db.missingTable = true;
  for (const [path, body] of [
    ['/estate/catalogs/requests/1/decide', { decision: 'accept' }],
    ['/estate/catalogs/requests/1/live', { provisioned_instance: 'x', provisioned_host: 'x.heygabi.ai' }],
    ['/estate/catalogs/requests/1/withdraw', {}],
  ] as const) {
    const res = await post(db, OWNER, path, body);
    assert.equal(res.status, 503, `${path} must say the table is missing, not 500`);
    assert.match(((await res.json()) as { fix: string }).fix, /db:migrate/);
  }
});
