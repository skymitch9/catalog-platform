/**
 * The shadow receiver's iron rules (gate-shadow.ts): 204 ALWAYS, inert when
 * off, nothing verifiable drops a line, the full future gate is what gets
 * logged, and the rate limit sheds quietly.
 *
 * Log lines are captured by patching console.log/console.warn — the tail IS
 * the receiver's only output, so the tests read what the tail would.
 */

import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import app from '../src/index.js';
import {
  ACTION_GATES,
  GATE_REPORTS_PER_MINUTE,
  gateDecision,
  resetGateLimiter,
} from '../src/gate-shadow.js';
import { resetEstateCache } from '../src/estate-status.js';
import { resetRoleCache } from '../src/roles.js';
import type { Env } from '../src/env.js';

/* ── key + env + fetch stubs (the me.test.ts idiom) ─────────────────────── */

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

function envWith(over: Partial<Env> = {}): Env {
  return {
    ENVIRONMENT: 'development',
    DEV_EMAIL: 'mod@example.com',
    FIREBASE_PROJECT_ID: 'audiobook-catalog',
    OWNER_EMAILS: 'owner@example.com',
    FIREBASE_SERVICE_ACCOUNT: SA_JSON,
    ESTATE_AUTH_URL: 'https://auth.example',
    ESTATE_APP_TOKEN_AUDIOBOOK: 'ab-token',
    ESTATE_CHECK: 'shadow',
    ...over,
  };
}

interface Script {
  storedRole?: string | null;
  seenStatus?: string;
  /** clubs{,_dev}/{id} managerUids (stringValues); undefined → club 404s. */
  managerUids?: string[];
}

function stubFetch(script: Script) {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    if (url.includes('oauth2.googleapis.com/token')) {
      return Response.json({ access_token: 'stub-access-token', expires_in: 3600 });
    }
    if (url.includes('/api/estate/seen')) {
      if (script.seenStatus === undefined) return new Response('boom', { status: 500 });
      return Response.json({ status: script.seenStatus, visibility: ['audiobook'] });
    }
    if (url.includes('firestore.googleapis.com')) {
      if (url.includes('/site_roles/')) {
        const role = script.storedRole === undefined ? null : script.storedRole;
        if (role === null) return new Response('', { status: 404 });
        return Response.json({ name: 'x/site_roles/dev-uid', fields: { role: { stringValue: role } } });
      }
      if (url.includes('/clubs')) {
        if (script.managerUids === undefined) return new Response('', { status: 404 });
        return Response.json({
          name: 'x/clubs/c1',
          fields: { managerUids: { arrayValue: { values: script.managerUids.map((u) => ({ stringValue: u })) } } },
        });
      }
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;
  return { calls, restore: () => void (globalThis.fetch = original) };
}

/** Capture the JSON lines the receiver logs. */
function captureLogs() {
  const origLog = console.log;
  const origWarn = console.warn;
  const origError = console.error;
  const lines: Array<Record<string, unknown>> = [];
  const collect = (...args: unknown[]) => {
    if (typeof args[0] === 'string') {
      try {
        lines.push(JSON.parse(args[0]) as Record<string, unknown>);
      } catch {
        /* not a JSON line — not ours */
      }
    }
  };
  console.log = collect as typeof console.log;
  console.warn = collect as typeof console.warn;
  console.error = collect as typeof console.error;
  return {
    lines,
    gateLines: () => lines.filter((l) => l['tag'] === 'ab_gate_shadow'),
    restore: () => {
      console.log = origLog;
      console.warn = origWarn;
      console.error = origError;
    },
  };
}

function post(env: Env, body: unknown): Promise<Response> {
  return Promise.resolve(
    app.request(
    '/api/gate/shadow',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
      },
      env,
    ),
  );
}

beforeEach(() => {
  resetGateLimiter();
  resetEstateCache();
  resetRoleCache();
});

/* ── gateDecision, pure ────────────────────────────────────────────────── */

test('gateDecision: unknown action → would_deny null, LOGGED not guessed', () => {
  assert.deepEqual(
    gateDecision({ action: 'not.a.thing', tokened: true, role: 'admin', estateStatus: 'approved', clubManager: false }),
    { wouldDeny: null, reason: 'unknown_action' },
  );
});

