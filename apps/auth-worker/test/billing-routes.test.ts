/**
 * billing-routes.test.ts — the four doors, exercised against the REAL exported
 * `billingRoutes` (not a reconstruction) with a small in-memory D1.
 *
 * ⚠️ MOST OF THIS FILE IS ABOUT REFUSALS, and that is the point. A write door
 * onto a table that decides what may spend money has exactly two ways to fail
 * badly: it accepts a rule the owner did not mean (a typo'd feature id is a
 * switch he believes he pressed and did not), or it accepts one that locks the
 * owner out of his own estate. Both are tested here; the happy path is one
 * test.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { billingRoutes } from '../src/billing.js';

// ---------------------------------------------------------------------------
// ⚠️ THE SAME WORKERS-RUNTIME SHIM test/estate-docs.test.ts carries, and for
// the same reason: `crypto.subtle.timingSafeEqual` is a Cloudflare EXTENSION to
// WebCrypto. It does not exist in Node, so `tokenMatches()` throws a TypeError
// under `node --test` and Hono turns that into a bare 500 — every system-door
// assertion below would then pass or fail for a reason that has nothing to do
// with the door. This restores the FUNCTION, not the guarantee (it is
// deliberately not constant-time; a test process has no attacker). If the
// system-door tests ever start 500ing, this comment is the answer.
// ---------------------------------------------------------------------------
const webcrypto = (globalThis as unknown as { crypto: Crypto }).crypto;
if (typeof (webcrypto.subtle as { timingSafeEqual?: unknown }).timingSafeEqual !== 'function') {
  (webcrypto.subtle as unknown as Record<string, unknown>).timingSafeEqual = (
    a: ArrayBufferView,
    b: ArrayBufferView,
  ): boolean => {
    const x = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
    const y = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
    if (x.byteLength !== y.byteLength) return false;
    let diff = 0;
    for (let i = 0; i < x.byteLength; i += 1) diff |= (x[i] as number) ^ (y[i] as number);
    return diff === 0;
  };
}

const OWNER = 'owner@example.com';
const APPROVER = 'approver@example.com';

interface Row {
  id: number;
  feature: string;
  site: string;
  principal_kind: string;
  principal_value: string | null;
  allow: number;
  why: string;
  updated_by: string;
  updated_at: string;
}

/**
 * A D1 fake that understands exactly the four statements this feature issues.
 * ⚠️ It enforces the UNIQUE key the way `ux_billing_policy` does — including
 * the `IFNULL(principal_value, '')` term — because a fake that let two
 * contradictory `everyone` rules coexist would hide the one bug the index
 * exists to prevent.
 */
class FakeDB {
  rules: Row[] = [];
  // The owner is seeded so `requireApprover()` finds a row rather than having
  // to materialize one — the break-glass bootstrap is estate-db's test, not
  // this file's.
  users = new Map<number, { id: number; email: string; status: string; is_approver: number }>([
    [1, { id: 1, email: OWNER, status: 'approved', is_approver: 1 }],
  ]);
  nextId = 1;

  prepare(sql: string) {
    const db = this;
    let args: unknown[] = [];
    const stmt = {
      bind(...a: unknown[]) {
        args = a;
        return stmt;
      },
      async all() {
        if (/FROM billing_policy/.test(sql)) return { results: [...db.rules] };
        return { results: [] };
      },
      async first() {
        if (/FROM estate_user WHERE id/.test(sql)) {
          return db.users.get(Number(args[0])) ?? null;
        }
        if (/FROM estate_user WHERE email/.test(sql)) {
          return [...db.users.values()].find((u) => u.email === args[0]) ?? null;
        }
        if (/INSERT INTO billing_policy/.test(sql)) {
          const [feature, site, kind, value, allow, why, by, at] = args as [
            string, string, string, string | null, number, string, string, string,
          ];
          const key = `${feature}|${site}|${kind}|${value ?? ''}`;
          const existing = db.rules.find(
            (r) => `${r.feature}|${r.site}|${r.principal_kind}|${r.principal_value ?? ''}` === key,
          );
          if (existing) {
            Object.assign(existing, { allow, why, updated_by: by, updated_at: at });
            return { ...existing };
          }
          const row: Row = {
            id: db.nextId++,
            feature,
            site,
            principal_kind: kind,
            principal_value: value,
            allow,
            why,
            updated_by: by,
            updated_at: at,
          };
          db.rules.push(row);
          return { ...row };
        }
        if (/DELETE FROM billing_policy/.test(sql)) {
          const i = db.rules.findIndex((r) => r.id === Number(args[0]));
          if (i < 0) return null;
          return db.rules.splice(i, 1)[0]!;
        }
        return null;
      },
      async run() {
        return { success: true };
      },
    };
    return stmt;
  }
  async batch() {
    return [];
  }
}

