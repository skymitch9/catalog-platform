/**
 * Revoking must clear the LADDER ROLE too — the Firestore half.
 *
 * ⚠️ WHY THIS IS A SEPARATE, SECOND TEST FILE from revoke-clears-powers.ts.
 * That one pins the D1 half (status + is_approver + is_devops in one
 * statement). This one pins the half that D1 cannot reach at all: the
 * audiobook site's ladder role lives in Firestore `site_roles/{uid}`, which
 * ITS firestore.rules reads directly from the browser using the person's own
 * live Firebase session. No D1 column participates in that check. So before
 * clearSiteRoleOnRevocation() existed, a revoked site 'admin' kept — measured
 * against audiobook_catalog/firestore.rules, read-only reference:
 *
 *   - `allow delete: if isSiteAdmin()` on /reviews and /reviews_dev — the
 *     site-wide review wipe, the one delete that was deliberately closed to
 *     everyone else after a "any visitor could loop over ~300 reviews" hole;
 *   - canManageClub() on every CLAIMED club: club-doc delete, reads delete
 *     (which takes the discussion with it), joinMode/features, and the
 *     read lifecycle fields (status/finishedAt/slot/ratingsRevealed);
 *   - canAdministerClub() — the tier that not even a club's own bound host
 *     holds: the Discord webhook (an outbound CAPABILITY) and `managerUids`
 *     itself (peer escalation — appointing club managers, including
 *     themselves);
 *   - canOperateClub() everywhere a moderator has it, below.
 *
 * A stale 'moderator' kept canOperateClub() across ALL claimed clubs: polls
 * create/update/delete, the reading schedule (milestones, scheduleUpdatedAt)
 * and nextMeetingAt/nextMeetingNotes.
 *
 * ('member' and 'contributor' grant nothing under today's rules — those rules
 * understand exactly 'admin' and 'moderator' — so clearing them is tidy-up.
 * Clearing 'admin' and 'moderator' is not.)
 *
 * The network is stubbed at `globalThis.fetch` (the auth-proxy.test.ts /
 * index-worker idiom) and D1 at a recording stub, so nothing here touches a
 * real Firestore or a real database. ⚠️ Stated plainly because it matters:
 * these tests prove the DECISIONS — which call is made, in what order, what
 * is refused, what is logged, and that no failure can throw — they do NOT
 * prove this Worker can authenticate to the real Firestore. Nothing in this
 * suite has been exercised against live Firebase.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Env, EstateUserRow } from '../src/env.js';
import { estateRoutes } from '../src/estate.js';
import { clearSiteRoleOnRevocation } from '../src/site-roles.js';

/* ── a real RSA key, because mintAccessToken really signs ───────────────── */

// (The casts are the workers-types/@types-node overlap: generateKey is typed
// `CryptoKey | CryptoKeyPair` and exportKey `ArrayBuffer | JsonWebKey` here.)
const keyPair = (await crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true,
  ['sign', 'verify'],
)) as CryptoKeyPair;
const pkcs8 = (await crypto.subtle.exportKey('pkcs8', keyPair.privateKey)) as ArrayBuffer;
const PEM = `-----BEGIN PRIVATE KEY-----\n${Buffer.from(new Uint8Array(pkcs8)).toString('base64')}\n-----END PRIVATE KEY-----\n`;

const SA_JSON = JSON.stringify({
  client_email: 'estate@audiobook-catalog.iam.gserviceaccount.com',
  private_key: PEM,
  project_id: 'audiobook-catalog',
});

/* ── stubs ─────────────────────────────────────────────────────────────── */

interface Call {
  url: string;
  method: string;
}

interface FirestoreScript {
  /** identitytoolkit accounts:lookup — null means "no such Firebase user". */
  user?: { localId: string; displayName?: string } | null;
  /** GET site_roles/{uid}: a role string, null for a 404 (no doc), or a status. */
  storedRole?: string | null;
  readStatus?: number;
  /** DELETE site_roles/{uid} outcome. */
  deleteStatus?: number;
  /** Make fetch itself blow up — the outage that is not an HTTP status. */
  throwOn?: 'token' | 'lookup' | 'read' | 'delete';
}

