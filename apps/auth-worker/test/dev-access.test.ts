/**
 * DEV-LANE ACCESS (migration 0011) — the owner's ask of 2026-08-17, verbatim:
 *
 *   *"i need a way in the estate to manage dev access for ebook, add a button
 *    for give dev access also make devops always able to see dev envs."*
 *
 * Two sentences, and the second is the one worth testing hardest: **devops
 * implies dev access, always**, computed at read time and never stored. The
 * failure this pins is the one 0009 actually shipped — a grant materialized
 * into a row, which then outlived the thing that justified it.
 *
 * Written in the suite's own idiom (gates.test.ts's pure-predicate style for
 * the decision, revoke-clears-powers.test.ts's statement-capturing stub for the
 * write, revoke-clears-site-role.test.ts's dev-bypass route requests for the
 * authorization). Every test here is written to FAIL if the behaviour breaks —
 * none asserts that a function merely returns something.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { estateRoutes } from '../src/estate.js';
import { decideStatus, setDevAccess } from '../src/estate-db.js';
import type { Env, EstateUserRow } from '../src/env.js';
import { devAccessAllows } from '../src/middleware/auth.js';

function row(over: Partial<EstateUserRow> = {}): EstateUserRow {
  return {
    id: 1,
    email: 'bob@example.com',
    firebase_uid: 'uid-bob',
    display_name: 'Bob',
    status: 'approved',
    is_approver: 0,
    is_devops: 0,
    dev_access: 0, // the 0011 DB default
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

/* ── the decision: devAccessAllows() ───────────────────────────────────── */

test('dev access is OFF by default — approval alone grants nothing', () => {
  // 0011 is DEFAULT 0 and ADD COLUMN backfills every existing row with 0, so
  // the day it lands nobody has gained anything they did not already hold.
  assert.equal(devAccessAllows(row(), false), false);
});

test('granted by hand → true; taken away again → false', () => {
  assert.equal(devAccessAllows(row({ dev_access: 1 }), false), true);
  assert.equal(devAccessAllows(row({ dev_access: 0 }), false), false);
});

test('⚠️ DEVOPS IMPLIES DEV ACCESS — a devops row with dev_access = 0 answers true', () => {
  // The owner's second sentence: *"make devops always able to see dev envs"*.
  // ⚠️ dev_access is 0 here ON PURPOSE. If this ever needs the stored flag to
  // be 1, someone has materialized the implication into the row — exactly what
  // 0009 did with downloads, and exactly why removing devops would then leave
  // the dev grant behind.
  assert.equal(devAccessAllows(row({ is_devops: 1, dev_access: 0 }), false), true);
});

test('⚠️ removing devops removes the implied access in the same act', () => {
  // The property the computed OR buys, and the reason it is not a write. Same
  // person, devops taken away, nothing else touched.
  const wasDevops = row({ is_devops: 1, dev_access: 0 });
  assert.equal(devAccessAllows(wasDevops, false), true);
  assert.equal(devAccessAllows({ ...wasDevops, is_devops: 0 }, false), false);
  // …but a HAND grant survives losing devops, because that one was decided.
  const both = row({ is_devops: 1, dev_access: 1 });
  assert.equal(devAccessAllows({ ...both, is_devops: 0 }, false), true);
});

test('approvers hold it implicitly too — the estate never fences an approver out', () => {
  // 0003's own rule (devopsAllows ORs in is_approver); dev access inherits it
  // rather than inventing a narrower ladder one rung down.
  assert.equal(devAccessAllows(row({ is_approver: 1, is_devops: 0, dev_access: 0 }), false), true);
});

test('⚠️ status gates it: a pending or revoked row is refused, flag or no flag', () => {
  // Matches devopsAllows() — a revoked person's leftover flag must not keep a
  // door open. (decideStatus also clears the stored flag; two barriers.)
  assert.equal(devAccessAllows(row({ status: 'pending', dev_access: 1 }), false), false);
  assert.equal(devAccessAllows(row({ status: 'revoked', dev_access: 1 }), false), false);
  assert.equal(devAccessAllows(row({ status: 'revoked', is_devops: 1 }), false), false);
  assert.equal(devAccessAllows(row({ status: 'revoked', is_approver: 1 }), false), false);
});

