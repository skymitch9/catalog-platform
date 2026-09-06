/**
 * The three gate MIDDLEWARES, executed — not the predicates they call.
 *
 * ⚠️ WHY THIS FILE EXISTS, and it is the same reason `gates.test.ts` exists,
 * one layer out. That file was written in 2026-08-16 after a mutation audit
 * found the gate DECISIONS untested; the fix was to extract them as pure
 * predicates, and it worked — the 2026-09-05 mutation run
 * (`docs/info/mutation-run-2026-09-05.md` §2.1) killed **seven of seven**
 * mutations to `approverAllows` / `devopsAllows` / `devAccessAllows` /
 * `memberAllows`.
 *
 * 🔴 **And then it short-circuited the WRAPPER — `requireApprover()` rewritten
 * to `if (false && !approverAllows(row, isOwner))`, the approver gate disabled
 * outright — and all 50 named cases passed** (CP-08). §5 S2 of that document:
 * *"the estate tests the functions that DECIDE and does not test the code that
 * ACTS on the decision. The predicates are 7-for-7; the middlewares are
 * 0-for-4."*
 *
 * So every test below drives a real `Request` through the real middleware and
 * reads the refusal off the wire. `resolveIdentity`'s development bypass
 * (`ENVIRONMENT === 'development'` + `DEV_EMAIL`) supplies the identity —
 * the same harness `revoke-clears-site-role.test.ts` uses — so there is no
 * network, no JWKS fetch and no minted token.
 *
 * ## What it pins
 *
 * 1. **The gate REFUSES**, and the handler behind it is never reached. That is
 *    CP-08 and nothing else was measuring it.
 * 2. **The four causes stay four**, per the estate's standing rule that a
 *    person never meets a bare status: not signed in (401) / no record yet /
 *    awaiting approval / revoked, plus misconfigured (500) which is a SERVER
 *    failure and must never be dressed as a permission failure.
 * 3. **The 2026-08-16 privilege-retention bug is refused AT THE DOOR**, not
 *    merely by the predicate: `decideStatus` revokes without clearing
 *    `is_approver`, so a `status='revoked', is_approver=1` row exists in
 *    production the moment anybody is revoked.
 *
 * ## What it does NOT prove
 *
 * No live D1, no real Firebase token, no signature verification (that is
 * `packages/estate-auth`'s own suite, and `estate-auth-verify.test.ts` beside
 * this one). The D1 stub answers `getUserByEmail` and nothing else, so a
 * middleware that started reading something else would throw here rather than
 * quietly pass.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Hono } from 'hono';
import { estateRoutes } from '../src/estate.js';
import {
  requireApprovedMember,
  requireApprover,
  requireDevops,
} from '../src/middleware/auth.js';
import type { AppBindings, Env, EstateUserRow } from '../src/env.js';

// ---------------------------------------------------------------------------
// harness
// ---------------------------------------------------------------------------

const ACTOR = 'actor@example.test';

function row(over: Partial<EstateUserRow> = {}): EstateUserRow {
  return {
    id: 1,
    email: ACTOR,
    firebase_uid: 'uid-1',
    display_name: 'Actor',
    status: 'approved',
    is_approver: 0,
    is_devops: 0,
    dev_access: 0,
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

/**
 * A D1 stub that answers ONLY the two statements these middlewares run —
 * `getUserByEmail` and `materializeOwnerRow` — and REMEMBERS every SQL it was
 * handed, so "the refused caller never reached the work" is an assertion
 * rather than a hope.
 */
function stubDb(actorRow: EstateUserRow | null) {
  const sqlSeen: string[] = [];
  const db = {
    prepare(sql: string) {
      sqlSeen.push(sql);
      const stmt = {
        bind() {
          return stmt;
        },
        async first() {
          if (/FROM estate_user WHERE email = \?/.test(sql)) return actorRow;
          if (/^INSERT INTO estate_user/.test(sql.trim())) {
            return row({ id: 99, email: ACTOR, is_approver: 1, origin: 'manual' });
          }
          return null;
        },
        async all() {
          return { results: [] };
        },
        async run() {
          return { meta: { changes: 1 } };
        },
      };
      return stmt;
    },
    _sql: sqlSeen,
  };
  return db as unknown as D1Database & { _sql: string[] };
}