test('gateDecision: tokenless is a deny for every gated action (measurement #2)', () => {
  for (const action of Object.keys(ACTION_GATES)) {
    const v = gateDecision({ action, tokened: false, role: 'guest', estateStatus: null, clubManager: false });
    assert.deepEqual(v, { wouldDeny: true, reason: 'no_live_session' }, action);
  }
});

test('gateDecision: review.submit needs only a live session (the Phase 5 measure)', () => {
  assert.deepEqual(
    gateDecision({ action: 'review.submit', tokened: true, role: 'guest', estateStatus: null, clubManager: false }),
    { wouldDeny: false, reason: null },
  );
});

test('gateDecision: the content-note split — self is a member floor, mod is not', () => {
  // The 2026-08-17 split (soak blocker 3): one action could not describe both
  // halves of the surface, and a moderator floor on a SELF delete denies every
  // ordinary member removing their own note. A plain member passes selfDelete…
  assert.deepEqual(
    gateDecision({ action: 'warning.selfDelete', tokened: true, role: 'member', estateStatus: 'approved', clubManager: false }),
    { wouldDeny: false, reason: null },
  );
  // …and is refused modDelete, which stays moderator+.
  assert.deepEqual(
    gateDecision({ action: 'warning.modDelete', tokened: true, role: 'member', estateStatus: 'approved', clubManager: false }),
    { wouldDeny: true, reason: 'lacks_operateClub' },
  );
  assert.equal(
    gateDecision({ action: 'warning.modDelete', tokened: true, role: 'moderator', estateStatus: 'approved', clubManager: false }).wouldDeny,
    false,
  );
  // Content notes are site-wide, so the club island never confers modDelete.
  assert.equal(
    gateDecision({ action: 'warning.modDelete', tokened: true, role: 'member', estateStatus: 'approved', clubManager: true }).wouldDeny,
    true,
  );
});

test('gateDecision: estate revoked refuses even a standing admin role — the incident, killed', () => {
  const v = gateDecision({ action: 'review.delete', tokened: true, role: 'admin', estateStatus: 'revoked', clubManager: false });
  assert.deepEqual(v, { wouldDeny: true, reason: 'estate_revoked' });
  // …but never the owner break-glass.
  const o = gateDecision({ action: 'review.delete', tokened: true, role: 'owner', estateStatus: 'revoked', clubManager: false });
  assert.deepEqual(o, { wouldDeny: false, reason: null });
});

test('gateDecision: the ladder floors — moderator operates, only admin manages', () => {
  assert.equal(gateDecision({ action: 'club.setSchedule', tokened: true, role: 'moderator', estateStatus: 'approved', clubManager: false }).wouldDeny, false);
  assert.deepEqual(
    gateDecision({ action: 'club.updateStructural', tokened: true, role: 'moderator', estateStatus: 'approved', clubManager: false }),
    { wouldDeny: true, reason: 'lacks_manageClub' },
  );
  assert.equal(gateDecision({ action: 'club.updateStructural', tokened: true, role: 'admin', estateStatus: 'approved', clubManager: false }).wouldDeny, false);
});

test('gateDecision: club managers hold operate+manage on their club', () => {
  assert.equal(gateDecision({ action: 'club.setSchedule', tokened: true, role: 'guest', estateStatus: 'approved', clubManager: true }).wouldDeny, false);
  assert.equal(gateDecision({ action: 'club.delete', tokened: true, role: 'guest', estateStatus: 'approved', clubManager: true }).wouldDeny, false);
});

/* ── the CLUB MANAGER package, 2026-08-17 (owner-approved) ─────────────── */

test('the island runs its own club: a rankless manager sets THIS club’s webhook', () => {
  // The whole point of the flip. A bound manager needs no site-wide rank to
  // administer the club they already run.
  assert.deepEqual(
    gateDecision({ action: 'club.setWebhook', tokened: true, role: 'guest', estateStatus: 'approved', clubManager: true }),
    { wouldDeny: false, reason: null },
  );
  assert.equal(
    gateDecision({ action: 'club.clearWebhook', tokened: true, role: 'guest', estateStatus: 'approved', clubManager: true }).wouldDeny,
    false,
  );
});

test('the island is ONE club wide: a manager of another club is refused here', () => {
  // clubManager:false IS "manager of some other club" as far as this gate is
  // concerned — the roster read is per-club, so the island simply does not
  // reach. Refused with the honest capability name, not a bare status.
  assert.deepEqual(
    gateDecision({ action: 'club.setWebhook', tokened: true, role: 'guest', estateStatus: 'approved', clubManager: false }),
    { wouldDeny: true, reason: 'lacks_administerClub' },
  );
});

