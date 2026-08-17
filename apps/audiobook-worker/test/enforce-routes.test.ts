/**
 * Phase 3 wave A routes IN ENFORCE MODE — the full gate (verifier → estate →
 * ladder role → gateDecision) and the Firestore writes each route performs,
 * exercised against an in-memory Firestore REST fake so every mutation is
 * asserted, not reasoned about (the docs each handler must mirror are the
 * clubs.js/club-reads.js/reviews.js write shapes — see enforce-routes.ts).
 *
 * The dormancy half (503, zero network, off/shadow) lives in
 * enforce-dormancy.test.ts; everything here runs with ESTATE_CHECK=enforce.
 */

import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import app from '../src/index.js';
import { toFsFields, type FsValue } from '../src/fs-docs.js';
import { resetEstateCache } from '../src/estate-status.js';
import { resetRoleCache } from '../src/roles.js';
import type { Env } from '../src/env.js';

/* ── env (the gate-shadow.test.ts idiom: dev-bypass identity 'dev-uid') ── */

// A REAL key pair (the me.test.ts idiom): mintAccessToken imports the PEM
// with WebCrypto before its fetch is ever stubbed, so the key must parse.
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
    DEV_EMAIL: 'admin@example.com',
    FIREBASE_PROJECT_ID: 'audiobook-catalog',
    OWNER_EMAILS: 'owner@example.com',
    FIREBASE_SERVICE_ACCOUNT: SA_JSON,
    ESTATE_AUTH_URL: 'https://auth.example',
    ESTATE_APP_TOKEN_AUDIOBOOK: 'ab-token',
    ESTATE_CHECK: 'enforce',
    ...over,
  };
}

/* ── the in-memory Firestore REST fake ─────────────────────────────────── */

interface FakeDoc {
  fields: Record<string, FsValue>;
  version: number;
}

interface Fake {
  docs: Map<string, FakeDoc>;
  calls: string[];
  seenStatus: string;
  restore: () => void;
}

function parseMaskPath(mask: string): string[] {
  const segs: string[] = [];
  let cur = '';
  let inTick = false;
  for (let i = 0; i < mask.length; i += 1) {
    const ch = mask[i];
    if (ch === '\\' && inTick) {
      cur += mask[i + 1] ?? '';
      i += 1;
    } else if (ch === '`') {
      inTick = !inTick;
    } else if (ch === '.' && !inTick) {
      segs.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  segs.push(cur);
  return segs;
}

function getAtPath(fields: Record<string, FsValue>, segs: string[]): FsValue | undefined {
  let node: Record<string, FsValue> | undefined = fields;
  for (let i = 0; i < segs.length - 1; i += 1) {
    const v = node?.[segs[i] as string] as
      | { mapValue?: { fields?: Record<string, FsValue> } }
      | undefined;
    node = v?.mapValue?.fields;
  }
  return node?.[segs[segs.length - 1] as string];
}

function setAtPath(fields: Record<string, FsValue>, segs: string[], value: FsValue | undefined): void {
  let node = fields;
  for (let i = 0; i < segs.length - 1; i += 1) {
    const key = segs[i] as string;
    const existing = node[key] as { mapValue?: { fields?: Record<string, FsValue> } } | undefined;
    if (!existing?.mapValue?.fields) {
      node[key] = { mapValue: { fields: {} } } as FsValue;
    }
    node = (node[key] as { mapValue: { fields: Record<string, FsValue> } }).mapValue.fields;
  }
  const leaf = segs[segs.length - 1] as string;
  if (value === undefined) delete node[leaf];
  else node[leaf] = value;
}

const DOC_ROOT = 'projects/audiobook-catalog/databases/(default)/documents';

function fakeFirestore(seed: Record<string, Record<string, FsValue>> = {}, seenStatus = 'approved'): Fake {
  const original = globalThis.fetch;
  const docs = new Map<string, FakeDoc>();
  for (const [path, fields] of Object.entries(seed)) {
    docs.set(path, { fields, version: 1 });
  }
  const calls: string[] = [];
  let nextVersion = 100;
  let nextId = 1;
  const fake: Fake = { docs, calls, seenStatus, restore: () => void (globalThis.fetch = original) };

  const docResponse = (path: string, doc: FakeDoc) =>
    Response.json({
      name: `${DOC_ROOT}/${path}`,
      fields: doc.fields,
      updateTime: `v${doc.version}`,
    });

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push(`${method} ${url}`);

    if (url.includes('oauth2.googleapis.com/token')) {
      return Response.json({ access_token: 'stub-access-token', expires_in: 3600 });
    }
    if (url.includes('/api/estate/seen')) {
      return Response.json({ status: fake.seenStatus, visibility: ['audiobook'] });
    }
    if (!url.includes('firestore.googleapis.com')) {
      throw new Error(`unexpected fetch: ${url}`);
    }

    const after = url.split('/documents/')[1] ?? '';
    const [rawPath, query = ''] = after.split('?') as [string, string?];
    const path = decodeURIComponent(rawPath);
    const params = new URLSearchParams(query);
    const isCollection = path.split('/').length % 2 === 1;

    if (method === 'GET' && isCollection) {
      const prefix = `${path}/`;
      const documents = [...docs.keys()]
        .filter((k) => k.startsWith(prefix) && !k.slice(prefix.length).includes('/'))
        .map((k) => ({ name: `${DOC_ROOT}/${k}` }));
      return Response.json(documents.length ? { documents } : {});
    }
    if (method === 'GET') {
      const doc = docs.get(path);
      return doc ? docResponse(path, doc) : new Response('', { status: 404 });
    }
    if (method === 'DELETE') {
      docs.delete(path);
      return Response.json({});
    }
    if (method === 'POST' && isCollection) {
      const body = JSON.parse(String(init?.body ?? '{}')) as { fields?: Record<string, FsValue> };
      const id = `gen${nextId++}`;
      docs.set(`${path}/${id}`, { fields: body.fields ?? {}, version: nextVersion++ });
      return Response.json({ name: `${DOC_ROOT}/${path}/${id}` });
    }
    if (method === 'PATCH') {
      const body = JSON.parse(String(init?.body ?? '{}')) as { fields?: Record<string, FsValue> };
      const incoming = body.fields ?? {};
      const existing = docs.get(path);
      const precondition = params.get('currentDocument.updateTime');
      if (precondition && (!existing || `v${existing.version}` !== precondition)) {
        return Response.json({ error: { status: 'FAILED_PRECONDITION' } }, { status: 400 });
      }
      const masks = params.getAll('updateMask.fieldPaths');
      if (masks.length === 0) {
        docs.set(path, { fields: incoming, version: nextVersion++ });
      } else {
        const doc = existing ?? { fields: {}, version: 0 };
        for (const mask of masks) {
          const segs = parseMaskPath(mask);
          setAtPath(doc.fields, segs, getAtPath(incoming, segs));
        }
        doc.version = nextVersion++;
        docs.set(path, doc);
      }
      return docResponse(path, docs.get(path) as FakeDoc);
    }
    throw new Error(`fake firestore: unhandled ${method} ${url}`);
  }) as typeof fetch;

  return fake;
}