/**
 * `timeline`, when given, is the SHARED ordering log the D1 stub also writes
 * to — the only way to assert "D1 landed before Firestore was called".
 */
function stubFetch(script: FirestoreScript, timeline?: string[]) {
  const original = globalThis.fetch;
  const calls: Call[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ url, method });
    if (url.includes('firestore.googleapis.com')) timeline?.push(`firestore:${method}`);

    if (url.includes('oauth2.googleapis.com/token')) {
      if (script.throwOn === 'token') throw new TypeError('network error');
      return Response.json({ access_token: 'stub-access-token', expires_in: 3600 });
    }
    if (url.includes('identitytoolkit.googleapis.com')) {
      if (script.throwOn === 'lookup') throw new TypeError('network error');
      const user = script.user === undefined ? { localId: 'uid-target', displayName: 'Target' } : script.user;
      return Response.json(user ? { users: [user] } : {});
    }
    if (url.includes('firestore.googleapis.com')) {
      if (method === 'DELETE') {
        if (script.throwOn === 'delete') throw new TypeError('network error');
        return new Response('', { status: script.deleteStatus ?? 200 });
      }
      if (script.throwOn === 'read') throw new TypeError('network error');
      if (script.readStatus && script.readStatus !== 200) {
        return new Response('boom', { status: script.readStatus });
      }
      const role = script.storedRole === undefined ? 'admin' : script.storedRole;
      if (role === null) return new Response('', { status: 404 });
      return Response.json({
        name: `projects/p/databases/(default)/documents/site_roles/uid-target`,
        fields: { role: { stringValue: role }, email: { stringValue: 'target@example.com' } },
      });
    }
    throw new Error(`unexpected fetch: ${method} ${url}`);
  }) as typeof fetch;
  return { calls, restore: () => void (globalThis.fetch = original) };
}

/** Records every audit INSERT (site-roles-db.ts's one statement). */
function stubDb(opts: { throws?: boolean } = {}) {
  const rows: unknown[][] = [];
  const db = {
    prepare(sql: string) {
      if (opts.throws) throw new Error('D1 unavailable');
      return {
        bind(...args: unknown[]) {
          return { run: async () => void rows.push([sql, ...args]) };
        },
      };
    },
  };
  return { db: db as unknown as D1Database, rows };
}

function envWith(db: D1Database, over: Partial<Env> = {}): Env {
  return {
    DB: db,
    FIREBASE_SERVICE_ACCOUNT: SA_JSON,
    OWNER_EMAILS: 'owner@example.com, second.owner@example.com',
    ...over,
  } as Env;
}

/** The audit row's positional bindings, per 0005's INSERT column order. */
const AUDIT = { ACTOR_EMAIL: 1, ACTOR_ROLE: 2, TARGET_EMAIL: 3, TARGET_UID: 4, PREV: 5, REQUESTED: 6, OUTCOME: 7, REASON: 8 };

const deletes = (calls: Call[]) => calls.filter((c) => c.method === 'DELETE');

/* ── the clear itself ──────────────────────────────────────────────────── */

test('a revoked admin loses the Firestore ladder role — the doc is DELETEd', async () => {
  const { db, rows } = stubDb();
  const stub = stubFetch({ storedRole: 'admin' });
  try {
    const r = await clearSiteRoleOnRevocation(envWith(db), {
      targetEmail: 'target@example.com',
      actorEmail: 'approver@example.com',
    });
    assert.equal(r.cleared, true);
    assert.equal(r.reason, 'cleared');
    assert.equal(r.previousRole, 'admin');
    const del = deletes(stub.calls);
    assert.equal(del.length, 1, 'exactly one delete');
    assert.match(del[0]!.url, /site_roles\/uid-target$/);
  } finally {
    stub.restore();
  }
  assert.equal(rows.length, 1, 'and the clear is audited in D1');
});