function env(db: FakeDB, over: Record<string, unknown> = {}) {
  return {
    DB: db as unknown as D1Database,
    OWNER_EMAILS: OWNER,
    // The dev-bypass identity — only honoured when ENVIRONMENT === 'development'
    // (the affirmative check the canonical verifier insists on).
    ENVIRONMENT: 'development',
    DEV_EMAIL: OWNER,
    ESTATE_APP_TOKEN_GAMES: 'games-token',
    ESTATE_APP_TOKEN_INDEX: 'index-token',
    ...over,
  };
}

async function post(db: FakeDB, body: unknown, over: Record<string, unknown> = {}) {
  return billingRoutes.request(
    '/estate/billing/rules',
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
    env(db, over),
  );
}

// ---------------------------------------------------------------------------
// The system door
// ---------------------------------------------------------------------------

test('the system door: no app token set at all is a 503 that NAMES the fix', async () => {
  // A missing secret is a configuration error, not an auth failure. Saying
  // which is the difference between "rotate the token" and "set the token".
  const db = new FakeDB();
  const res = await billingRoutes.request('/estate/billing/policy', {}, {
    DB: db as unknown as D1Database,
  });
  assert.equal(res.status, 503);
  const body = (await res.json()) as any;
  assert.equal(body.error, 'app_tokens_unset');
  assert.match(body.fix, /wrangler secret put/);
});