/** Capture ab_gate lines (the enforce twin of the soak's ab_gate_shadow). */
function captureGateLines() {
  const orig = console.log;
  const lines: Array<Record<string, unknown>> = [];
  console.log = ((...args: unknown[]) => {
    if (typeof args[0] === 'string') {
      try {
        const parsed = JSON.parse(args[0]) as Record<string, unknown>;
        if (parsed['tag'] === 'ab_gate') lines.push(parsed);
      } catch {
        /* not ours */
      }
    }
  }) as typeof console.log;
  return { lines, restore: () => void (console.log = orig) };
}

function req(
  env: Env,
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  return Promise.resolve(
    app.request(
      path,
      {
        method,
        ...(body !== undefined
          ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
          : {}),
      },
      env,
    ),
  );
}

/** Raw-value readers for store assertions. */
const str = (v: FsValue | undefined): string | null =>
  v && typeof v['stringValue'] === 'string' ? (v['stringValue'] as string) : null;
const strArray = (v: FsValue | undefined): string[] =>
  ((v as { arrayValue?: { values?: Array<{ stringValue?: string }> } } | undefined)?.arrayValue
    ?.values ?? []).map((x) => x.stringValue ?? '');

beforeEach(() => {
  resetEstateCache();
  resetRoleCache();
});

/* ── seeds ─────────────────────────────────────────────────────────────── */

const clubSeed = () =>
  toFsFields({
    name: 'The Club',
    hostDisplayName: 'Host Person',
    hostSlug: 'host person',
    memberSlugs: ['host person', 'alice'],
    invitedSlugs: [],
    memberCount: 2,
    activeSlots: [1, 2],
    joinMode: 'open',
  });

const asAdmin = { 'site_roles/dev-uid': toFsFields({ role: 'admin' }) };
const asModerator = { 'site_roles/dev-uid': toFsFields({ role: 'moderator' }) };

/* ── the gate, end to end ──────────────────────────────────────────────── */

test('enforce: no token (production) → 401 unauthenticated, worded, nothing touched', async () => {
  const fake = fakeFirestore({ 'reviews/r1': toFsFields({ rating: 5 }) });
  try {
    const res = await req(
      envWith({ ENVIRONMENT: 'production', DEV_EMAIL: undefined }),
      'DELETE',
      '/api/reviews/r1',
    );
    assert.equal(res.status, 401);
    const body = (await res.json()) as { error?: string; detail?: string };
    assert.equal(body.error, 'unauthenticated');
    assert.match(body.detail ?? '', /sign in/i);
    assert.ok(fake.docs.has('reviews/r1'), 'the review must survive');
    assert.equal(fake.calls.filter((c) => c.includes('firestore')).length, 0);
  } finally {
    fake.restore();
  }
});

test('enforce: review delete by a mere member → 403 insufficient_role, worded per §1e', async () => {
  const fake = fakeFirestore({
    ...{ 'site_roles/dev-uid': toFsFields({ role: 'member' }) },
    'reviews/r1': toFsFields({ rating: 5 }),
  });
  const logs = captureGateLines();
  try {
    const res = await req(envWith({ DEV_EMAIL: 'member@example.com' }), 'DELETE', '/api/reviews/r1');
    assert.equal(res.status, 403);
    const body = (await res.json()) as { error?: string; needs?: string; detail?: string };
    assert.equal(body.error, 'insufficient_role');
    assert.equal(body.needs, 'removeAnyReview');
    // what it needs + how to get it — never a bare status
    assert.match(body.detail ?? '', /removeAnyReview/);
    assert.match(body.detail ?? '', /admin role/);
    assert.match(body.detail ?? '', /ask the site owner/i);
    assert.ok(fake.docs.has('reviews/r1'));
    assert.equal(logs.lines.length, 1);
    assert.equal(logs.lines[0]?.['denied'], true);
    assert.equal(logs.lines[0]?.['reason'], 'lacks_removeAnyReview');
  } finally {
    logs.restore();
    fake.restore();
  }
});