test('⚠️ the clear is NOT subject to canGrant — a guest approver still strips an admin', async () => {
  // The whole point. Every other write in site-roles.ts requires the actor to
  // outrank the role at stake; an estate approver's own audiobook rank is
  // normally 'guest' (they need never have signed into that site). Gating
  // this on ladder rank would mean a revoked admin KEEPS the role because the
  // person revoking them is not an admin there — the exact privilege
  // retention this design exists to kill. The actor's role is never even
  // resolved: there is no lookup of the ACTOR's email at all.
  const { db } = stubDb();
  const stub = stubFetch({ storedRole: 'admin' });
  try {
    const r = await clearSiteRoleOnRevocation(envWith(db), {
      targetEmail: 'target@example.com',
      actorEmail: 'nobody-on-the-audiobook-ladder@example.com',
    });
    assert.equal(r.cleared, true);
    const lookups = stub.calls.filter((c) => c.url.includes('identitytoolkit'));
    assert.equal(lookups.length, 1, 'only the TARGET is resolved, never the actor');
  } finally {
    stub.restore();
  }
});

test('moderator is cleared too — rules enforce that role today as well', async () => {
  const { db } = stubDb();
  const stub = stubFetch({ storedRole: 'moderator' });
  try {
    const r = await clearSiteRoleOnRevocation(envWith(db), {
      targetEmail: 'mod@example.com', actorEmail: 'approver@example.com',
    });
    assert.equal(r.cleared, true);
    assert.equal(r.previousRole, 'moderator');
  } finally {
    stub.restore();
  }
});

test('no stored doc → nothing to clear, and nothing is deleted', async () => {
  const { db, rows } = stubDb();
  const stub = stubFetch({ storedRole: null });
  try {
    const r = await clearSiteRoleOnRevocation(envWith(db), {
      targetEmail: 'plain@example.com', actorEmail: 'approver@example.com',
    });
    assert.equal(r.cleared, false);
    assert.equal(r.reason, 'no_role');
    assert.equal(deletes(stub.calls).length, 0);
  } finally {
    stub.restore();
  }
  assert.equal(rows.length, 0, 'a non-event is not audited as a revocation');
});

test('no Firebase account on the audiobook site → no uid, no doc, no delete', async () => {
  const { db } = stubDb();
  const stub = stubFetch({ user: null });
  try {
    const r = await clearSiteRoleOnRevocation(envWith(db), {
      targetEmail: 'never-signed-in@example.com', actorEmail: 'approver@example.com',
    });
    assert.equal(r.cleared, false);
    assert.equal(r.reason, 'no_firebase_user');
    assert.equal(deletes(stub.calls).length, 0);
  } finally {
    stub.restore();
  }
});

/* ── ⚠️ THE OWNER IS NEVER STRIPPED ────────────────────────────────────── */

test('⚠️ an OWNER_EMAILS target is refused BEFORE any I/O — break-glass wins', async () => {
  // Revoking an owner's directory row is already toothless (approverAllows()
  // returns true for OWNER_EMAILS regardless of the row — gates.test.ts pins
  // that). The break-glass must not become half-real by having its audiobook
  // role deleted underneath it. Refused before the network is touched at all,
  // so not even an outage can change the answer.
  const { db, rows } = stubDb();
  const stub = stubFetch({ storedRole: 'admin' });
  try {
    const r = await clearSiteRoleOnRevocation(envWith(db), {
      targetEmail: 'Owner@Example.com', actorEmail: 'approver@example.com',
    });
    assert.equal(r.cleared, false);
    assert.equal(r.reason, 'owner_protected');
    assert.equal(r.previousRole, 'owner');
    assert.equal(stub.calls.length, 0, 'not one network call was made');
  } finally {
    stub.restore();
  }
  // ...and the ATTEMPT is on the record: "who tried to strip the owner" is
  // exactly what 0005's table exists to answer.
  assert.equal(rows.length, 1);
  assert.equal(rows[0]![AUDIT.OUTCOME], 'denied');
  assert.match(String(rows[0]![AUDIT.REASON]), /never stripped/i);
});