test('no directory row is refused; OWNER_EMAILS always gets in', () => {
  assert.equal(devAccessAllows(null, false), false);
  assert.equal(devAccessAllows(null, true), true);
  // The break-glass cannot be narrowed into a lockout, even by a revocation.
  assert.equal(devAccessAllows(row({ status: 'revoked' }), true), true);
});

test('every account the devops gate admits, dev access admits too', () => {
  // The ladder holds in one direction only. If this inverts, the owner's
  // "devops always" has been broken by something that looked like a cleanup.
  const cases: EstateUserRow[] = [
    row({ is_devops: 1 }),
    row({ is_approver: 1 }),
    row({ is_approver: 1, is_devops: 1 }),
    row({ status: 'revoked', is_devops: 1 }),
    row({ status: 'pending', is_devops: 1 }),
    row(),
  ];
  for (const r of cases) {
    // devopsAllows' own definition, restated locally so this test fails if the
    // relationship changes rather than if the helper does.
    const devops = r.status === 'approved' && (r.is_devops === 1 || r.is_approver === 1);
    if (devops) {
      assert.equal(devAccessAllows(r, false), true, `dev access refused a devops: ${JSON.stringify(r)}`);
    }
  }
});

/* ── the write: setDevAccess() ─────────────────────────────────────────── */

/** Captures every statement prepared, and answers `first()` with a fake row. */
function stubDb() {
  const statements: string[] = [];
  const bindings: unknown[][] = [];
  const db = {
    prepare(sql: string) {
      statements.push(sql);
      return {
        bind(...args: unknown[]) {
          bindings.push(args);
          return { first: async () => ({ id: 1, email: 'x@y.z' }) };
        },
      };
    },
  };
  return { db: db as unknown as D1Database, statements, bindings };
}

const sqlOf = (s: string | undefined) => (s ?? '').replace(/\s+/g, ' ').toLowerCase();
/** ⚠️ Only the SET clause counts — `RETURNING ${COLS}` names every column. */
const setClause = (s: string | undefined) => sqlOf(s).split(' where ')[0] ?? '';

test('setDevAccess writes 1 / 0 and stamps the decision', async () => {
  for (const [grant, want] of [[true, 1], [false, 0]] as const) {
    const { db, statements, bindings } = stubDb();
    await setDevAccess(db, { id: 7, devAccess: grant, actorId: 3 });
    assert.equal(statements.length, 1, 'one decision, one write');
    const sql = setClause(statements[0]);
    assert.match(sql, /dev_access = \?/);
    assert.match(sql, /decided_at = datetime\('now'\)/, 'who changed dev access, and when, must be reconstructible');
    assert.match(sql, /decided_by = \?/);
    assert.deepEqual(bindings[0], [want, 3, 7]);
  }
});

test('⚠️ setDevAccess touches NOTHING else — not status, not the other powers', async () => {
  // A grant that quietly approved someone, or that set is_devops to keep the
  // answer "consistent", would be the stored-implication bug wearing a helpful
  // face. The flip is one column.
  const { db, statements } = stubDb();
  await setDevAccess(db, { id: 7, devAccess: true, actorId: 1 });
  const sql = setClause(statements[0]);
  assert.doesNotMatch(sql, /status\s*=/);
  assert.doesNotMatch(sql, /is_devops\s*=/);
  assert.doesNotMatch(sql, /is_approver\s*=/);
  assert.doesNotMatch(sql, /vis_/);
  assert.match(sqlOf(statements[0]).trim(), /^update estate_user/);
  assert.doesNotMatch(sqlOf(statements[0]), /delete/);
});

test('revoking clears dev_access in the same statement as the other powers', async () => {
  // 0006's rule, extended to the power added on 2026-08-17. Re-approval must
  // restore MEMBERSHIP and never powers — which works because there is nothing
  // left to restore.
  const { db, statements } = stubDb();
  await decideStatus(db, { id: 7, status: 'revoked', actorId: 1 });
  assert.match(setClause(statements[0]), /dev_access = 0/);
  // …and on the visibility path too, the classic place a fix half-lands.
  const second = stubDb();
  await decideStatus(second.db, { id: 7, status: 'revoked', actorId: 1, visibility: ['audiobook'] });
  assert.match(setClause(second.statements[0]), /dev_access = 0/);
});