test('enforce: ESTATE-REVOKED admin is refused — the incident, structurally dead', async () => {
  // The 2026-08-16 incident: revocation left the site_roles admin doc
  // standing and rules kept honouring it. Here the live estate verdict wins
  // even though the role doc still says admin.
  const fake = fakeFirestore({ ...asAdmin, 'reviews/r1': toFsFields({ rating: 1 }) }, 'revoked');
  try {
    const res = await req(envWith(), 'DELETE', '/api/reviews/r1');
    assert.equal(res.status, 403);
    const body = (await res.json()) as { error?: string; detail?: string };
    assert.equal(body.error, 'estate_revoked');
    assert.match(body.detail ?? '', /revoked/);
    assert.match(body.detail ?? '', /re-approve/);
    assert.ok(fake.docs.has('reviews/r1'), 'a revoked admin must not delete');
  } finally {
    fake.restore();
  }
});

test('enforce: admin deletes a review; ab_gate logs the allow; lane=dev hits reviews_dev', async () => {
  const fake = fakeFirestore({
    ...asAdmin,
    'reviews/r1': toFsFields({ rating: 5 }),
    'reviews_dev/r9': toFsFields({ rating: 2 }),
  });
  const logs = captureGateLines();
  try {
    const res = await req(envWith(), 'DELETE', '/api/reviews/r1');
    assert.equal(res.status, 200);
    assert.equal(((await res.json()) as { success?: boolean }).success, true);
    assert.ok(!fake.docs.has('reviews/r1'));
    assert.equal(logs.lines[0]?.['denied'], false);
    assert.equal(logs.lines[0]?.['action'], 'review.delete');
    assert.equal(logs.lines[0]?.['mode'], 'enforce');
    // ⚠️ RETENTION GUARD, the enforce twin of the one in gate-shadow.test.ts:
    // [observability] retains THIS line too, so it carries a pseudonym and a
    // class — never an address. Same reasoning, same prohibition.
    assert.ok(!JSON.stringify(logs.lines[0]).includes('@'), 'no address in a RETAINED line');
    assert.ok(!('email' in (logs.lines[0] ?? {})));
    assert.match(String(logs.lines[0]?.['email_hash']), /^[0-9a-f]{16}$/);

    const dev = await req(envWith(), 'DELETE', '/api/reviews/r9?lane=dev');
    assert.equal(dev.status, 200);
    assert.ok(!fake.docs.has('reviews_dev/r9'), 'lane=dev must hit the _dev twin');
    assert.ok(fake.docs.has('site_roles/dev-uid'), 'site_roles is never written by these routes');
  } finally {
    logs.restore();
    fake.restore();
  }
});

test('enforce: the owner break-glass needs no site_roles doc and survives estate refusal-to-answer', async () => {
  const fake = fakeFirestore({ 'reviews/r1': toFsFields({ rating: 5 }) });
  try {
    const res = await req(envWith({ DEV_EMAIL: 'owner@example.com' }), 'DELETE', '/api/reviews/r1');
    assert.equal(res.status, 200);
    assert.ok(!fake.docs.has('reviews/r1'));
    assert.ok(
      !fake.calls.some((c) => c.includes('site_roles')),
      'owner short-circuits the role read (the /api/me idiom)',
    );
  } finally {
    fake.restore();
  }
});

/* ── club doc: tiered PATCH ────────────────────────────────────────────── */

test('club PATCH: a club MANAGER (ladder guest) updates structural fields on their own club', async () => {
  const fake = fakeFirestore({
    'clubs/c1': {
      ...clubSeed(),
      ...toFsFields({ managerUids: { 'dev-uid': { role: 'host', displayName: 'G', claimedAt: 1 } } }),
    },
  });
  try {
    const res = await req(envWith({ DEV_EMAIL: 'guesty@example.com' }), 'PATCH', '/api/clubs/c1', {
      joinMode: 'application',
      features: { polls: true, notAFeature: true },
      nextMeetingAt: 1234567890,
    });
    assert.equal(res.status, 200);
    const club = fake.docs.get('clubs/c1');
    assert.equal(str(club?.fields['joinMode']), 'application');
    const features = (club?.fields['features'] as { mapValue?: { fields?: Record<string, FsValue> } })
      ?.mapValue?.fields;
    assert.deepEqual(Object.keys(features ?? {}), ['polls'], 'unknown feature keys are dropped');
    assert.equal(str(club?.fields['name']), 'The Club', 'unmasked fields survive');
  } finally {
    fake.restore();
  }
});

test('club PATCH: a site moderator may set the next meeting but NOT structural fields', async () => {
  const fake = fakeFirestore({ ...asModerator, 'clubs/c1': clubSeed() });
  try {
    const ok = await req(envWith({ DEV_EMAIL: 'mod@example.com' }), 'PATCH', '/api/clubs/c1', {
      nextMeetingAt: 999,
      nextMeetingNotes: 'bring snacks',
    });
    assert.equal(ok.status, 200);
    const refused = await req(envWith({ DEV_EMAIL: 'mod@example.com' }), 'PATCH', '/api/clubs/c1', {
      joinMode: 'application',
    });
    assert.equal(refused.status, 403);
    assert.equal(str(fake.docs.get('clubs/c1')?.fields['joinMode']), 'open');
  } finally {
    fake.restore();
  }
});

test('club PATCH: RESTRICTED and member-tier fields are refused at the door, before any gate', async () => {
  const fake = fakeFirestore({ ...asAdmin, 'clubs/c1': clubSeed() });
  try {
    for (const body of [{ managerUids: {} }, { discordWebhookMask: 'x' }, { name: 'Sneaky' }]) {
      const res = await req(envWith(), 'PATCH', '/api/clubs/c1', body);
      assert.equal(res.status, 400, JSON.stringify(body));
    }
    assert.equal(
      fake.calls.filter((c) => c.includes('firestore')).length,
      0,
      'invalid bodies must not touch Firestore at all',
    );
  } finally {
    fake.restore();
  }
});