test('⚠️ the SECOND owner email is protected too, not just the first', async () => {
  const { db } = stubDb();
  const stub = stubFetch({ storedRole: 'admin' });
  try {
    const r = await clearSiteRoleOnRevocation(envWith(db), {
      targetEmail: 'second.owner@example.com', actorEmail: 'approver@example.com',
    });
    assert.equal(r.reason, 'owner_protected');
    assert.equal(stub.calls.length, 0);
  } finally {
    stub.restore();
  }
});

test('⚠️ a stray stored role of "owner" is refused too — DB-only means DB-only', async () => {
  // 'owner' is never written by this API, but it can be seeded by hand in the
  // Firestore console. effectiveLadderRole() trusts it on read, so the clear
  // must refuse it exactly like an OWNER_EMAILS row.
  const { db, rows } = stubDb();
  const stub = stubFetch({ storedRole: 'owner' });
  try {
    const r = await clearSiteRoleOnRevocation(envWith(db), {
      targetEmail: 'hand-seeded@example.com', actorEmail: 'approver@example.com',
    });
    assert.equal(r.cleared, false);
    assert.equal(r.reason, 'owner_protected');
    assert.equal(deletes(stub.calls).length, 0, 'the doc is read but never deleted');
  } finally {
    stub.restore();
  }
  assert.equal(rows[0]![AUDIT.OUTCOME], 'denied');
});

/* ── ⚠️ THE FIRESTORE-FAILS PATH — D1 must stay authoritative ──────────── */

test('⚠️ a failed DELETE never throws — the D1 revocation stands', async () => {
  // There is no transaction across D1 and Firestore. By the time this runs,
  // status='revoked' has already landed and the estate gates have already
  // shut. A Firestore outage must not turn that into a 500 for the approver
  // or, worse, into a half-undone revocation.
  const { db, rows } = stubDb();
  const stub = stubFetch({ storedRole: 'admin', deleteStatus: 503 });
  try {
    const r = await clearSiteRoleOnRevocation(envWith(db), {
      targetEmail: 'target@example.com', actorEmail: 'approver@example.com',
    });
    assert.equal(r.cleared, false);
    assert.equal(r.reason, 'firestore_error');
    assert.equal(r.status, 503);
    assert.equal(r.previousRole, 'admin', 'and it says WHICH role is still live');
  } finally {
    stub.restore();
  }
  assert.equal(rows.length, 0, '⚠️ never audited as revoked — it was not revoked');
});

test('⚠️ a failed READ never throws, and never blind-deletes', async () => {
  const { db } = stubDb();
  const stub = stubFetch({ readStatus: 500 });
  try {
    const r = await clearSiteRoleOnRevocation(envWith(db), {
      targetEmail: 'target@example.com', actorEmail: 'approver@example.com',
    });
    assert.equal(r.reason, 'firestore_error');
    assert.equal(r.status, 500);
    // An outage must not be read as "they hold no role"; equally it must not
    // fire a delete it cannot reason about.
    assert.equal(deletes(stub.calls).length, 0);
  } finally {
    stub.restore();
  }
});

test('⚠️ a thrown network error (not an HTTP status) is caught at every stage', async () => {
  // ⚠️ 'token' is deliberately NOT in this list, and the reason is a real
  // gotcha rather than a gap: firebase-sa.ts caches the OAuth access token
  // per ISOLATE for an hour, so by the time this test runs the token endpoint
  // is never called again in this process — a throwing stub there proves
  // nothing and, worse, silently passes the whole flow. (The first draft
  // asserted it and failed exactly that way.) The catch is one try/catch
  // around the entire body, so the three stages below exercise the same
  // handler a cold-isolate token failure would hit.
  for (const stage of ['lookup', 'read', 'delete'] as const) {
    const { db } = stubDb();
    const stub = stubFetch({ storedRole: 'admin', throwOn: stage });
    try {
      const r = await clearSiteRoleOnRevocation(envWith(db), {
        targetEmail: 'target@example.com', actorEmail: 'approver@example.com',
      });
      assert.equal(r.cleared, false, `stage ${stage}`);
      assert.equal(r.reason, 'firestore_error', `stage ${stage}`);
    } finally {
      stub.restore();
    }
  }
});