test('moderator+ overrides everywhere the island grants — never out-ranked by it', () => {
  for (const action of ['club.setWebhook', 'club.clearWebhook']) {
    assert.equal(
      gateDecision({ action, tokened: true, role: 'moderator', estateStatus: 'approved', clubManager: false }).wouldDeny,
      false,
      action,
    );
  }
  // …and on the roster, which the island never holds.
  assert.equal(
    gateDecision({ action: 'club.claimManager', tokened: true, role: 'moderator', estateStatus: 'approved', clubManager: false, clubClaimed: true }).wouldDeny,
    false,
  );
});

test('claim: a member takes an UNCLAIMED club, and cannot take a managed one', () => {
  // First-come-first-served (enforce-blocker 4 closed: an admin floor here
  // was self-blocking, because claiming is how one BECOMES a manager).
  assert.deepEqual(
    gateDecision({ action: 'club.claimManager', tokened: true, role: 'member', estateStatus: 'approved', clubManager: false, clubClaimed: false }),
    { wouldDeny: false, reason: null },
  );
  // Already someone's — refused, with a reason that says WHICH refusal it is
  // so the soak can tell "already claimed" from "no session".
  assert.deepEqual(
    gateDecision({ action: 'club.claimManager', tokened: true, role: 'member', estateStatus: 'approved', clubManager: false, clubClaimed: true }),
    { wouldDeny: true, reason: 'club_already_claimed' },
  );
});

test('claim: a club’s OWN manager may not add a second manager (peer-escalation)', () => {
  assert.deepEqual(
    gateDecision({ action: 'club.claimManager', tokened: true, role: 'guest', estateStatus: 'approved', clubManager: true, clubClaimed: true }),
    { wouldDeny: true, reason: 'club_already_claimed' },
  );
});

test('claim: a revoked estate account is refused even on an unclaimed club', () => {
  assert.deepEqual(
    gateDecision({ action: 'club.claimManager', tokened: true, role: 'member', estateStatus: 'revoked', clubManager: false, clubClaimed: false }),
    { wouldDeny: true, reason: 'estate_revoked' },
  );
});

test('claim: an unknown club state reads as CLAIMED, never as free for the taking', () => {
  // gateDecision's default when the report named no club (or the roster read
  // failed, which roles.ts answers claimed:true) — the strict direction.
  assert.equal(
    gateDecision({ action: 'club.claimManager', tokened: true, role: 'member', estateStatus: 'approved', clubManager: false }).wouldDeny,
    true,
  );
});

/* ── the route: the three iron rules ───────────────────────────────────── */

test('mode off: 204 and INERT — no processing, no line', async () => {
  const logs = captureLogs();
  const stub = stubFetch({});
  try {
    const res = await post(envWith({ ESTATE_CHECK: 'off' }), { action: 'club.setSchedule', token: 'x' });
    assert.equal(res.status, 204);
    assert.equal(logs.gateLines().length, 0);
    assert.equal(stub.calls.length, 0);
  } finally {
    stub.restore();
    logs.restore();
  }
});

test('a garbage ESTATE_CHECK value reads as off — a typo cannot switch telemetry on', async () => {
  const logs = captureLogs();
  try {
    const res = await post(envWith({ ESTATE_CHECK: 'Shadow ' }), { action: 'club.setSchedule' });
    assert.equal(res.status, 204);
    assert.equal(logs.gateLines().length, 0);
  } finally {
    logs.restore();
  }
});

test('malformed JSON: STILL 204, and still a line — shadow data is never droppable', async () => {
  const logs = captureLogs();
  try {
    const res = await post(envWith(), 'not json{');
    assert.equal(res.status, 204);
    const [line] = logs.gateLines();
    assert.ok(line, 'a malformed report still logs');
    assert.equal(line['action'], null);
    assert.equal(line['would_deny'], null);
    assert.equal(line['reason'], 'malformed_report');
  } finally {
    logs.restore();
  }
});