test('club PATCH validation mirrors updateClubDetails: joinMode enum, notes cap, meeting time', async () => {
  const fake = fakeFirestore({ ...asAdmin, 'clubs/c1': clubSeed() });
  try {
    assert.equal((await req(envWith(), 'PATCH', '/api/clubs/c1', { joinMode: 'secret' })).status, 400);
    assert.equal(
      (await req(envWith(), 'PATCH', '/api/clubs/c1', { nextMeetingNotes: 'x'.repeat(501) })).status,
      400,
    );
    assert.equal(
      (await req(envWith(), 'PATCH', '/api/clubs/c1', { nextMeetingAt: 'tomorrow' })).status,
      400,
    );
    // null CLEARS the meeting, like the client
    const clear = await req(envWith(), 'PATCH', '/api/clubs/c1', { nextMeetingAt: null });
    assert.equal(clear.status, 200);
    assert.ok('nullValue' in (fake.docs.get('clubs/c1')?.fields['nextMeetingAt'] ?? {}));
  } finally {
    fake.restore();
  }
});

test('club DELETE: members swept then the club doc, like clubs.js deleteClub', async () => {
  const fake = fakeFirestore({
    ...asAdmin,
    'clubs/c1': clubSeed(),
    'clubs/c1/members/host person': toFsFields({ displayName: 'Host Person', role: 'host' }),
    'clubs/c1/members/alice': toFsFields({ displayName: 'Alice', role: 'member' }),
  });
  try {
    const res = await req(envWith(), 'DELETE', '/api/clubs/c1');
    assert.equal(res.status, 200);
    assert.ok(!fake.docs.has('clubs/c1'));
    assert.ok(!fake.docs.has('clubs/c1/members/alice'));
    assert.ok(!fake.docs.has('clubs/c1/members/host person'));
  } finally {
    fake.restore();
  }
});

test('club DELETE: missing club → 404 worded', async () => {
  const fake = fakeFirestore(asAdmin);
  try {
    const res = await req(envWith(), 'DELETE', '/api/clubs/nope');
    assert.equal(res.status, 404);
    assert.match(((await res.json()) as { detail?: string }).detail ?? '', /Club not found/);
  } finally {
    fake.restore();
  }
});

/* ── the RESTRICTED tier ───────────────────────────────────────────────── */

test('webhook PUT: the club’s OWN manager sets it, with no site-wide rank at all', async () => {
  // The 2026-08-17 island flip. `guesty@example.com` has no site_roles doc —
  // a rankless guest — and is bound to THIS club's roster.
  const fake = fakeFirestore({
    'clubs/c1': {
      ...clubSeed(),
      ...toFsFields({ managerUids: { 'dev-uid': { role: 'host', displayName: 'G', claimedAt: 1 } } }),
    },
  });
  try {
    const url = 'https://discord.com/api/webhooks/123/abc-DEF_ghi';
    const res = await req(envWith({ DEV_EMAIL: 'guesty@example.com' }), 'PUT', '/api/clubs/c1/webhook', { url });
    assert.equal(res.status, 200);
    assert.equal(str(fake.docs.get('clubs/c1/settings/discord')?.fields['webhookUrl']), url);
    assert.equal(str(fake.docs.get('clubs/c1')?.fields['discordWebhookMask']), '…_ghi');
  } finally {
    fake.restore();
  }
});

test('webhook PUT: a manager of ANOTHER club is refused — the island is one club wide', async () => {
  // Bound on c2, reaching for c1. The roster read is per-club, so the island
  // simply does not extend; the refusal names the capability, not a status.
  const fake = fakeFirestore({
    'clubs/c1': clubSeed(),
    'clubs/c2': {
      ...clubSeed(),
      ...toFsFields({ managerUids: { 'dev-uid': { role: 'host', displayName: 'G', claimedAt: 1 } } }),
    },
  });
  try {
    const res = await req(envWith({ DEV_EMAIL: 'guesty@example.com' }), 'PUT', '/api/clubs/c1/webhook', {
      url: 'https://discord.com/api/webhooks/123/abc-DEF_ghi',
    });
    assert.equal(res.status, 403);
    const body = (await res.json()) as { needs?: string; detail?: string };
    assert.equal(body.needs, 'administerClub');
    assert.match(body.detail ?? '', /moderator/, 'says which role holds it');
    assert.ok(!fake.docs.has('clubs/c1/settings/discord'));
  } finally {
    fake.restore();
  }
});

test('webhook PUT: a site moderator overrides on a club they do not manage', async () => {
  const fake = fakeFirestore({
    ...asModerator,
    'clubs/c1': {
      ...clubSeed(),
      ...toFsFields({ managerUids: { 'someone-else': { role: 'host', displayName: 'X', claimedAt: 1 } } }),
    },
  });
  try {
    const res = await req(envWith({ DEV_EMAIL: 'mod@example.com' }), 'PUT', '/api/clubs/c1/webhook', {
      url: 'https://discord.com/api/webhooks/123/abc-DEF_ghi',
    });
    assert.equal(res.status, 200);
    assert.ok(fake.docs.has('clubs/c1/settings/discord'));
  } finally {
    fake.restore();
  }
});

test('webhook PUT: admin sets it — full URL to the unreadable subdoc, only the MASK on the club', async () => {
  const fake = fakeFirestore({ ...asAdmin, 'clubs/c1': clubSeed() });
  try {
    const url = 'https://discord.com/api/webhooks/123/abc-DEF_ghi';
    const res = await req(envWith(), 'PUT', '/api/clubs/c1/webhook', { url, displayName: 'Admin A' });
    assert.equal(res.status, 200);
    const settings = fake.docs.get('clubs/c1/settings/discord');
    assert.equal(str(settings?.fields['webhookUrl']), url);
    assert.equal(str(settings?.fields['updatedBy']), 'Admin A');
    assert.equal(str(fake.docs.get('clubs/c1')?.fields['discordWebhookMask']), '…_ghi');
    const body = (await res.json()) as Record<string, unknown>;
    assert.ok(!JSON.stringify(body).includes(url), 'the URL must never return to a browser');
  } finally {
    fake.restore();
  }
});