test('a missing service account is a configuration failure, not a crash', async () => {
  const { db } = stubDb();
  const stub = stubFetch({});
  try {
    const r = await clearSiteRoleOnRevocation(envWith(db, { FIREBASE_SERVICE_ACCOUNT: undefined }), {
      targetEmail: 'target@example.com', actorEmail: 'approver@example.com',
    });
    assert.equal(r.reason, 'service_account_unset');
    assert.equal(stub.calls.length, 0);
  } finally {
    stub.restore();
  }
});

test('a malformed service account throws inside firebase-sa but not out of here', async () => {
  const { db } = stubDb();
  const stub = stubFetch({});
  try {
    const r = await clearSiteRoleOnRevocation(envWith(db, { FIREBASE_SERVICE_ACCOUNT: 'not json{' }), {
      targetEmail: 'target@example.com', actorEmail: 'approver@example.com',
    });
    assert.equal(r.reason, 'firestore_error');
  } finally {
    stub.restore();
  }
});

test('⚠️ an audit-log failure does not undo the clear', async () => {
  // Same stance as the grant routes: the real decision has already happened
  // by the time the log is written, and a logging bug must not reverse it.
  const { db } = stubDb({ throws: true });
  const stub = stubFetch({ storedRole: 'admin' });
  try {
    const r = await clearSiteRoleOnRevocation(envWith(db), {
      targetEmail: 'target@example.com', actorEmail: 'approver@example.com',
    });
    assert.equal(r.cleared, true);
  } finally {
    stub.restore();
  }
});

/* ── the audit row: as traceable as a hand-made revoke ─────────────────── */

test('the audit row records outcome=revoked, the previous role, and WHO', async () => {
  const { db, rows } = stubDb();
  const stub = stubFetch({ storedRole: 'moderator' });
  try {
    await clearSiteRoleOnRevocation(envWith(db), {
      targetEmail: 'Target@Example.com', actorEmail: 'approver@example.com',
    });
  } finally {
    stub.restore();
  }
  const row = rows[0]!;
  assert.match(String(row[0]), /insert into site_role_grant_log/i);
  assert.equal(row[AUDIT.ACTOR_EMAIL], 'approver@example.com');
  assert.equal(row[AUDIT.TARGET_EMAIL], 'target@example.com', 'lowercased, like every other email here');
  assert.equal(row[AUDIT.TARGET_UID], 'uid-target');
  assert.equal(row[AUDIT.PREV], 'moderator');
  assert.equal(row[AUDIT.REQUESTED], null, 'null requested_role = a revoke');
  assert.equal(row[AUDIT.OUTCOME], 'revoked');
});

test('⚠️ actor_role says estate-revocation, NOT a ladder role', async () => {
  // Recording the actor's real ladder rank here would invite a later reader
  // to conclude canGrant() had been consulted. It was not, deliberately —
  // this clear runs on DIRECTORY authority. The distinct value is also the
  // query for "everything a revocation ever cleared".
  const { db, rows } = stubDb();
  const stub = stubFetch({ storedRole: 'admin' });
  try {
    await clearSiteRoleOnRevocation(envWith(db), {
      targetEmail: 'target@example.com', actorEmail: 'approver@example.com',
    });
  } finally {
    stub.restore();
  }
  assert.equal(rows[0]![AUDIT.ACTOR_ROLE], 'estate-revocation');
  for (const ladderRole of ['guest', 'member', 'contributor', 'moderator', 'admin', 'owner']) {
    assert.notEqual(rows[0]![AUDIT.ACTOR_ROLE], ladderRole);
  }
});

