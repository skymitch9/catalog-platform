/**
 * billing-gate.test.ts — E6's spending switch, exercised through the REAL
 * route (`POST /api/scan/shelf` on the exported `app`) so the refusal is
 * proved to reach the WIRE and not merely to be constructed.
 *
 * ⚠️ THE THREE ASSERTIONS THAT MATTER, in order of what they protect:
 *
 *   1. `off` — the committed posture — must be a complete no-op. If shipping
 *      this feature changed anybody's behaviour, the whole rollout plan (apply
 *      the migration early, deploy the consumers dark, soak, then flip one
 *      site at a time) was never true.
 *   2. `shadow` must LOG WITH AN OUTCOME and still let the call through. A
 *      shadow line without `proceeded` is the exact instrument that produced
 *      the audiobook soak's *NOT ENOUGH EVIDENCE, do not flip* verdict.
 *   3. An UNKNOWN answer (null, not []) must PROCEED. §3.5 row 3 is a
 *      deliberate fail-open on money, and a test that let it drift closed
 *      would turn an auth outage into "the scanner is broken".
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { app } from '../src/index.js';
import { BILLING_POSTURES, billingPosture } from '../src/billing-gate.js';

const OWNER = 'owner@example.com';
const MEMBER = 'member@example.com';

/** A D1 fake that remembers the one estate_cache row these tests need. */
class FakeDB {
  cache = new Map<string, Record<string, unknown>>();