test('webhook PUT: a non-Discord URL is refused before any gate or write', async () => {
  const fake = fakeFirestore({ ...asAdmin, 'clubs/c1': clubSeed() });
  try {
    const res = await req(envWith(), 'PUT', '/api/clubs/c1/webhook', { url: 'https://evil.example/x' });
    assert.equal(res.status, 400);
    assert.equal(fake.calls.filter((c) => c.includes('firestore')).length, 0);
  } finally {
    fake.restore();
  }
});

test('webhook DELETE: subdoc gone, mask blanked — clubs.js clearClubDiscordWebhook', async () => {
  const fake = fakeFirestore({
    ...asAdmin,
    'clubs/c1': { ...clubSeed(), ...toFsFields({ discordWebhookMask: '…_ghi' }) },
    'clubs/c1/settings/discord': toFsFields({ webhookUrl: 'https://discord.com/api/webhooks/1/a' }),
  });
  try {
    const res = await req(envWith(), 'DELETE', '/api/clubs/c1/webhook');
    assert.equal(res.status, 200);
    assert.ok(!fake.docs.has('clubs/c1/settings/discord'));
    assert.equal(str(fake.docs.get('clubs/c1')?.fields['discordWebhookMask']), '');
  } finally {
    fake.restore();
  }
});

test('claim: admin stamps their OWN uid as {role, displayName, claimedAt}; guests are refused', async () => {
  const fake = fakeFirestore({ ...asAdmin, 'clubs/c1': clubSeed() });
  try {
    const res = await req(envWith(), 'POST', '/api/clubs/c1/managers/claim', {
      role: 'moderator',
      displayName: 'Admin A',
    });
    assert.equal(res.status, 200);
    const managers = (fake.docs.get('clubs/c1')?.fields['managerUids'] as {
      mapValue?: { fields?: Record<string, FsValue> };
    })?.mapValue?.fields;
    const entry = (managers?.['dev-uid'] as { mapValue?: { fields?: Record<string, FsValue> } })
      ?.mapValue?.fields;
    assert.equal(str(entry?.['role']), 'moderator');
    assert.equal(str(entry?.['displayName']), 'Admin A');
    assert.ok(entry?.['claimedAt'], 'the audit stamp');
  } finally {
    fake.restore();
  }

  // A RANKLESS member takes the unclaimed club next door — first-come-
  // first-served, the 2026-08-17 arm that unblocks the whole surface.
  resetRoleCache(); // dev-uid's cached 'admin' from the first half must not leak
  resetEstateCache();
  const fake2 = fakeFirestore({ 'clubs/c2': clubSeed() });
  try {
    const res = await req(envWith({ DEV_EMAIL: 'guesty@example.com' }), 'POST', '/api/clubs/c2/managers/claim', {});
    assert.equal(res.status, 200);
    const managers = (fake2.docs.get('clubs/c2')?.fields['managerUids'] as {
      mapValue?: { fields?: Record<string, FsValue> };
    })?.mapValue?.fields;
    assert.deepEqual(Object.keys(managers ?? {}), ['dev-uid'], 'their own uid, and only theirs');
  } finally {
    fake2.restore();
  }
});

test('claim: a rankless member is refused on an ALREADY-managed club, in words', async () => {
  const fake = fakeFirestore({
    'clubs/c1': {
      ...clubSeed(),
      ...toFsFields({ managerUids: { 'someone-else': { role: 'host', displayName: 'X', claimedAt: 1 } } }),
    },
  });
  try {
    const res = await req(envWith({ DEV_EMAIL: 'guesty@example.com' }), 'POST', '/api/clubs/c1/managers/claim', {});
    assert.equal(res.status, 403);
    const body = (await res.json()) as { error?: string; detail?: string };
    assert.equal(body.error, 'club_already_claimed');
    assert.match(body.detail ?? '', /moderator or admin/, 'says how to get in');
    const managers = (fake.docs.get('clubs/c1')?.fields['managerUids'] as {
      mapValue?: { fields?: Record<string, FsValue> };
    })?.mapValue?.fields;
    assert.deepEqual(Object.keys(managers ?? {}), ['someone-else'], 'roster untouched');
  } finally {
    fake.restore();
  }
});

test('claim: a club’s OWN manager cannot appoint a co-manager (peer-escalation)', async () => {
  const fake = fakeFirestore({
    'clubs/c1': {
      ...clubSeed(),
      ...toFsFields({ managerUids: { 'dev-uid': { role: 'host', displayName: 'G', claimedAt: 1 } } }),
    },
  });
  try {
    const res = await req(envWith({ DEV_EMAIL: 'guesty@example.com' }), 'POST', '/api/clubs/c1/managers/claim', {});
    assert.equal(res.status, 403);
    assert.equal(((await res.json()) as { error?: string }).error, 'club_already_claimed');
  } finally {
    fake.restore();
  }
});

test('claim: a moderator overrides onto a club somebody else already manages', async () => {
  const fake = fakeFirestore({
    ...asModerator,
    'clubs/c1': {
      ...clubSeed(),
      ...toFsFields({ managerUids: { 'someone-else': { role: 'host', displayName: 'X', claimedAt: 1 } } }),
    },
  });
  try {
    const res = await req(envWith({ DEV_EMAIL: 'mod@example.com' }), 'POST', '/api/clubs/c1/managers/claim', {
      displayName: 'Mod M',
    });
    assert.equal(res.status, 200);
    const managers = (fake.docs.get('clubs/c1')?.fields['managerUids'] as {
      mapValue?: { fields?: Record<string, FsValue> };
    })?.mapValue?.fields;
    assert.deepEqual(
      Object.keys(managers ?? {}).sort(),
      ['dev-uid', 'someone-else'],
      'the override ADDS, it does not evict the existing manager',
    );
  } finally {
    fake.restore();
  }
});