/* ── the sentences, per the never-a-bare-status rule (ROLES.md §1e) ─────── */

test('every outcome answers in a sentence, never a bare status code', async () => {
  const scripts: FirestoreScript[] = [
    { storedRole: 'admin' },
    { storedRole: null },
    { user: null },
    { storedRole: 'owner' },
    { storedRole: 'admin', deleteStatus: 503 },
    { readStatus: 500 },
    { storedRole: 'admin', throwOn: 'lookup' },
  ];
  for (const script of scripts) {
    const { db } = stubDb();
    const stub = stubFetch(script);
    try {
      const r = await clearSiteRoleOnRevocation(envWith(db), {
        targetEmail: 'target@example.com', actorEmail: 'approver@example.com',
      });
      assert.ok(r.detail.length > 30, `too terse: ${r.detail}`);
      assert.ok(/[.!]$/.test(r.detail), `not a sentence: ${r.detail}`);
      assert.doesNotMatch(r.detail, /\b(4\d\d|5\d\d)\b/, `leaks a bare status: ${r.detail}`);
    } finally {
      stub.restore();
    }
  }
  // ...and the owner refusal too, which never reaches the network.
  const { db } = stubDb();
  const r = await clearSiteRoleOnRevocation(envWith(db), {
    targetEmail: 'owner@example.com', actorEmail: 'approver@example.com',
  });
  assert.ok(/never removed automatically\.$/.test(r.detail), r.detail);
});

/* ═══════════════════════════════════════════════════════════════════════════
 * THE WIRING — POST /estate/users/:id/status, end to end
 *
 * ⚠️ These are the tests that pin WHERE the clear lives, and they are the
 * reason this file bothers to drive the real route instead of only the
 * function: the design's whole safety argument is an ORDER (D1 first, its
 * success independent of Firestore) and an order cannot be tested one half at
 * a time. Both stubs append to one shared timeline, so "D1 landed before
 * Firestore was even called" is an assertion rather than a claim.
 *
 * `resolveIdentity`'s development bypass (ENVIRONMENT === 'development' +
 * DEV_EMAIL) supplies the approver, so no Firebase ID token is needed.
 * ═════════════════════════════════════════════════════════════════════════ */

function row(over: Partial<EstateUserRow> = {}): EstateUserRow {
  return {
    id: 1, email: 'someone@example.com', firebase_uid: 'uid-1', display_name: 'Someone',
    status: 'approved', is_approver: 0, is_devops: 0, dev_access: 0, origin: 'seen:library', note: null,
    first_seen_at: '2026-08-14 00:00:00', decided_at: null, decided_by: null,
    vis_audiobook: 1, vis_library: 1, vis_games: 1, vis_library2: 0, vis_ebooks: 0, ...over,
  };
}

/** A D1 stub that answers the three statements this route actually runs. */
function routeDb(timeline: string[]) {
  const actor = row({ id: 1, email: 'approver@example.com', is_approver: 1 });
  const target = row({ id: 7, email: 'target@example.com', is_approver: 1, is_devops: 1 });
  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            first: async () => {
              if (/^\s*UPDATE estate_user/i.test(sql)) {
                timeline.push(`d1:update:${String(args[0])}`);
                return { ...target, status: String(args[0]), is_approver: 0, is_devops: 0, dev_access: 0 };
              }
              if (/WHERE email = \?/.test(sql)) return actor;
              if (/WHERE id = \?/.test(sql)) return target;
              return null;
            },
            run: async () => void timeline.push('d1:audit-insert'),
          };
        },
      };
    },
  };
  return db as unknown as D1Database;
}

function routeEnv(db: D1Database, over: Partial<Env> = {}): Env {
  return {
    DB: db,
    ENVIRONMENT: 'development',
    DEV_EMAIL: 'approver@example.com',
    FIREBASE_SERVICE_ACCOUNT: SA_JSON,
    OWNER_EMAILS: 'owner@example.com',
    ...over,
  } as Env;
}