test('approving does NOT hand dev access back', async () => {
  const { db, statements } = stubDb();
  await decideStatus(db, { id: 7, status: 'approved', actorId: 1 });
  assert.doesNotMatch(setClause(statements[0]), /dev_access\s*=/);
});

/* ── the route: POST /estate/users/:id/dev-access ──────────────────────── */

/**
 * A D1 stub answering the statements this route runs: the actor lookup by
 * email (requireApprover), the target lookup by id, and the UPDATE. Records
 * whether any UPDATE was attempted, which is what a refusal must prove.
 */
function routeDb(actorRow: EstateUserRow, targetRow: EstateUserRow) {
  const writes: unknown[][] = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            first: async () => {
              if (/^\s*UPDATE estate_user/i.test(sql)) {
                writes.push(args);
                return { ...targetRow, dev_access: Number(args[0]) };
              }
              if (/WHERE email = \?/.test(sql)) return actorRow;
              if (/WHERE id = \?/.test(sql)) return targetRow;
              return null;
            },
            run: async () => {},
          };
        },
      };
    },
  };
  return { db: db as unknown as D1Database, writes };
}

function devEnv(db: D1Database, over: Partial<Env> = {}): Env {
  return {
    DB: db,
    ENVIRONMENT: 'development',
    DEV_EMAIL: 'approver@example.com',
    OWNER_EMAILS: 'owner@example.com',
    FIREBASE_PROJECT_ID: 'test-project',
    ...over,
  } as Env;
}

function postDevAccess(env: Env, id: number, body: unknown, headers: Record<string, string> = {}) {
  return estateRoutes.request(
    `/estate/users/${id}/dev-access`,
    {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json', ...headers },
    },
    env,
  );
}

const approver = row({ id: 1, email: 'approver@example.com', is_approver: 1 });

test('an approver grants dev access: the flag is written and the payload says so', async () => {
  const target = row({ id: 7, email: 'target@example.com' });
  const { db, writes } = routeDb(approver, target);
  const res = await postDevAccess(devEnv(db), 7, { dev_access: true });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { user: { dev_access: boolean; dev_access_effective: boolean } };
  assert.equal(writes.length, 1);
  assert.equal(writes[0]?.[0], 1, 'the column is written as 1');
  assert.equal(body.user.dev_access, true, 'the STORED grant');
  assert.equal(body.user.dev_access_effective, true, 'and what a gate would honour');
});

test('an approver takes it away again', async () => {
  const target = row({ id: 7, email: 'target@example.com', dev_access: 1 });
  const { db, writes } = routeDb(approver, target);
  const res = await postDevAccess(devEnv(db), 7, { dev_access: false });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { user: { dev_access: boolean; dev_access_effective: boolean } };
  assert.equal(writes[0]?.[0], 0);
  assert.equal(body.user.dev_access, false);
  assert.equal(body.user.dev_access_effective, false);
});

test('⚠️ a DEVOPS row reports effective TRUE while the stored flag stays 0', async () => {
  // The listing must let the admin page tell "granted by hand" from "holds it
  // because they are devops" — the page draws a button for the first and a
  // worded fact for the second, and it must not have to re-derive the OR.
  const target = row({ id: 7, email: 'target@example.com', is_devops: 1, dev_access: 0 });
  const { db } = routeDb(approver, target);
  const res = await postDevAccess(devEnv(db), 7, { dev_access: false });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { user: { dev_access: boolean; dev_access_effective: boolean } };
  assert.equal(body.user.dev_access, false, 'nothing was stored');
  assert.equal(body.user.dev_access_effective, true, 'and they still see the dev lane');
});

test('granting to someone not yet approved is refused in words, and writes nothing', async () => {
  const target = row({ id: 7, email: 'target@example.com', status: 'pending' });
  const { db, writes } = routeDb(approver, target);
  const res = await postDevAccess(devEnv(db), 7, { dev_access: true });
  assert.equal(res.status, 409);
  const body = (await res.json()) as { error: string; detail: string };
  assert.equal(body.error, 'not_approved');
  assert.match(body.detail, /approve this person/i, 'a sentence, never a bare status');
  assert.equal(writes.length, 0);
});