test('the system door: a wrong bearer is 401, and a right one gets its own site’s answer', async () => {
  const db = new FakeDB();
  db.rules.push({
    id: 1,
    feature: 'sweep.details',
    site: 'games',
    principal_kind: 'system',
    principal_value: null,
    allow: 0,
    why: 'the hourly sweep is costing too much this week',
    updated_by: OWNER,
    updated_at: '2026-09-02T00:00:00.000Z',
  });

  const bad = await billingRoutes.request(
    '/estate/billing/policy',
    { headers: { authorization: 'Bearer nope' } },
    env(db),
  );
  assert.equal(bad.status, 401);

  const res = await billingRoutes.request(
    '/estate/billing/policy',
    { headers: { authorization: 'Bearer games-token' } },
    env(db),
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as any;
  assert.equal(body.site, 'games');
  assert.deepEqual(body.system_denied, ['sweep.details']);
  // The ten-minute delay travels on the wire so a cron's own log can say how
  // stale its copy may be.
  assert.equal(body.cache_seconds, 600);

  // ⚠️ The INDEX app is the ESTATE site, not a catalog — its money path (E6,
  // the apex shelf scanner) is an estate path. A games rule must not reach it.
  const idx = await billingRoutes.request(
    '/estate/billing/policy',
    { headers: { authorization: 'Bearer index-token' } },
    env(db),
  );
  const idxBody = (await idx.json()) as any;
  assert.equal(idxBody.site, 'estate');
  assert.deepEqual(idxBody.system_denied, []);
});

// ---------------------------------------------------------------------------
// The approver gate
// ---------------------------------------------------------------------------

test('⚠️ read access follows write access — an unauthenticated caller gets neither', async () => {
  // §9 Q6: the list of who has been switched off is a fact about people, so
  // the GET is approver-gated exactly like the POST.
  const db = new FakeDB();
  for (const [path, init] of [
    ['/estate/billing/rules', {}],
    ['/estate/billing/rules', { method: 'POST', body: '{}' }],
    ['/estate/billing/rules/1', { method: 'DELETE' }],
  ] as const) {
    const res = await billingRoutes.request(path, init, {
      DB: db as unknown as D1Database,
      OWNER_EMAILS: OWNER,
      ENVIRONMENT: 'production',
      FIREBASE_PROJECT_ID: 'audiobook-catalog',
    });
    assert.equal(res.status, 401, `${path} should refuse an anonymous caller`);
  }
});

test('the read hands the page the registry AND the rules — the page never builds its own', async () => {
  // A second copy of the feature list in the browser is the `research.cover`
  // drift again, one layer up.
  const db = new FakeDB();
  const res = await billingRoutes.request('/estate/billing/rules', {}, env(db));
  assert.equal(res.status, 200);
  const body = (await res.json()) as any;
  assert.equal(body.features.length, 18);
  assert.deepEqual(body.sites, ['library', 'library2', 'games', 'audiobook', 'estate']);
  assert.equal(body.groups.length, 5);
  assert.deepEqual(body.rules, []);
  assert.deepEqual(body.unknown, []);
  // ⚠️ The page must SAY the delay, or the owner presses the switch twice.
  assert.match(body.effect_delay_note, /10 minutes/);
});

// ---------------------------------------------------------------------------
// The write door's refusals
// ---------------------------------------------------------------------------

test('⚠️ a typo’d feature id is REFUSED AT THE DOOR, not stored and ignored', async () => {
  // Storing it would mean the owner believes he pressed a switch that does
  // nothing — the exact silent failure §3.2 is written about.
  const db = new FakeDB();
  const res = await post(db, {
    feature: 'research.cover',
    site: 'library',
    principal_kind: 'everyone',
    allow: false,
    why: 'trying to switch cover search off',
  });
  assert.equal(res.status, 400);
  const body = (await res.json()) as any;
  assert.equal(body.error, 'unknown_feature');
  assert.match(body.detail, /research\.cover/);
  assert.equal(db.rules.length, 0);
});

test('an unknown site is refused, and the refusal NAMES the sites that exist', async () => {
  const db = new FakeDB();
  const res = await post(db, {
    feature: 'scan.photo',
    site: 'ebooks', // a catalog, not a billing site
    principal_kind: 'everyone',
    allow: false,
    why: 'confusing the catalog vocabulary with the billing one',
  });
  assert.equal(res.status, 400);
  const body = (await res.json()) as any;
  assert.equal(body.error, 'unknown_site');
  assert.match(body.detail, /library, library2, games, audiobook, estate/);
});

test('⚠️ `why` is required, and whitespace does not satisfy it', async () => {
  // The column is NOT NULL, but `' '` satisfies a NOT NULL and answers nothing.
  // Six months from now this column is the only cheap answer to "why does
  // cover search not work on padhard?"; without it the answer is a bisect.
  const db = new FakeDB();
  for (const why of ['', '   ', 'x']) {
    const res = await post(db, {
      feature: 'research.covers',
      site: 'library',
      principal_kind: 'everyone',
      allow: false,
      why,
    });
    assert.equal(res.status, 400, `why=${JSON.stringify(why)} should be refused`);
  }
  assert.equal(db.rules.length, 0);
});

test('principal coherence: everyone/system name nobody, role/user need a value', async () => {
  const db = new FakeDB();
  const bad = [
    { principal_kind: 'everyone', principal_value: 'moderator' },
    { principal_kind: 'system', principal_value: '7' },
    { principal_kind: 'role', principal_value: null },
    { principal_kind: 'user', principal_value: null },
  ];
  for (const over of bad) {
    const res = await post(db, {
      feature: 'scan.photo',
      site: 'games',
      allow: false,
      why: 'a considered reason',
      ...over,
    });
    assert.equal(res.status, 400, JSON.stringify(over));
    const body = (await res.json()) as any;
    assert.ok(body.detail.length > 10, 'every refusal explains itself');
  }
  assert.equal(db.rules.length, 0);
});

test('🔴 THE OWNER CANNOT BE SWITCHED OFF — the break-glass is not narrowable into a lockout', async () => {
  // §7.2 says the owner's row draws every control disabled. That is a UI rule,
  // and a UI rule is one fetch away from being bypassed. This is the one that
  // actually holds.
  const db = new FakeDB();
  db.users.set(2, { id: 2, email: APPROVER, status: 'approved', is_approver: 0 });

  const res = await post(db, {
    feature: 'scan.photo',
    site: 'estate',
    principal_kind: 'user',
    principal_value: '1',
    allow: false,
    why: 'testing whether the owner can lock himself out',
  });
  assert.equal(res.status, 409);
  const body = (await res.json()) as any;
  assert.equal(body.error, 'owner_not_deniable');
  assert.match(body.detail, /break-glass/);
  assert.equal(db.rules.length, 0);

  // ⚠️ An ALLOW row naming the owner is fine — it grants nothing (policy can
  // only deny) and refusing it would be theatre.
  const ok = await post(db, {
    feature: 'scan.photo',
    site: 'estate',
    principal_kind: 'user',
    principal_value: '1',
    allow: true,
    why: 'explicitly on, for the record',
  });
  assert.equal(ok.status, 200);

  // Anybody else can be denied.
  const other = await post(db, {
    feature: 'scan.photo',
    site: 'estate',
    principal_kind: 'user',
    principal_value: '2',
    allow: false,
    why: 'scans a hundred shelves a day',
  });
  assert.equal(other.status, 200);
});

test('a user rule naming nobody in the directory is a 404, not a stored ghost', async () => {
  const db = new FakeDB();
  const res = await post(db, {
    feature: 'gabi.chat',
    site: 'estate',
    principal_kind: 'user',
    principal_value: '99',
    allow: false,
    why: 'a person who does not exist',
  });
  assert.equal(res.status, 404);
  assert.equal(db.rules.length, 0);
});

// ---------------------------------------------------------------------------
// The happy path, and removal
// ---------------------------------------------------------------------------

test('switch off, switch back on, then remove — and “no rule” is indistinguishable from never', async () => {
  const db = new FakeDB();
  const off = await post(db, {
    feature: 'research.covers',
    site: 'library',
    principal_kind: 'everyone',
    allow: false,
    why: 'six cents a cover and the free rungs are doing fine',
  });
  assert.equal(off.status, 200);
  const created = ((await off.json()) as any).rule;
  assert.equal(created.allow, false, 'the API speaks booleans, not 0/1');
  assert.equal(created.updated_by, OWNER, 'every write is stamped');
  assert.equal(db.rules.length, 1);

  // The same cell again UPSERTS — one rule per cell, never a second row that
  // contradicts the first.
  const on = await post(db, {
    feature: 'research.covers',
    site: 'library',
    principal_kind: 'everyone',
    allow: true,
    why: 'back on for the holidays',
  });
  assert.equal(on.status, 200);
  assert.equal(db.rules.length, 1, 'upserted, not duplicated');
  assert.equal(db.rules[0]!.allow, 1);

  const del = await billingRoutes.request(
    `/estate/billing/rules/${created.id}`,
    { method: 'DELETE' },
    env(db),
  );
  assert.equal(del.status, 200);
  assert.equal(db.rules.length, 0, 'removed, not tombstoned — "no rule" IS the default state');

  const gone = await billingRoutes.request(
    `/estate/billing/rules/${created.id}`,
    { method: 'DELETE' },
    env(db),
  );
  assert.equal(gone.status, 404);
});

test('a rule that has drifted out of the registry is REPORTED on the read, never enforced', async () => {
  const db = new FakeDB();
  db.rules.push({
    id: 1,
    feature: 'research.cover',
    site: 'library',
    principal_kind: 'everyone',
    principal_value: null,
    allow: 0,
    why: 'a typo that got in before the door check existed',
    updated_by: OWNER,
    updated_at: '2026-09-02T00:00:00.000Z',
  });
  const res = await billingRoutes.request('/estate/billing/rules', {}, env(db));
  const body = (await res.json()) as any;
  assert.equal(body.unknown.length, 1);
  assert.equal(body.unknown[0].feature, 'research.cover');
  // Still listed among the rules, because it IS in the table — the page shows
  // both, and deletes nothing behind the owner's back.
  assert.equal(body.rules.length, 1);
});