function postStatus(env: Env, id: number, body: unknown) {
  return estateRoutes.request(
    `/estate/users/${id}/status`,
    { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } },
    env,
  );
}

test('the route revokes in D1 and THEN clears the ladder role — in that order', async () => {
  const timeline: string[] = [];
  const stub = stubFetch({ storedRole: 'admin' }, timeline);
  try {
    const res = await postStatus(routeEnv(routeDb(timeline)), 7, { status: 'revoked' });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { user: { status: string }; site_role: { cleared: boolean } };
    assert.equal(body.user.status, 'revoked');
    assert.equal(body.site_role.cleared, true);
  } finally {
    stub.restore();
  }

  // ⚠️ The order IS the design: D1 is the gate that admits people, so it is
  // written first and never waits on the other store.
  assert.equal(timeline[0], 'd1:update:revoked');
  assert.ok(timeline.indexOf('d1:update:revoked') < timeline.findIndex((t) => t.startsWith('firestore:')));
  assert.ok(timeline.includes('firestore:DELETE'));
});

test('⚠️ Firestore failing does NOT fail or half-fail the revocation', async () => {
  // The property the whole design rests on. There is no transaction across
  // the two stores; if this ever answers 500, or leaves status unrevoked, an
  // outage in the WEAKER store has broken the STRONGER one.
  const timeline: string[] = [];
  const stub = stubFetch({ storedRole: 'admin', deleteStatus: 503 });
  try {
    const res = await postStatus(routeEnv(routeDb(timeline)), 7, { status: 'revoked' });
    assert.equal(res.status, 200, 'the approver gets an answer, not a 500');
    const body = (await res.json()) as {
      user: { status: string; is_approver: boolean; is_devops: boolean };
      site_role: { cleared: boolean; reason: string; detail: string };
    };
    assert.equal(body.user.status, 'revoked');
    assert.equal(body.user.is_approver, false, 'the D1 powers are gone regardless');
    assert.equal(body.user.is_devops, false);
    assert.equal(body.site_role.cleared, false);
    assert.equal(body.site_role.reason, 'firestore_error');
    // ...and it SAYS so, in words, rather than failing silently.
    assert.match(body.site_role.detail, /revocation went through/i);
  } finally {
    stub.restore();
  }
  assert.equal(timeline[0], 'd1:update:revoked');
});

test('approving touches Firestore not at all, and carries no site_role', async () => {
  // Re-approval restores MEMBERSHIP only — "they need to reearn all rights".
  // The ladder role is not handed back, so there is nothing to call here.
  const timeline: string[] = [];
  const stub = stubFetch({ storedRole: 'admin' });
  try {
    const res = await postStatus(routeEnv(routeDb(timeline)), 7, { status: 'approved' });
    assert.equal(res.status, 200);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal('site_role' in body, false);
    assert.equal(stub.calls.length, 0, 'not one call to the role store');
  } finally {
    stub.restore();
  }
});

test('revoking an OWNER: the D1 row is written, the audiobook role is not', async () => {
  // The break-glass stays whole. approverAllows() already ignores the row for
  // an OWNER_EMAILS address (gates.test.ts), so the revocation is cosmetic —
  // what must NOT happen is the owner losing their audiobook role as a side
  // effect of someone pressing Revoke on a row that cannot bite anyway.
  const timeline: string[] = [];
  const db = routeDb(timeline);
  const stub = stubFetch({ storedRole: 'admin' });
  try {
    // Target row's email is owner@example.com for this one call.
    const env = routeEnv(db, { OWNER_EMAILS: 'target@example.com' });
    const res = await postStatus(env, 7, { status: 'revoked' });
    const body = (await res.json()) as { user: { status: string }; site_role: { reason: string } };
    assert.equal(body.user.status, 'revoked', 'D1 still records the decision');
    assert.equal(body.site_role.reason, 'owner_protected');
    assert.equal(stub.calls.length, 0, 'and the role store is never even asked');
  } finally {
    stub.restore();
  }
});