  prepare(sql: string) {
    const db = this;
    let args: unknown[] = [];
    const stmt = {
      bind(...a: unknown[]) {
        args = a;
        return stmt;
      },
      async first() {
        if (/FROM estate_cache/.test(sql)) return db.cache.get(String(args[0])) ?? null;
        return null;
      },
      async all() {
        return { results: [] };
      },
      async run() {
        if (/INSERT INTO estate_cache/.test(sql)) {
          db.cache.set(String(args[0]), {
            status: args[2],
            checked_at: args[3],
            visibility: args[4],
            billing_denied: args[5],
          });
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

function stubFetch(seenBody: Record<string, unknown>) {
  const original = globalThis.fetch;
  const anthropic: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/api/estate/seen')) {
      return new Response(JSON.stringify(seenBody), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    // ⚠️ The Anthropic call is recorded, not just stubbed — "did the money get
    // spent" is the only question worth asking about a spending switch, and
    // asserting on a status code answers a different one.
    anthropic.push(url);
    return new Response(
      JSON.stringify({
        content: [{ type: 'text', text: '{"books":[],"unreadable":false}' }],
        usage: { input_tokens: 10, output_tokens: 10 },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }) as typeof fetch;
  return { anthropic, restore: () => void (globalThis.fetch = original) };
}

function env(db: FakeDB, posture: string | undefined, who = MEMBER) {
  return {
    DB: db as unknown as D1Database,
    ENVIRONMENT: 'development',
    DEV_EMAIL: who,
    FIREBASE_PROJECT_ID: 'audiobook-catalog',
    OWNER_EMAILS: OWNER,
    ESTATE_AUTH_URL: 'https://auth.example',
    ESTATE_APP_TOKEN_INDEX: 'index-token',
    ANTHROPIC_API_KEY: 'sk-ant-test-key',
    ...(posture === undefined ? {} : { BILLING_POLICY: posture }),
  };
}

const PHOTO = { data: 'aGVsbG8=', mediaType: 'image/jpeg', kind: 'shelf' };

async function scan(db: FakeDB, posture: string | undefined, who = MEMBER) {
  return app.request(
    '/api/scan/shelf',
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(PHOTO) },
    env(db, posture, who),
  );
}

// ---------------------------------------------------------------------------

test('⚠️ the posture coercion: anything unrecognised is `off`, and it is not silent', () => {
  assert.deepEqual([...BILLING_POSTURES], ['off', 'shadow', 'enforce']);
  assert.equal(billingPosture(undefined), 'off', 'an unset var is off');
  assert.equal(billingPosture(''), 'off');
  assert.equal(billingPosture('shadow'), 'shadow');
  assert.equal(billingPosture(' ENFORCE '), 'enforce');
  // A typo must not half-enable a money gate. It falls to off — which BILLS —
  // and warns, so the fail direction is stated rather than discovered.
  assert.equal(billingPosture('enfroce'), 'off');
  assert.equal(billingPosture('on'), 'off');
});

test('🔴 `off` IS A COMPLETE NO-OP — even with the feature denied', async () => {
  // This is the assertion the whole rollout plan rests on. If shipping the
  // consumer dark changed anything for anybody, "migrate early, deploy dark,
  // soak, then flip one site at a time" was never a real plan.
  const db = new FakeDB();
  const f = stubFetch({ status: 'approved', visibility: ['audiobook'], billing_denied: ['scan.photo'] });
  try {
    const res = await scan(db, 'off');
    assert.equal(res.status, 200);
    assert.equal(f.anthropic.length, 1, 'the model was called — off does not gate');
  } finally {
    f.restore();
  }
});

test('⚠️ `shadow` LETS THE CALL THROUGH AND STILL BILLS — it is the soak, not the switch', async () => {
  const db = new FakeDB();
  const f = stubFetch({ status: 'approved', visibility: ['audiobook'], billing_denied: ['scan.photo'] });
  const lines: string[] = [];
  const log = console.log;
  console.log = (...a: unknown[]) => void lines.push(a.map(String).join(' '));
  try {
    const res = await scan(db, 'shadow');
    assert.equal(res.status, 200, 'shadow never refuses');
    assert.equal(f.anthropic.length, 1, 'the call happened and cost money — that is the point of shadow');
  } finally {
    console.log = log;
    f.restore();
  }

  const decision = lines.map((l) => {
    try {
      return JSON.parse(l);
    } catch {
      return null;
    }
  }).find((o) => o && o.evt === 'billing_policy');
  assert.ok(decision, 'a shadow decision line must be emitted, or the soak measures nothing');
  assert.equal(decision.posture, 'shadow');
  assert.equal(decision.feature, 'scan.photo');
  assert.equal(decision.site, 'estate');
  assert.equal(decision.would_deny, true);
  // ⚠️ THE OUTCOME BIT. Without it the tail cannot separate a true regression
  // from the gate agreeing with today's rules — the exact gap that made the
  // audiobook soak unfalsifiable.
  assert.equal(decision.proceeded, true);
  assert.ok(decision.est_cents, 'the line carries what the call cost, or a soak counts events instead of money');
  assert.equal(decision.principal_value, MEMBER);
});

test('`enforce` refuses in WORDS, and the model is never called', async () => {
  const db = new FakeDB();
  const f = stubFetch({ status: 'approved', visibility: ['audiobook'], billing_denied: ['scan.photo'] });
  try {
    const res = await scan(db, 'enforce');
    assert.equal(res.status, 403);
    const body = (await res.json()) as any;
    assert.equal(body.error, 'billing_denied');
    // Never a bare status: what happened, what it needs, how to get it.
    assert.match(body.detail, /switched off for this catalogue/);
    assert.ok(body.needs);
    assert.match(body.how, /10 minutes/);
    // ⚠️ The `why` from the rule must NOT appear — it is the owner's internal
    // note and it may name people (§5).
    assert.ok(!('why' in body));
    assert.equal(f.anthropic.length, 0, 'the refusal must land BEFORE the money is spent');
  } finally {
    f.restore();
  }
});

test('`enforce` with the feature NOT denied proceeds normally', async () => {
  const db = new FakeDB();
  const f = stubFetch({ status: 'approved', visibility: ['audiobook'], billing_denied: ['gabi.chat'] });
  try {
    const res = await scan(db, 'enforce');
    assert.equal(res.status, 200);
    assert.equal(f.anthropic.length, 1);
  } finally {
    f.restore();
  }
});

test('🔴 AN UNKNOWN ANSWER PROCEEDS — null is not [], and the fail direction is ALLOW', async () => {
  // §3.5 row 3, chosen out loud: denying every paid feature when the directory
  // cannot be reached turns an auth outage into "everything is broken", which
  // is the failure the estate's wording rule exists to prevent. An old auth
  // Worker mid-deploy sends no `billing_denied` at all, and that must read as
  // UNKNOWN — never as "nothing is denied" and never as "everything is".
  const db = new FakeDB();
  const f = stubFetch({ status: 'approved', visibility: ['audiobook'] });
  try {
    const res = await scan(db, 'enforce');
    assert.equal(res.status, 200);
    assert.equal(f.anthropic.length, 1);
  } finally {
    f.restore();
  }
});

test('🔴 THE OWNER IS NEVER DENIED, at any posture', async () => {
  // The break-glass cannot be narrowed into a lockout — not by visibility, and
  // not by a spending switch. Enforced in the directory (the write door refuses
  // a deny naming an owner) AND here, because two independent barriers is the
  // estate's standing shape for anything that can lock somebody out.
  const db = new FakeDB();
  const f = stubFetch({ status: 'approved', visibility: ['audiobook'], billing_denied: ['scan.photo'] });
  try {
    const res = await scan(db, 'enforce', OWNER);
    assert.equal(res.status, 200);
    assert.equal(f.anthropic.length, 1);
  } finally {
    f.restore();
  }
});

test('the denial rides in the CACHE, so a second call needs no second /seen', async () => {
  // §4.5's one-answer rule: `billing_denied` is cached WITH status and
  // visibility and ages with them. A cache that dropped it would re-open a
  // switched-off feature for the whole TTL after the first request.
  const db = new FakeDB();
  const f = stubFetch({ status: 'approved', visibility: ['audiobook'], billing_denied: ['scan.photo'] });
  try {
    await scan(db, 'enforce');
    const row = db.cache.get(MEMBER);
    assert.ok(row, 'the answer was cached');
    assert.equal(row.billing_denied, '["scan.photo"]');
    // Second call: served from the cache, and still refused.
    const res = await scan(db, 'enforce');
    assert.equal(res.status, 403);
  } finally {
    f.restore();
  }
});

test('a malformed body still gets ITS OWN 400, never a policy refusal', async () => {
  // A person who fixes their request only to meet a different wall has been
  // told the wrong thing twice.
  const db = new FakeDB();
  const f = stubFetch({ status: 'approved', visibility: ['audiobook'], billing_denied: ['scan.photo'] });
  try {
    const res = await app.request(
      '/api/scan/shelf',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}) },
      env(db, 'enforce'),
    );
    assert.equal(res.status, 400);
    assert.equal((await res.json() as any).error, 'missing_photo');
  } finally {
    f.restore();
  }
});