/* ── mod-tier member ops ───────────────────────────────────────────────── */

test('member role: the host is immutable; others get their presentation role patched', async () => {
  const fake = fakeFirestore({
    ...asModerator,
    'clubs/c1': clubSeed(),
    'clubs/c1/members/alice': toFsFields({ displayName: 'Alice', role: 'member', status: 'active' }),
  });
  const env = envWith({ DEV_EMAIL: 'mod@example.com' });
  try {
    const host = await req(env, 'PUT', '/api/clubs/c1/members/host person/role', { role: 'member' });
    assert.equal(host.status, 409);

    const bad = await req(env, 'PUT', '/api/clubs/c1/members/alice/role', { role: 'host' });
    assert.equal(bad.status, 400, 'host is not a grantable presentation role');

    const ok = await req(env, 'PUT', '/api/clubs/c1/members/alice/role', { role: 'moderator' });
    assert.equal(ok.status, 200);
    const member = fake.docs.get('clubs/c1/members/alice');
    assert.equal(str(member?.fields['role']), 'moderator');
    assert.equal(str(member?.fields['displayName']), 'Alice', 'other member fields survive');

    const missing = await req(env, 'PUT', '/api/clubs/c1/members/nobody/role', { role: 'member' });
    assert.equal(missing.status, 404);
  } finally {
    fake.restore();
  }
});

test('remove member: host refused; member leaves slugs+count and their doc — clubs.js removeMemberBySlug', async () => {
  const fake = fakeFirestore({
    ...asModerator,
    'clubs/c1': clubSeed(),
    'clubs/c1/members/alice': toFsFields({ displayName: 'Alice', role: 'member' }),
  });
  const env = envWith({ DEV_EMAIL: 'mod@example.com' });
  try {
    const host = await req(env, 'DELETE', '/api/clubs/c1/members/host person');
    assert.equal(host.status, 409);
    assert.match(((await host.json()) as { detail?: string }).detail ?? '', /host cannot be removed/);

    const ok = await req(env, 'DELETE', '/api/clubs/c1/members/alice');
    assert.equal(ok.status, 200);
    const club = fake.docs.get('clubs/c1');
    assert.deepEqual(strArray(club?.fields['memberSlugs']), ['host person']);
    assert.equal((club?.fields['memberCount'] as { integerValue?: string })?.integerValue, '1');
    assert.ok(!fake.docs.has('clubs/c1/members/alice'));
  } finally {
    fake.restore();
  }
});

test('accept request: member doc born active, roster grows, request deleted — clubs.js acceptRequest', async () => {
  const fake = fakeFirestore({
    ...asModerator,
    'clubs/c1': clubSeed(),
    'clubs/c1/requests/bob': toFsFields({ displayName: 'Bob' }),
  });
  const env = envWith({ DEV_EMAIL: 'mod@example.com' });
  try {
    const missing = await req(env, 'POST', '/api/clubs/c1/requests/ghost/accept');
    assert.equal(missing.status, 404);

    const ok = await req(env, 'POST', '/api/clubs/c1/requests/bob/accept');
    assert.equal(ok.status, 200);
    const club = fake.docs.get('clubs/c1');
    assert.deepEqual(strArray(club?.fields['memberSlugs']), ['host person', 'alice', 'bob']);
    assert.equal((club?.fields['memberCount'] as { integerValue?: string })?.integerValue, '3');
    const member = fake.docs.get('clubs/c1/members/bob');
    assert.equal(str(member?.fields['displayName']), 'Bob');
    assert.equal(str(member?.fields['role']), 'member');
    assert.equal(str(member?.fields['status']), 'active');
    assert.ok(!fake.docs.has('clubs/c1/requests/bob'));
  } finally {
    fake.restore();
  }
});

test('reject request: the request doc is deleted, nothing else moves', async () => {
  const fake = fakeFirestore({
    ...asModerator,
    'clubs/c1': clubSeed(),
    'clubs/c1/requests/bob': toFsFields({ displayName: 'Bob' }),
  });
  try {
    const res = await req(envWith({ DEV_EMAIL: 'mod@example.com' }), 'DELETE', '/api/clubs/c1/requests/bob');
    assert.equal(res.status, 200);
    assert.ok(!fake.docs.has('clubs/c1/requests/bob'));
    assert.deepEqual(strArray(fake.docs.get('clubs/c1')?.fields['memberSlugs']), ['host person', 'alice']);
  } finally {
    fake.restore();
  }
});

test('invite: dupes refused with the client wording; fresh invitees land invited — clubs.js inviteMember', async () => {
  const fake = fakeFirestore({ ...asModerator, 'clubs/c1': clubSeed() });
  const env = envWith({ DEV_EMAIL: 'mod@example.com' });
  try {
    assert.equal((await req(env, 'POST', '/api/clubs/c1/invites', { displayName: 'A' })).status, 400);

    const dupe = await req(env, 'POST', '/api/clubs/c1/invites', { displayName: 'Alice' });
    assert.equal(dupe.status, 409);
    assert.match(((await dupe.json()) as { detail?: string }).detail ?? '', /already a member/);

    const ok = await req(env, 'POST', '/api/clubs/c1/invites', { displayName: 'Carol Smith' });
    assert.equal(ok.status, 200);
    assert.deepEqual(strArray(fake.docs.get('clubs/c1')?.fields['invitedSlugs']), ['carol smith']);
    const member = fake.docs.get('clubs/c1/members/carol smith');
    assert.equal(str(member?.fields['status']), 'invited');

    const again = await req(env, 'POST', '/api/clubs/c1/invites', { displayName: 'Carol Smith' });
    assert.equal(again.status, 409);
    assert.match(((await again.json()) as { detail?: string }).detail ?? '', /already been invited/);
  } finally {
    fake.restore();
  }
});