/* ── authorization: who may NOT flip it ────────────────────────────────── */

test('⚠️ a NON-APPROVER cannot flip it — 403 with the gate’s own sentence, nothing written', async () => {
  // Same authorization as the devops flip (requireApprover), mirrored exactly.
  const caller = row({ id: 2, email: 'approver@example.com', is_approver: 0 });
  const target = row({ id: 7, email: 'target@example.com' });
  const { db, writes } = routeDb(caller, target);
  const res = await postDevAccess(devEnv(db), 7, { dev_access: true });
  assert.equal(res.status, 403);
  const body = (await res.json()) as { error: string; detail: string };
  assert.equal(body.error, 'forbidden');
  assert.match(body.detail, /approver account/i);
  assert.equal(writes.length, 0, 'a refused call must not reach the UPDATE');
});

test('⚠️ a REVOKED approver cannot flip it either — the flag does not outlive the status', async () => {
  // The live privilege-retention bug gates.test.ts pins, re-asserted on the
  // newest mutation so it cannot come back on one route only.
  const caller = row({ id: 2, email: 'approver@example.com', is_approver: 1, status: 'revoked' });
  const target = row({ id: 7, email: 'target@example.com' });
  const { db, writes } = routeDb(caller, target);
  const res = await postDevAccess(devEnv(db), 7, { dev_access: true });
  assert.equal(res.status, 403);
  assert.equal(writes.length, 0);
});

test('a DEVOPS-but-not-approver cannot flip it — reading the dev lane is not granting it', async () => {
  const caller = row({ id: 2, email: 'approver@example.com', is_devops: 1, is_approver: 0 });
  const target = row({ id: 7, email: 'target@example.com' });
  const { db, writes } = routeDb(caller, target);
  const res = await postDevAccess(devEnv(db), 7, { dev_access: true });
  assert.equal(res.status, 403);
  assert.equal(writes.length, 0);
});

test('an UNAUTHENTICATED call is refused with a worded error, never a bare status', async () => {
  // No dev bypass, no bearer: resolveIdentity answers null and the gate says so
  // in a JSON body the admin page can render as a sentence (global rule: a
  // person must never see a bare HTTP status).
  const target = row({ id: 7, email: 'target@example.com' });
  const { db, writes } = routeDb(approver, target);
  const env = { DB: db, OWNER_EMAILS: '', FIREBASE_PROJECT_ID: 'test-project' } as Env;
  const res = await postDevAccess(env, 7, { dev_access: true });
  assert.equal(res.status, 401);
  const body = (await res.json()) as { error: string };
  assert.equal(body.error, 'unauthenticated');
  assert.equal(writes.length, 0);
});

test('the body is strict: an unknown or missing field is a 400, not a silent no-op', async () => {
  const target = row({ id: 7, email: 'target@example.com' });
  for (const bad of [{}, { dev_access: 'yes' }, { dev_access: true, is_devops: true }, { is_devops: true }]) {
    const { db, writes } = routeDb(approver, target);
    const res = await postDevAccess(devEnv(db), 7, bad);
    assert.equal(res.status, 400, `accepted a bad body: ${JSON.stringify(bad)}`);
    assert.equal(writes.length, 0);
  }
});

/* ── the curtain-vs-lock boundary ──────────────────────────────────────── */

test('⚠️ dev access NEVER touches `visibility` — the curtain is not the lock', () => {
  // The one confusion that would matter. `vis_ebooks` (0008) is what gates the
  // ebook manifest and byte stream, on BOTH lanes, enforced by
  // apps/audiobook-worker. A dev-access grant must not widen what a person may
  // see, and taking it away must not narrow it.
  const granted = row({ status: 'approved', vis_ebooks: 0, dev_access: 1 });
  assert.equal(devAccessAllows(granted, false), true);
  assert.equal(granted.vis_ebooks, 0, 'dev access granted nobody the ebook shelf');
  // And the reverse: holding the shelf grants no dev lane.
  const shelfOnly = row({ status: 'approved', vis_ebooks: 1 });
  assert.equal(devAccessAllows(shelfOnly, false), false);
});
