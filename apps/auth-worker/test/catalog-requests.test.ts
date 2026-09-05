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
import { SEALED_ALG, SEALED_MAX_BYTES, parseSealedEnvelope } from '../src/catalog-keys.js';

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
  /** Make the boolean write fail while the R2 put succeeds — see run(). */
  failKeyFlag = false;

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
        // The three sealed-key flag writes (§6). ⚠️ `failKeyFlag` exists to
        // exercise the one ordering the design cares about: the OBJECT landed
        // and the BOOLEAN did not. The answer must then report the boolean it
        // actually has (false) plus a warning — never the boolean it hoped for.
        if (/SET reader_key_set = 1/.test(sql)) {
          if (db.failKeyFlag) throw new Error('D1_ERROR: flag write refused');
          const row = db.requests.find((r) => r.id === Number(args[0]));
          if (row) row.reader_key_set = 1;
          return { success: true };
        }
        if (/SET owner_key_set = 1/.test(sql)) {
          if (db.failKeyFlag) throw new Error('D1_ERROR: flag write refused');
          const row = db.requests.find((r) => r.id === Number(args[0]));
          if (row) row.owner_key_set = 1;
          return { success: true };
        }
        if (/SET reader_key_set = 0, owner_key_set = 0/.test(sql)) {
          const row = db.requests.find((r) => r.id === Number(args[0]));
          if (row) Object.assign(row, { reader_key_set: 0, owner_key_set: 0 });
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

/**
 * The `estate-catalog-keys` bucket, in memory (§6).
 *
 * ⚠️ IT IMPLEMENTS `get` AND `list` EVEN THOUGH THE WORKER MUST NEVER CALL
 * THEM — so that the tests can look inside the store and prove what landed
 * there. A stub with no read would leave "the envelope was stored" unverifiable
 * except by trusting the code under test. `reads` counts every such call, and
 * one test asserts the count is still zero after every route has run: that is
 * the mechanical version of "no decrypt-to-read path exists".
 */
class FakeR2 {
  objects = new Map<string, { body: string; contentType?: string }>();
  reads = 0;
  failPut = false;
  failDelete = false;
  puts: string[] = [];
  deletes: string[] = [];

  async put(key: string, body: string, opts?: { httpMetadata?: { contentType?: string } }) {
    if (this.failPut) throw new Error('R2 refused the write');
    this.puts.push(key);
    this.objects.set(key, { body, contentType: opts?.httpMetadata?.contentType });
    return { key };
  }
  async get(key: string) {
    this.reads++;
    const found = this.objects.get(key);
    return found ? { text: async () => found.body } : null;
  }
  async list() {
    this.reads++;
    return { objects: [...this.objects.keys()].map((key) => ({ key })) };
  }
  async delete(key: string) {
    this.deletes.push(key);
    if (this.failDelete) throw new Error('R2 refused the delete');
    this.objects.delete(key);
  }
}

/**
 * A valid envelope, built the way the browser half builds one.
 *
 * ⚠️ THE PAYLOAD IS NONSENSE ON PURPOSE — nothing here encrypts anything, and
 * no real provisioning key is anywhere near this file. The server's whole job is
 * to move an opaque blob without understanding it, so a blob that is only
 * SHAPED like an envelope tests exactly what the server does.
 */
function envelope(over: Record<string, unknown> = {}) {
  return {
    v: 1,
    kid: '0123456789abcdef',
    alg: 'RSA-OAEP-256+A256GCM',
    ek: btoa('a'.repeat(512)),
    iv: btoa('b'.repeat(12)),
    ct: btoa('not-a-real-ciphertext'),
    ...over,
  };
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

/** POST with the key store bound — every sealed-key test goes through here. */
function postKeyed(db: FakeDB, r2: FakeR2 | null, as: string | null, path: string, body: unknown) {
  return catalogRequestRoutes.request(
    path,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    } as never,
    env(db, as, r2 ? { CATALOG_KEYS: r2 } : {}),
  );
}

/** File a request that CARRIES a key, and hand back the parsed answer. */
async function fileWithKey(
  db: FakeDB,
  r2: FakeR2 | null,
  as: string,
  body: unknown = { ...GOOD, sealed_key: envelope() },
) {
  const res = await postKeyed(db, r2, as, '/estate/catalogs/requests', body);
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
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

test('🔴 signed OUT at an approver door: a SENTENCE, never a bare status', async () => {
  // The third of the three bare-401 siblings found 2026-09-05 (the /me one is
  // pinned in me-contract.test.ts, the /session one in session.test.ts).
  // `requireApprover()` answered `{"error":"unauthenticated"}` and nothing
  // else, and a PERSON meets this one — every /admin approver control and
  // every decide button lands on it when a session has quietly expired.
  //
  // ⚠️ The `error` CODE must stay exactly `unauthenticated`: tools/estate-probes
  // asserts it across this Worker's whole unauthenticated edge, and every
  // page's failure wording branches on it. Only the `detail` is new.
  const db = new FakeDB();
  const id = await file(db, MEMBER);
  const res = await post(db, null, `/estate/catalogs/requests/${id}/decide`, { decision: 'accept' });
  assert.equal(res.status, 401);
  const body = (await res.json()) as { error: string; detail?: string };
  assert.equal(body.error, 'unauthenticated');
  assert.equal(typeof body.detail, 'string', 'a bare {error} is what this test exists to prevent');
  assert.ok(body.detail!.length > 0, 'an empty detail is a bare status wearing a field name');
  // Three clauses, per the estate rule: what happened (not signed in), what it
  // needs (an approver account), how to get it (sign in / ask the owner).
  assert.match(body.detail!, /not signed in/i);
  assert.match(body.detail!, /approver/i);
  assert.match(body.detail!, /heygabi\.ai/);
  assert.equal(db.requests[0]?.status, 'pending', 'nothing was decided');
});

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

// ---------------------------------------------------------------------------
// THE SEALED CLAUDE KEY (§6) — the server half
//
// 🔴 THE PROPERTY UNDER TEST IS NOT "the key is stored". It is that D1 and the
// answers NEVER carry anything but a boolean, that a claim of storage is only
// made when storage happened, and that every path which ends a request takes
// the envelope with it. A feature that stored keys perfectly and over-claimed
// once would be the failure worth having tests for.
// ---------------------------------------------------------------------------

test('the envelope contract is checked exactly, and every refusal is a sentence', () => {
  assert.equal('error' in parseSealedEnvelope(envelope()), false, 'a valid envelope passes');

  // ⚠️ THE NUMBER 1, NOT THE STRING. A version read tolerantly stops meaning
  // anything the day there is a second one.
  for (const bad of [{ v: '1' }, { v: 2 }, { v: null }]) {
    const r = parseSealedEnvelope(envelope(bad));
    assert.equal((r as { error: string }).error, 'bad_sealed_key', `v=${JSON.stringify(bad)} must refuse`);
    assert.match((r as { detail: string }).detail, /version/);
  }

  // The algorithm is matched literally — there is no fallback and no "close
  // enough". A key sealed with something else cannot be unsealed by the
  // provisioner, so accepting it would store a key nobody can ever use.
  const alg = parseSealedEnvelope(envelope({ alg: 'RSA-OAEP-256+A128GCM' }));
  assert.equal((alg as { error: string }).error, 'bad_sealed_key');
  assert.match((alg as { detail: string }).detail, new RegExp(SEALED_ALG.replace(/\+/g, '\\+')));

  // Every string field is required and must be text.
  for (const field of ['kid', 'alg', 'ek', 'iv', 'ct']) {
    const missing = envelope() as Record<string, unknown>;
    delete missing[field];
    assert.equal((parseSealedEnvelope(missing) as { error: string }).error, 'bad_sealed_key', `${field} is required`);
    assert.equal(
      (parseSealedEnvelope(envelope({ [field]: 42 })) as { error: string }).error,
      'bad_sealed_key',
      `${field} must be text`,
    );
    assert.equal(
      (parseSealedEnvelope(envelope({ [field]: '' })) as { error: string }).error,
      'bad_sealed_key',
      `${field} must be non-empty`,
    );
  }

  // ⚠️ REFUSES, NEVER STRIPS — the standing rule for every write door.
  const extraField = parseSealedEnvelope(envelope({ note: 'hello' }));
  assert.equal((extraField as { error: string }).error, 'bad_sealed_key');
  assert.match((extraField as { detail: string }).detail, /not part of a sealed key envelope/);

  // Not an object at all.
  for (const bad of [null, 'sk-ant-oops', 42, ['ek']]) {
    assert.equal((parseSealedEnvelope(bad) as { error: string }).error, 'bad_sealed_key');
  }
});

test('🔴 base64 is checked by SHAPE AND DECODE — atob alone is too lenient', () => {
  // atob accepts plenty a strict decoder would not; the regex catches the
  // sloppy encoder and the decode catches the truncation. Either alone lets a
  // string through that could never be a wrapped key.
  for (const bad of ['not base64!!', 'AAAA=AAA', 'A', 'AAA-AAA_', '你好世界']) {
    const r = parseSealedEnvelope(envelope({ ct: bad }));
    assert.equal((r as { error: string }).error, 'bad_sealed_key', `ct=${bad} must refuse`);
    assert.match((r as { detail: string }).detail, /base64/);
  }
  // And it says WHICH field, because "invalid" sends a person to the owner
  // with nothing to act on.
  assert.match((parseSealedEnvelope(envelope({ iv: '!!' })) as { detail: string }).detail, /iv/);
});

test('an oversize envelope is refused with the measured size, not a bare 400', () => {
  const huge = envelope({ ct: 'A'.repeat(SEALED_MAX_BYTES + 4) });
  const r = parseSealedEnvelope(huge);
  assert.equal((r as { error: string }).error, 'sealed_key_too_big');
  assert.match((r as { detail: string }).detail, new RegExp(String(SEALED_MAX_BYTES)));
});

test('a valid envelope is stored as reader/<id>.json and the boolean follows it', async () => {
  const db = new FakeDB();
  const r2 = new FakeR2();
  const { status, body } = await fileWithKey(db, r2, MEMBER);
  assert.equal(status, 201);
  assert.equal(body.reader_key_set, true, 'the answer must report the boolean it actually set');
  assert.equal(body.owner_key_set, false);
  assert.equal(body.warnings, undefined, 'a clean store carries no warning');

  const id = body.id as number;
  assert.deepEqual(r2.puts, [`reader/${id}.json`], 'one object, keyed by request id, on the reader side');
  const stored = r2.objects.get(`reader/${id}.json`);
  assert.equal(stored?.contentType, 'application/json');
  assert.deepEqual(JSON.parse(stored?.body ?? '{}'), envelope(), 'the envelope is stored verbatim, not re-shaped');

  // 🔴 D1 HOLDS A BOOLEAN AND NOTHING ELSE. Not the ciphertext, not a prefix,
  // not a hint — §6.1's table has one 🔴 NEVER against this row.
  const row = db.requests[0]!;
  assert.equal(row.reader_key_set, 1);
  assert.equal(JSON.stringify(row).includes(envelope().ct), false, 'no envelope field reached the row');
  assert.equal(JSON.stringify(row).includes(envelope().ek), false);
});

test('🔴 a malformed envelope files NO REQUEST and stores NOTHING', async () => {
  // The order matters: the envelope is validated before the insert, so a key
  // that could never decrypt does not leave a request behind claiming somebody
  // attached one — and the person can simply submit again.
  const db = new FakeDB();
  const r2 = new FakeR2();
  const { status, body } = await fileWithKey(db, r2, MEMBER, { ...GOOD, sealed_key: envelope({ alg: 'nope' }) });
  assert.equal(status, 400);
  assert.equal((body as { error: string }).error, 'bad_sealed_key');
  assert.match((body as { detail: string }).detail, /Nothing was stored/);
  assert.equal(db.requests.length, 0, 'no row');
  assert.equal(r2.puts.length, 0, 'no object');
});

test('🔴 an oversize envelope files NO REQUEST either', async () => {
  const db = new FakeDB();
  const r2 = new FakeR2();
  const { status, body } = await fileWithKey(db, r2, MEMBER, {
    ...GOOD,
    sealed_key: envelope({ ct: 'A'.repeat(SEALED_MAX_BYTES + 4) }),
  });
  assert.equal(status, 400);
  assert.equal((body as { error: string }).error, 'sealed_key_too_big');
  assert.equal(db.requests.length, 0);
  assert.equal(r2.puts.length, 0);
});

test('🔴 NO KEY STORE + A KEY = A REFUSAL IN WORDS, and no row at all', async () => {
  // Dropping the key and filing the request anyway would leave somebody
  // believing their own key is in use while the catalog is provisioned on the
  // OWNER's, which he pays for (§6.4 row 3). A money decision must never be
  // made by an accidental default.
  const db = new FakeDB();
  const { status, body } = await fileWithKey(db, null, MEMBER);
  assert.equal(status, 503);
  assert.equal((body as { error: string }).error, 'key_store_unconfigured');
  assert.match((body as { detail: string }).detail, /was NOT stored/);
  assert.match((body as { detail: string }).detail, /Submit again without a key/);
  assert.match((body as { detail: string }).detail, /CATALOG_KEYS/, 'it names what the owner has to fix');
  assert.equal(db.requests.length, 0, 'nothing was filed — try again, do not withdraw');
});

test('⚠️ with no key store and NO key, a request still files normally', async () => {
  // The binding is optional on purpose: a dev run or a test without it must not
  // take the whole feature down, only the key half of it.
  const db = new FakeDB();
  const { status, body } = await fileWithKey(db, null, MEMBER, GOOD);
  assert.equal(status, 201);
  assert.equal(body.reader_key_set, false);
  assert.equal(db.requests.length, 1);
});

test('🔴 an R2 put that FAILS keeps the row, leaves the boolean 0, and SAYS SO', async () => {
  // There is no transaction across D1 and R2. Losing somebody's request over a
  // bucket hiccup is strictly worse than a request with no key — but the
  // boolean must not over-claim, so it stays 0 and the answer carries words the
  // client can show.
  const db = new FakeDB();
  const r2 = new FakeR2();
  r2.failPut = true;
  const { status, body } = await fileWithKey(db, r2, MEMBER);
  assert.equal(status, 201, 'the request itself survived');
  assert.equal(body.reader_key_set, false, 'the boolean reports the storage that actually happened');
  assert.equal(db.requests[0]!.reader_key_set, 0);
  assert.equal(r2.objects.size, 0);
  const warnings = body.warnings as string[];
  assert.equal(Array.isArray(warnings), true, 'the client is given a sentence, not a silence');
  assert.match(warnings[0]!, /not stored/);
});

test('⚠️ the OBJECT landing and the BOOLEAN failing is reported as not-stored', async () => {
  // The provisioner looks for the object, so the key is still usable — but the
  // estate's RECORD is the boolean, and a record that over-claims is the
  // failure this ordering exists to prevent.
  const db = new FakeDB();
  const r2 = new FakeR2();
  db.failKeyFlag = true;
  const { status, body } = await fileWithKey(db, r2, MEMBER);
  assert.equal(status, 201);
  assert.equal(body.reader_key_set, false);
  assert.equal(db.requests[0]!.reader_key_set, 0);
  assert.match((body.warnings as string[])[0]!, /not stored/);
});

test('accept may carry the OWNER’s key — owner/<id>.json, its own boolean', async () => {
  const db = new FakeDB();
  const r2 = new FakeR2();
  const { body } = await fileWithKey(db, r2, MEMBER);
  const id = body.id as number;

  const res = await postKeyed(db, r2, OWNER, `/estate/catalogs/requests/${id}/decide`, {
    decision: 'accept',
    sealed_key: envelope({ kid: 'fedcba9876543210' }),
  });
  assert.equal(res.status, 200);
  const decided = (await res.json()) as Record<string, unknown>;
  assert.equal(decided.owner_key_set, true);
  assert.equal(decided.reader_key_set, true, 'the reader’s key is still on file and still reported');
  assert.deepEqual(r2.puts, [`reader/${id}.json`, `owner/${id}.json`], 'two sides, two objects, neither overwritten');
  assert.equal(db.requests[0]!.owner_key_set, 1);
  assert.equal(db.requests[0]!.reader_key_set, 1);
});

test('accept with a key and NO key store refuses in words and decides NOTHING', async () => {
  const db = new FakeDB();
  const r2 = new FakeR2();
  const { body } = await fileWithKey(db, r2, MEMBER);
  const id = body.id as number;

  const res = await postKeyed(db, null, OWNER, `/estate/catalogs/requests/${id}/decide`, {
    decision: 'accept',
    sealed_key: envelope(),
  });
  assert.equal(res.status, 503);
  assert.equal(((await res.json()) as { error: string }).error, 'key_store_unconfigured');
  assert.equal(db.requests[0]!.status, 'pending', 'the decision was not half-made');
});

test('⚠️ a DECLINE cannot carry a key — declining throws keys away', async () => {
  const db = new FakeDB();
  const r2 = new FakeR2();
  const { body } = await fileWithKey(db, r2, MEMBER);
  const id = body.id as number;

  const res = await postKeyed(db, r2, OWNER, `/estate/catalogs/requests/${id}/decide`, {
    decision: 'decline',
    reason: 'somewhere else in the estate already',
    sealed_key: envelope(),
  });
  assert.equal(res.status, 400);
  assert.equal(((await res.json()) as { error: string }).error, 'sealed_key_on_decline');
  assert.equal(db.requests[0]!.status, 'pending', 'nothing changed');
  assert.equal(r2.objects.has(`reader/${id}.json`), true, 'and the reader’s key is untouched');
});

test('🔴 DECLINE deletes BOTH objects and clears BOTH booleans', async () => {
  const db = new FakeDB();
  const r2 = new FakeR2();
  const { body } = await fileWithKey(db, r2, MEMBER);
  const id = body.id as number;
  // Put an owner-side object there too, so the delete is proved on both sides.
  await r2.put(`owner/${id}.json`, JSON.stringify(envelope()));
  db.requests[0]!.owner_key_set = 1;

  const res = await postKeyed(db, r2, OWNER, `/estate/catalogs/requests/${id}/decide`, {
    decision: 'decline',
    reason: 'not right now, ask again after the games work',
  });
  assert.equal(res.status, 200);
  const decided = (await res.json()) as Record<string, unknown>;
  assert.equal(decided.reader_key_set, false);
  assert.equal(decided.owner_key_set, false);
  assert.deepEqual(r2.deletes, [`reader/${id}.json`, `owner/${id}.json`]);
  assert.equal(r2.objects.size, 0, 'the request will never be provisioned — nothing keeps the key here');
  // ⚠️ The booleans go with the objects: a 1 left standing would tell the queue
  // a key is on file that nobody can produce.
  assert.equal(db.requests[0]!.reader_key_set, 0);
  assert.equal(db.requests[0]!.owner_key_set, 0);
});

test('🔴 WITHDRAW takes the key back — that is half the point of having one', async () => {
  const db = new FakeDB();
  const r2 = new FakeR2();
  const { body } = await fileWithKey(db, r2, MEMBER);
  const id = body.id as number;

  const res = await postKeyed(db, r2, MEMBER, `/estate/catalogs/requests/${id}/withdraw`, {});
  assert.equal(res.status, 200);
  const done = (await res.json()) as Record<string, unknown>;
  assert.equal(done.status, 'cancelled');
  assert.equal(done.reader_key_set, false);
  assert.deepEqual(r2.deletes, [`reader/${id}.json`, `owner/${id}.json`]);
  assert.equal(r2.objects.size, 0);
  assert.equal(db.requests[0]!.reader_key_set, 0);
});

test('⚠️ a delete that FAILS does not cost the person their withdrawal', async () => {
  // The envelope is undecryptable to everyone but the owner's machine, so a
  // stranded object is housekeeping, never an exposure — and it must not turn a
  // withdrawal into a 502.
  const db = new FakeDB();
  const r2 = new FakeR2();
  const { body } = await fileWithKey(db, r2, MEMBER);
  const id = body.id as number;
  r2.failDelete = true;

  const res = await postKeyed(db, r2, MEMBER, `/estate/catalogs/requests/${id}/withdraw`, {});
  assert.equal(res.status, 200);
  assert.equal(db.requests[0]!.status, 'cancelled');
});

test('🔴 /live LEAVES THE ENVELOPES ALONE unless asked to purge', async () => {
  // The provisioner deletes each object itself, the moment `wrangler secret
  // put` has taken the plaintext — the only place that knows the inject
  // landed. Deleting here would throw the key away on a caller's say-so,
  // including when the inject FAILED and the envelope is the only copy.
  const db = new FakeDB();
  const r2 = new FakeR2();
  const { body } = await fileWithKey(db, r2, MEMBER);
  const id = body.id as number;
  await postKeyed(db, r2, OWNER, `/estate/catalogs/requests/${id}/decide`, { decision: 'accept' });

  const res = await postKeyed(db, r2, DEVOPS, `/estate/catalogs/requests/${id}/live`, {
    provisioned_instance: 'amber',
    provisioned_host: 'amber.heygabi.ai',
    reader_key_set: true,
  });
  assert.equal(res.status, 200);
  assert.equal(((await res.json()) as { keys_purged: boolean }).keys_purged, false);
  assert.equal(r2.deletes.length, 0, 'nothing was deleted');
  assert.equal(r2.objects.has(`reader/${id}.json`), true);
});

test('/live with purge_keys deletes both — the hatch for a run without the library', async () => {
  const db = new FakeDB();
  const r2 = new FakeR2();
  const { body } = await fileWithKey(db, r2, MEMBER);
  const id = body.id as number;
  await postKeyed(db, r2, OWNER, `/estate/catalogs/requests/${id}/decide`, { decision: 'accept' });

  const res = await postKeyed(db, r2, DEVOPS, `/estate/catalogs/requests/${id}/live`, {
    provisioned_instance: 'amber',
    provisioned_host: 'amber.heygabi.ai',
    purge_keys: true,
  });
  assert.equal(res.status, 200);
  assert.equal(((await res.json()) as { keys_purged: boolean }).keys_purged, true);
  assert.deepEqual(r2.deletes, [`reader/${id}.json`, `owner/${id}.json`]);
  // ⚠️ And the BOOLEANS SURVIVE a purge, unlike a decline: at /live they are the
  // provisioner's statement about the INSTANCE ("this catalog has a key"), not
  // about the bucket. Phase 6's back-seeded live rows are exactly that shape.
  assert.equal(db.requests[0]!.reader_key_set, 1);
});

test('🔴 NO ROUTE CAN RETURN AN ENVELOPE — the lists carry booleans and nothing else', async () => {
  const db = new FakeDB();
  const r2 = new FakeR2();
  const secret = envelope();
  const { body } = await fileWithKey(db, r2, MEMBER, { ...GOOD, sealed_key: secret });
  const id = body.id as number;
  await postKeyed(db, r2, OWNER, `/estate/catalogs/requests/${id}/decide`, {
    decision: 'accept',
    sealed_key: envelope({ kid: 'fedcba9876543210' }),
  });

  for (const who of [OWNER, MEMBER]) {
    const read = await catalogRequestRoutes.request(
      '/estate/catalogs/requests',
      undefined as never,
      env(db, who, { CATALOG_KEYS: r2 }),
    );
    const text = await read.text();
    assert.equal(read.status, 200);
    assert.equal(text.includes(secret.ct), false, `${who} must never be handed the ciphertext`);
    assert.equal(text.includes(secret.ek), false, `${who} must never be handed the wrapped key`);
    assert.equal(/"ek"|"ct"|"iv"|"sealed_key"/.test(text), false, `${who}: no envelope field name appears at all`);
    assert.match(text, /"reader_key_set":true/, 'only the boolean');
  }

  // The /me half (§4.2) projects six fields and none of them is a key.
  const mine = await catalogsForMe(db as unknown as D1Database, MEMBER);
  assert.equal(JSON.stringify(mine).includes(secret.ct), false);
  assert.equal(/"ek"|"ct"|"reader_key_set"/.test(JSON.stringify(mine)), false);
});

test('🔴 NOTHING IS LOGGED ABOUT AN ENVELOPE — measured by capturing the console', async () => {
  // §6.1's table: 🔴 NEVER for logs and `wrangler tail`. This captures every
  // console method across every route that can touch a key, and asserts that
  // nothing printed carries any envelope material — the ciphertext, the wrapped
  // key, the iv, or even the field names.
  const captured: string[] = [];
  const methods = ['log', 'info', 'warn', 'error', 'debug'] as const;
  const saved = methods.map((m) => console[m]);
  try {
    for (const m of methods) {
      console[m] = (...parts: unknown[]) => {
        captured.push(parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' '));
      };
    }
    const db = new FakeDB();
    const r2 = new FakeR2();
    const secret = envelope();
    const { body } = await fileWithKey(db, r2, MEMBER, { ...GOOD, sealed_key: secret });
    const id = body.id as number;
    await postKeyed(db, r2, OWNER, `/estate/catalogs/requests/${id}/decide`, {
      decision: 'accept',
      sealed_key: envelope({ kid: 'fedcba9876543210' }),
    });
    // …and the failure paths, which are where a helpful error message would
    // most plausibly echo the thing that failed to store.
    const broken = new FakeR2();
    broken.failPut = true;
    await fileWithKey(new FakeDB(), broken, OTHER, { ...GOOD, desired_subdomain: 'amber2', sealed_key: secret });
    await fileWithKey(new FakeDB(), null, PENDING, { ...GOOD, sealed_key: secret });

    const all = captured.join('\n');
    for (const needle of [secret.ct, secret.ek, secret.iv, secret.kid]) {
      assert.equal(all.includes(needle), false, `a log line carried ${needle.slice(0, 8)}…`);
    }
    assert.equal(/"ek"|"ct"|sealed_key/.test(all), false, 'no envelope field name was logged either');
  } finally {
    methods.forEach((m, i) => {
      console[m] = saved[i]!;
    });
  }
});

test('🔴 THE WORKER NEVER READS THE BUCKET — no .get(), no .list(), ever', async () => {
  // The mechanical version of "the owner can never see it": §6.2's closing
  // line is that the ABSENCE of a decrypt-to-read path, not a policy, is the
  // guarantee. The stub counts reads; every route that can touch a key runs
  // here; the count must still be zero.
  const db = new FakeDB();
  const r2 = new FakeR2();
  const { body } = await fileWithKey(db, r2, MEMBER);
  const id = body.id as number;
  await postKeyed(db, r2, OWNER, `/estate/catalogs/requests/${id}/decide`, {
    decision: 'accept',
    sealed_key: envelope(),
  });
  await postKeyed(db, r2, DEVOPS, `/estate/catalogs/requests/${id}/live`, {
    provisioned_instance: 'amber',
    provisioned_host: 'amber.heygabi.ai',
    purge_keys: true,
  });
  await catalogRequestRoutes.request(
    '/estate/catalogs/requests',
    undefined as never,
    env(db, OWNER, { CATALOG_KEYS: r2 }),
  );
  assert.equal(r2.reads, 0, 'a read here would be a decrypt-to-read path in the making');
});

test('⚠️ sealed_key is an OPTIONAL field, and null means "left blank"', () => {
  // A browser form that sends `sealed_key: null` when the box was empty is the
  // normal shape of a form, not an attempt to attach an empty key.
  assert.equal('error' in parseSubmitBody({ ...GOOD, sealed_key: null }), false);
  assert.equal((parseSubmitBody({ ...GOOD, sealed_key: null }) as { sealed_key: unknown }).sealed_key, null);
  assert.equal((parseSubmitBody(GOOD) as { sealed_key: unknown }).sealed_key, null);
  // And it is a KNOWN field now — the unknown-field refusal must not eat it.
  assert.equal('error' in parseSubmitBody({ ...GOOD, sealed_key: envelope() }), false);
});