/* ── read lifecycle + schedule ─────────────────────────────────────────── */

test('schedule: dueAt re-stamped positionally, other milestone fields byte-identical', async () => {
  const fake = fakeFirestore({
    ...asModerator,
    'clubs/c1': clubSeed(),
    'clubs/c1/reads/r1': toFsFields({
      bookTitle: 'A Book',
      status: 'active',
      milestones: [
        { id: 'm2', position: 2, label: 'Back half', dueAt: 111 },
        { id: 'm1', position: 1, label: 'Front half' },
      ],
    }),
  });
  try {
    const res = await req(
      envWith({ DEV_EMAIL: 'mod@example.com' }),
      'PUT',
      '/api/clubs/c1/reads/r1/schedule',
      { dueAts: [5000, null] },
    );
    assert.equal(res.status, 200);
    const read = fake.docs.get('clubs/c1/reads/r1');
    const milestones = (read?.fields['milestones'] as {
      arrayValue?: { values?: Array<{ mapValue?: { fields?: Record<string, FsValue> } }> };
    })?.arrayValue?.values ?? [];
    assert.equal(milestones.length, 2);
    // sorted by position: m1 first, gets dueAts[0]; m2 loses its dueAt (null)
    const m1 = milestones[0]?.mapValue?.fields;
    const m2 = milestones[1]?.mapValue?.fields;
    assert.equal(str(m1?.['id']), 'm1');
    assert.equal((m1?.['dueAt'] as { integerValue?: string })?.integerValue, '5000');
    assert.equal(str(m1?.['label']), 'Front half', 'untouched milestone fields survive');
    assert.equal(str(m2?.['id']), 'm2');
    assert.ok(!m2?.['dueAt'], 'a null slot clears dueAt, like the client');
    assert.ok(read?.fields['scheduleUpdatedAt']);
  } finally {
    fake.restore();
  }
});

test('finish: archived reads refuse; active reads archive and free their slot — club-reads.js finishRead', async () => {
  const fake = fakeFirestore({
    ...asAdmin,
    'clubs/c1': clubSeed(),
    'clubs/c1/reads/r1': toFsFields({ bookTitle: 'A Book', status: 'active', slot: 1 }),
    'clubs/c1/reads/r2': toFsFields({ bookTitle: 'Old', status: 'finished', slot: 2 }),
  });
  try {
    assert.equal((await req(envWith(), 'POST', '/api/clubs/c1/reads/r1/finish', { status: 'won' })).status, 400);
    assert.equal(
      (await req(envWith(), 'POST', '/api/clubs/c1/reads/r2/finish', { status: 'finished' })).status,
      409,
    );
    const res = await req(envWith(), 'POST', '/api/clubs/c1/reads/r1/finish', { status: 'abandoned' });
    assert.equal(res.status, 200);
    const read = fake.docs.get('clubs/c1/reads/r1');
    assert.equal(str(read?.fields['status']), 'abandoned');
    assert.ok(read?.fields['finishedAt']);
    const slots = (fake.docs.get('clubs/c1')?.fields['activeSlots'] as {
      arrayValue?: { values?: Array<{ integerValue?: string }> };
    })?.arrayValue?.values;
    assert.deepEqual(slots?.map((v) => v.integerValue), ['2'], 'slot 1 freed');
  } finally {
    fake.restore();
  }
});

test('read remove: comments/progress/RATINGS swept (SA sees what rules hide), slot freed, read gone', async () => {
  const fake = fakeFirestore({
    ...asAdmin,
    'clubs/c1': clubSeed(),
    'clubs/c1/reads/r1': toFsFields({ bookTitle: 'A Book', status: 'active', slot: 2 }),
    'clubs/c1/reads/r1/comments/x': toFsFields({ text: 'hi' }),
    'clubs/c1/reads/r1/progress/alice': toFsFields({ milestonePosition: 1 }),
    'clubs/c1/reads/r1/ratings/alice': toFsFields({ rating: 4.5, displayName: 'Alice' }),
  });
  try {
    const res = await req(envWith(), 'DELETE', '/api/clubs/c1/reads/r1');
    assert.equal(res.status, 200);
    assert.ok(!fake.docs.has('clubs/c1/reads/r1'));
    assert.ok(!fake.docs.has('clubs/c1/reads/r1/comments/x'));
    assert.ok(!fake.docs.has('clubs/c1/reads/r1/progress/alice'));
    assert.ok(!fake.docs.has('clubs/c1/reads/r1/ratings/alice'), 'the complete ratings sweep');
    const slots = (fake.docs.get('clubs/c1')?.fields['activeSlots'] as {
      arrayValue?: { values?: Array<{ integerValue?: string }> };
    })?.arrayValue?.values;
    assert.deepEqual(slots?.map((v) => v.integerValue), ['1'], 'slot 2 freed');
  } finally {
    fake.restore();
  }
});