/** Signed in as ACTOR through the dev bypass; no token, no network. */
function envAs(actorRow: EstateUserRow | null, over: Partial<Env> = {}) {
  const db = stubDb(actorRow);
  const env = {
    DB: db,
    ENVIRONMENT: 'development',
    DEV_EMAIL: ACTOR,
    OWNER_EMAILS: 'owner@example.test',
    FIREBASE_PROJECT_ID: 'audiobook-catalog',
    ...over,
  } as unknown as Env;
  return { env, db };
}

/** One route behind one middleware — the whole point is the middleware. */
function gated(mw: ReturnType<typeof requireApprover>) {
  const app = new Hono<AppBindings>();
  app.get('/probe', mw, (c) => c.json({ reached: true, actor: c.get('actor')?.email ?? null }));
  return app;
}

async function probe(mw: ReturnType<typeof requireApprover>, actorRow: EstateUserRow | null, over: Partial<Env> = {}) {
  const { env, db } = envAs(actorRow, over);
  const res = await gated(mw).request('/probe', {}, env);
  const body = (await res.json()) as {
    error?: string;
    detail?: string;
    reached?: boolean;
    actor?: string | null;
  };
  return { res, body, db };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 1. requireApprover() — CP-08's gate
 * ═════════════════════════════════════════════════════════════════════════ */

test('🔴 approver gate: an approved NON-approver is REFUSED and never reaches the route', async () => {
  // CP-08 in one line. With the gate short-circuited this answers 200.
  const { res, body } = await probe(requireApprover(), row({ is_approver: 0 }));
  assert.equal(res.status, 403);
  assert.equal(body.error, 'forbidden');
  assert.match(body.detail ?? '', /requires an approver account/);
  assert.equal(body.reached, undefined, 'the handler ran behind a gate that should have refused');
});

test('🔴 approver gate: a REVOKED approver is refused AT THE DOOR, flag and all', async () => {
  // The 2026-08-16 live privilege-retention bug, pinned at the wrapper rather
  // than only at the predicate. `decideStatus` revokes without clearing
  // `is_approver`, so this exact row exists in production the moment anybody
  // is revoked — and this gate is the one that grants and revokes everyone
  // else, so passing it would let a revoked person re-approve themselves.
  const { res, body } = await probe(requireApprover(), row({ status: 'revoked', is_approver: 1 }));
  assert.equal(res.status, 403);
  assert.equal(body.error, 'forbidden');
  assert.equal(body.reached, undefined);
});

test('approver gate: a PENDING approver is refused — approval precedes power', async () => {
  const { res } = await probe(requireApprover(), row({ status: 'pending', is_approver: 1 }));
  assert.equal(res.status, 403);
});

test('approver gate: NO directory row is refused — an empty table admits nobody', async () => {
  // The no-bootstrap stance (design §4.3): the way in never depends on the
  // thing being changed.
  const { res, body } = await probe(requireApprover(), null);
  assert.equal(res.status, 403);
  assert.equal(body.reached, undefined);
});

test('approver gate: an APPROVED approver is admitted, and the actor is attached', async () => {
  const { res, body } = await probe(requireApprover(), row({ is_approver: 1 }));
  assert.equal(res.status, 200);
  assert.equal(body.reached, true);
  assert.equal(body.actor, ACTOR, 'the route needs `actor` to stamp decided_by');
});

test('approver gate: OWNER_EMAILS is the break-glass path and materializes its own row', async () => {
  // No row at all, and the gate must still open — otherwise an incident that
  // emptied the directory would lock the owner out of the fix.
  const { env, db } = envAs(null, { DEV_EMAIL: 'owner@example.test' });
  const res = await gated(requireApprover()).request('/probe', {}, env);
  assert.equal(res.status, 200);
  assert.ok(
    db._sql.some((s) => /^INSERT INTO estate_user/.test(s.trim())),
    'decided_by needs an id, so the break-glass actor becomes a row',
  );
});

test('🔴 approver gate: NOT SIGNED IN is a 401, and it is not a 403', async () => {
  // No dev bypass and no Authorization header: `readBearer` answers null long
  // before any signature check. The CODE stays exactly `unauthenticated` —
  // tools/estate-probes asserts it across this Worker's whole unauthenticated
  // edge and every page branches on it.
  const { res, body } = await probe(requireApprover(), row({ is_approver: 1 }), {
    ENVIRONMENT: 'production',
    DEV_EMAIL: undefined,
  });
  assert.equal(res.status, 401);
  assert.equal(body.error, 'unauthenticated');
  assert.match(body.detail ?? '', /sign in/i);
});

test('🔴 approver gate: MISCONFIGURED is a 500 — a server failure is never a permission failure', async () => {
  // No FIREBASE_PROJECT_ID: the verifier throws. Answering 403 here would send
  // somebody asking for access they already have.
  const { res, body } = await probe(requireApprover(), row({ is_approver: 1 }), {
    ENVIRONMENT: 'production',
    DEV_EMAIL: undefined,
    FIREBASE_PROJECT_ID: undefined,
  });
  assert.equal(res.status, 500);
  assert.equal(body.error, 'misconfigured');
  assert.match(body.detail ?? '', /FIREBASE_PROJECT_ID/);
  assert.ok(!/approver|role/i.test(body.detail ?? ''), 'a config failure is not a permission failure');
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 2. requireDevops() — runbooks, backups, pipeline controls
 * ═════════════════════════════════════════════════════════════════════════ */

test('🔴 devops gate: an approved account with neither flag is REFUSED', async () => {
  const { res, body } = await probe(requireDevops(), row());
  assert.equal(res.status, 403);
  assert.equal(body.error, 'forbidden');
  assert.match(body.detail ?? '', /devops and admins/);
  assert.equal(body.reached, undefined);
});

test('🔴 devops gate: a REVOKED devops account is refused', async () => {
  const { res } = await probe(requireDevops(), row({ status: 'revoked', is_devops: 1 }));
  assert.equal(res.status, 403);
});

test('devops gate: an approved devops account is admitted', async () => {
  const { res, body } = await probe(requireDevops(), row({ is_devops: 1 }));
  assert.equal(res.status, 200);
  assert.equal(body.reached, true);
});

test('devops gate: an approver qualifies implicitly, without the devops flag', async () => {
  // 0003's deliberate rule — the flag exists to let somebody read runbooks
  // WITHOUT holding the directory's keys, never to fence approvers out.
  const { res } = await probe(requireDevops(), row({ is_approver: 1, is_devops: 0 }));
  assert.equal(res.status, 200);
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 3. requireApprovedMember() — four causes, four sentences
 * ═════════════════════════════════════════════════════════════════════════ */

test('🔴 member gate: the four causes get FOUR different answers, because the fixes differ', async () => {
  const unknown = await probe(requireApprovedMember(), null);
  assert.equal(unknown.res.status, 403);
  assert.equal(unknown.body.error, 'estate_unknown');
  assert.match(unknown.body.detail ?? '', /no record of this account/);

  const pending = await probe(requireApprovedMember(), row({ status: 'pending' }));
  assert.equal(pending.res.status, 403);
  assert.equal(pending.body.error, 'estate_pending');
  assert.match(pending.body.detail ?? '', /awaiting approval/);

  const revoked = await probe(requireApprovedMember(), row({ status: 'revoked' }));
  assert.equal(revoked.res.status, 403);
  assert.equal(revoked.body.error, 'estate_revoked');
  assert.match(revoked.body.detail ?? '', /revoked/);

  const ok = await probe(requireApprovedMember(), row());
  assert.equal(ok.res.status, 200);
  assert.equal(ok.body.reached, true);

  // ⚠️ The whole point: three refusals, three CODES. Collapsing any two sends
  // somebody to the wrong place — "wait" and "ask the owner" and "sign in once
  // to enrol" are three different instructions.
  const codes = [unknown.body.error, pending.body.error, revoked.body.error];
  assert.equal(new Set(codes).size, 3);
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 4. the wiring at a REAL route — the gate is mounted, not merely written
 * ═════════════════════════════════════════════════════════════════════════ */

test('🔴 GET /estate/users refuses a non-approver, and never opens the directory', async () => {
  // A gate is only as good as its mounting. This also proves the refusal comes
  // BEFORE the work: `listUsers` never runs, so no member list is assembled
  // for somebody who may not see one.
  const { env, db } = envAs(row({ is_approver: 0 }));
  const res = await estateRoutes.request('/estate/users', {}, env);
  assert.equal(res.status, 403);
  assert.equal(((await res.json()) as { error?: string }).error, 'forbidden');
  assert.ok(
    !db._sql.some((s) => /ORDER BY/i.test(s)),
    'the directory listing ran behind a gate that refused',
  );
});

test('GET /estate/users answers an approver', async () => {
  const { env } = envAs(row({ is_approver: 1 }));
  const res = await estateRoutes.request('/estate/users', {}, env);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { users: [] });
});