test('tokenless report on a gated action: 204 + would_deny:true (measurement #2)', async () => {
  const logs = captureLogs();
  try {
    const res = await post(envWith({ ENVIRONMENT: 'production', DEV_EMAIL: undefined }), {
      action: 'club.setSchedule',
      lane: 'dev',
    });
    assert.equal(res.status, 204);
    const [line] = logs.gateLines();
    assert.equal(line?.['tokened'], false);
    assert.equal(line?.['email'], null);
    assert.equal(line?.['lane'], 'dev');
    assert.equal(line?.['would_deny'], true);
    assert.equal(line?.['reason'], 'no_live_session');
  } finally {
    logs.restore();
  }
});

test('tokened moderator, schedule action: the full gate runs and logs the §4 line', async () => {
  const logs = captureLogs();
  const stub = stubFetch({ storedRole: 'moderator', seenStatus: 'approved' });
  try {
    const res = await post(envWith(), { action: 'club.setSchedule', lane: 'prod', token: 'stub' });
    assert.equal(res.status, 204);
    const [line] = logs.gateLines();
    assert.equal(line?.['tokened'], true);
    assert.equal(line?.['email'], 'mod@example.com');
    assert.equal(line?.['ladder_role'], 'moderator');
    assert.equal(line?.['estate'], 'approved');
    assert.equal(line?.['would_deny'], false);
    assert.equal(line?.['reason'], null);
  } finally {
    stub.restore();
    logs.restore();
  }
});

test('tokened guest attempting review.delete: would_deny with the capability named', async () => {
  const logs = captureLogs();
  const stub = stubFetch({ storedRole: null, seenStatus: 'approved' });
  try {
    await post(envWith(), { action: 'review.delete', token: 'stub' });
    const [line] = logs.gateLines();
    assert.equal(line?.['ladder_role'], 'guest');
    assert.equal(line?.['would_deny'], true);
    assert.equal(line?.['reason'], 'lacks_removeAnyReview');
  } finally {
    stub.restore();
    logs.restore();
  }
});

test('club manager without ladder rank: allowed on their club via managerUids, lane-suffixed', async () => {
  const logs = captureLogs();
  const stub = stubFetch({ storedRole: null, seenStatus: 'approved', managerUids: ['dev-uid'] });
  try {
    await post(envWith(), { action: 'club.setSchedule', lane: 'dev', clubId: 'c1', token: 'stub' });
    const [line] = logs.gateLines();
    assert.equal(line?.['club_manager'], true);
    assert.equal(line?.['club'], 'c1');
    assert.equal(line?.['would_deny'], false);
    // The club doc was read from the DEV lane collection the report named.
    assert.ok(stub.calls.some((c) => c.includes('/clubs_dev/c1')));
  } finally {
    stub.restore();
    logs.restore();
  }
});

test('service account unset: the gate is honestly NOT evaluated (would_deny null)', async () => {
  const logs = captureLogs();
  const stub = stubFetch({ seenStatus: 'approved' });
  try {
    const res = await post(envWith({ FIREBASE_SERVICE_ACCOUNT: undefined }), { action: 'review.delete', token: 'stub' });
    assert.equal(res.status, 204); // rule 1: never an error the client sees
    const [line] = logs.gateLines();
    assert.equal(line?.['would_deny'], null);
    assert.equal(line?.['reason'], 'service_account_unset');
  } finally {
    stub.restore();
    logs.restore();
  }
});

test('estate unreachable: the line still lands, estate null, gate still evaluated', async () => {
  const logs = captureLogs();
  const stub = stubFetch({ storedRole: 'moderator' }); // /seen answers 500
  try {
    await post(envWith(), { action: 'club.setSchedule', token: 'stub' });
    const [line] = logs.gateLines();
    assert.equal(line?.['estate'], null);
    assert.equal(line?.['ladder_role'], 'moderator');
    assert.equal(line?.['would_deny'], false);
  } finally {
    stub.restore();
    logs.restore();
  }
});

test('the rate limit sheds QUIETLY: 204 either way, one shed line, processing capped', async () => {
  const logs = captureLogs();
  try {
    const env = envWith({ ENVIRONMENT: 'production', DEV_EMAIL: undefined });
    for (let i = 0; i < GATE_REPORTS_PER_MINUTE + 5; i++) {
      const res = await post(env, { action: 'club.setSchedule' });
      assert.equal(res.status, 204);
    }
    assert.equal(logs.gateLines().length, GATE_REPORTS_PER_MINUTE);
    assert.equal(logs.lines.filter((l) => l['tag'] === 'ab_gate_shadow_shed').length, 1);
  } finally {
    logs.restore();
  }
});