test('reveal ratings: the LIFECYCLE flip lands; the read gate itself stays rules-side', async () => {
  const fake = fakeFirestore({
    ...asAdmin,
    'clubs/c1': clubSeed(),
    'clubs/c1/reads/r1': toFsFields({ bookTitle: 'A Book', status: 'active' }),
  });
  try {
    const res = await req(envWith(), 'POST', '/api/clubs/c1/reads/r1/reveal-ratings');
    assert.equal(res.status, 200);
    const read = fake.docs.get('clubs/c1/reads/r1');
    assert.equal((read?.fields['ratingsRevealed'] as { booleanValue?: boolean })?.booleanValue, true);
    assert.ok(read?.fields['revealedAt']);
    // ⚠️ A MODERATOR NOW PASSES — the MANAGECLUB SPLIT, 2026-08-17. This
    // assertion previously demanded 403, because the reveal sat on manageClub
    // (admin+, or the club's own manager). Option B moved the read lifecycle
    // to operateClub, so moderator+ overrides here like everywhere else; the
    // shared dev-uid needs its role doc AND cache moved to moderator first.
    fake.docs.set('site_roles/dev-uid', { fields: toFsFields({ role: 'moderator' }), version: 2 });
    resetRoleCache();
    resetEstateCache();
    const asMod = await req(
      envWith({ DEV_EMAIL: 'mod@example.com' }),
      'POST',
      '/api/clubs/c1/reads/r1/reveal-ratings',
    );
    assert.equal(asMod.status, 200, 'site moderator holds the read lifecycle now');
    // …and the floor is still a floor: a rankless caller who manages no club
    // is refused, in words rather than a bare status.
    fake.docs.delete('site_roles/dev-uid');
    resetRoleCache();
    resetEstateCache();
    const refused = await req(
      envWith({ DEV_EMAIL: 'guesty@example.com' }),
      'POST',
      '/api/clubs/c1/reads/r1/reveal-ratings',
    );
    assert.equal(refused.status, 403);
    const body = (await refused.json()) as { detail?: string };
    assert.ok((body.detail ?? '').length > 0, 'a person never sees a bare 403');
  } finally {
    fake.restore();
  }
});

/* ── polls ─────────────────────────────────────────────────────────────── */

test('poll create: validPoll mirrored (question 1–200, options 2–10, nextBook titles)', async () => {
  const fake = fakeFirestore({ ...asModerator, 'clubs/c1': clubSeed() });
  const env = envWith({ DEV_EMAIL: 'mod@example.com' });
  try {
    assert.equal((await req(env, 'POST', '/api/clubs/c1/polls', { question: '', options: ['a', 'b'] })).status, 400);
    assert.equal((await req(env, 'POST', '/api/clubs/c1/polls', { question: 'Q', options: ['only'] })).status, 400);
    assert.equal(
      (await req(env, 'POST', '/api/clubs/c1/polls', { question: 'Q', options: Array(11).fill('x') })).status,
      400,
    );
    assert.equal(
      (await req(env, 'POST', '/api/clubs/c1/polls', {
        question: 'Next?', type: 'nextBook', options: [{ title: '' }, { title: 'B' }],
      })).status,
      400,
    );

    const res = await req(env, 'POST', '/api/clubs/c1/polls', {
      question: 'Snacks?',
      options: ['yes', 'always'],
      displayName: 'Mod M',
    });
    assert.equal(res.status, 200);
    const { pollId } = (await res.json()) as { pollId?: string };
    assert.ok(pollId);
    const poll = fake.docs.get(`clubs/c1/polls/${pollId}`);
    assert.equal(str(poll?.fields['question']), 'Snacks?');
    assert.equal(str(poll?.fields['status']), 'open');
    assert.equal(str(poll?.fields['type']), 'freeform');
    assert.equal(str(poll?.fields['createdBy']), 'Mod M');
    assert.equal(str(poll?.fields['createdBySlug']), 'mod m');
    assert.ok('nullValue' in (poll?.fields['closedAt'] ?? {}));
  } finally {
    fake.restore();
  }
});

test('poll status: closing stamps closedAt, reopening nulls it — club-reads.js setPollStatus', async () => {
  const fake = fakeFirestore({
    ...asModerator,
    'clubs/c1': clubSeed(),
    'clubs/c1/polls/p1': toFsFields({ question: 'Q', options: ['a', 'b'], status: 'open', closedAt: null }),
  });
  const env = envWith({ DEV_EMAIL: 'mod@example.com' });
  try {
    assert.equal((await req(env, 'PUT', '/api/clubs/c1/polls/p1/status', { status: 'paused' })).status, 400);
    assert.equal((await req(env, 'PUT', '/api/clubs/c1/polls/ghost/status', { status: 'closed' })).status, 404);

    const close = await req(env, 'PUT', '/api/clubs/c1/polls/p1/status', { status: 'closed' });
    assert.equal(close.status, 200);
    let poll = fake.docs.get('clubs/c1/polls/p1');
    assert.equal(str(poll?.fields['status']), 'closed');
    assert.ok('timestampValue' in (poll?.fields['closedAt'] ?? {}));

    const reopen = await req(env, 'PUT', '/api/clubs/c1/polls/p1/status', { status: 'open' });
    assert.equal(reopen.status, 200);
    poll = fake.docs.get('clubs/c1/polls/p1');
    assert.ok('nullValue' in (poll?.fields['closedAt'] ?? {}));
  } finally {
    fake.restore();
  }
});

test('poll delete: votes swept first, then the poll — club-reads.js deletePoll', async () => {
  const fake = fakeFirestore({
    ...asModerator,
    'clubs/c1': clubSeed(),
    'clubs/c1/polls/p1': toFsFields({ question: 'Q', options: ['a', 'b'], status: 'open' }),
    'clubs/c1/polls/p1/votes/alice': toFsFields({ optionIndex: 0, displayName: 'Alice' }),
    'clubs/c1/polls/p1/votes/bob': toFsFields({ optionIndex: 1, displayName: 'Bob' }),
  });
  try {
    const res = await req(envWith({ DEV_EMAIL: 'mod@example.com' }), 'DELETE', '/api/clubs/c1/polls/p1');
    assert.equal(res.status, 200);
    assert.ok(!fake.docs.has('clubs/c1/polls/p1'));
    assert.ok(!fake.docs.has('clubs/c1/polls/p1/votes/alice'));
    assert.ok(!fake.docs.has('clubs/c1/polls/p1/votes/bob'));
  } finally {
    fake.restore();
  }
});
