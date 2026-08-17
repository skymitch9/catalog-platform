/**
 * GET /api/ebooks/manifest — the ebook permission gate (owner directive
 * 2026-08-17: "ebooks should be like the other site where we grant permission
 * to view it. I don't want people scraping my books").
 *
 * Exercised through the REAL exported Hono app, with the estate directory
 * stubbed at `globalThis.fetch` and a fake R2 bucket — the me.test.ts idiom.
 * ⚠️ Stated plainly: these prove the DECISIONS, not that the Worker can reach
 * a real directory or a real bucket.
 *
 * Every test here is behaviour-failing: remove the visibility check and the
 * no-grant test serves the shelf; remove the identity check and the tokenless
 * test does.
 */

import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import app from '../src/index.js';
import { resetEstateCache } from '../src/estate-status.js';
import type { Env } from '../src/env.js';

/** A manifest shaped like the real one, including the sensitive tail. */
const MANIFEST = {
  generated_at: '2026-08-17T02:00:00Z',
  count: 2,
  ebooks: [
    { path: 'A/one.epub', anchor: 'b-aaaa', title: 'One', format: 'epub' },
    { path: 'B/two.pdf', anchor: 'b-bbbb', title: 'Two', format: 'pdf' },
  ],
  // ⚠️ Names a real file path. It rides INSIDE the gate deliberately — see
  // ebooks.ts's header.
  needs_human_cover: [{ path: 'B/two.pdf', title: 'Two', format: 'pdf', reason: 'text-first page 1' }],
};

/** A minimal R2Bucket: only `get`, only the one key the route asks for. */
function fakeBucket(body: unknown | null) {
  return {
    async get(key: string) {
      if (key !== 'ebooks.json' || body === null) return null;
      return { async json() { return body; } };
    },
  } as unknown as R2Bucket;
}

interface Script {
  /** The /seen answer. `'error'` makes the directory answer 500. */
  seen: { status: string; visibility?: unknown; download_ebooks?: unknown } | 'error';
}

function stubFetch(script: Script) {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/estate/seen')) {
      if (script.seen === 'error') return new Response('boom', { status: 500 });
      return Response.json(script.seen);
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;
  return { restore: () => void (globalThis.fetch = original) };
}

function envWith(over: Partial<Env> = {}): Env {
  return {
    ENVIRONMENT: 'development',
    DEV_EMAIL: 'member@example.com',
    FIREBASE_PROJECT_ID: 'audiobook-catalog',
    OWNER_EMAILS: 'owner@example.com',
    ESTATE_AUTH_URL: 'https://auth.example',
    ESTATE_APP_TOKEN_AUDIOBOOK: 'ab-token',
    ESTATE_CHECK: 'shadow',
    EBOOKS_GATED: fakeBucket(MANIFEST),
    ...over,
  };
}

async function getManifest(env: Env) {
  const res = await app.request('/api/ebooks/manifest', {}, env);
  const body = (await res.json()) as Record<string, any>;
  return { res, body };
}

beforeEach(() => resetEstateCache());

/* ── tokenless ─────────────────────────────────────────────────────────── */

test('⚠️ no token → 401 and NOT ONE BOOK, with a sentence that says how to get in', async () => {
  // ENVIRONMENT 'production' turns the dev bypass off, which is what makes
  // this the real anonymous path rather than a stubbed one.
  const { res, body } = await getManifest(envWith({ ENVIRONMENT: 'production' }));
  assert.equal(res.status, 401);
  assert.equal(body.error, 'unauthenticated');
  assert.match(body.detail, /[Ss]ign in/);
  // The whole point: the refusal body carries no shelf.
  assert.equal(body.ebooks, undefined);
  assert.equal(body.needs_human_cover, undefined);
  assert.equal(JSON.stringify(body).includes('one.epub'), false);
});

/* ── the four distinct refusals (§1e: never one message for four causes) ── */

test('pending → 403 awaiting_approval, distinct from every other refusal', async () => {
  const f = stubFetch({ seen: { status: 'pending', visibility: ['audiobook'] } });
  try {
    const { res, body } = await getManifest(envWith());
    assert.equal(res.status, 403);
    assert.equal(body.error, 'awaiting_approval');
    assert.match(body.detail, /approve/i);
    assert.equal(body.ebooks, undefined);
  } finally {
    f.restore();
  }
});

test('revoked → 403 access_revoked, and it does not read as "ask for the shelf"', async () => {
  const f = stubFetch({ seen: { status: 'revoked', visibility: [] } });
  try {
    const { res, body } = await getManifest(envWith());
    assert.equal(res.status, 403);
    assert.equal(body.error, 'access_revoked');
    assert.equal(body.ebooks, undefined);
  } finally {
    f.restore();
  }
});

test('⚠️ approved WITHOUT the `ebooks` grant → 403 no_ebooks_grant and no shelf', async () => {
  // The load-bearing case: a fully approved household member who may see the
  // audiobook catalog and the library still gets nothing here.
  const f = stubFetch({ seen: { status: 'approved', visibility: ['audiobook', 'library', 'games'] } });
  try {
    const { res, body } = await getManifest(envWith());
    assert.equal(res.status, 403);
    assert.equal(body.error, 'no_ebooks_grant');
    assert.match(body.detail, /Ebooks/);
    assert.equal(body.ebooks, undefined);
    assert.equal(JSON.stringify(body).includes('one.epub'), false);
  } finally {
    f.restore();
  }
});

test('a directory that answers a status but NO visibility fails CLOSED', async () => {
  // null visibility means "we do not know", never "no limits". A pre-§4.5
  // server, or a garbage field, must not open the shelf.
  const f = stubFetch({ seen: { status: 'approved', visibility: 'everything' } });
  try {
    const { res, body } = await getManifest(envWith());
    assert.equal(res.status, 403);
    assert.equal(body.error, 'no_ebooks_grant');
  } finally {
    f.restore();
  }
});

/* ── the open path ─────────────────────────────────────────────────────── */

test('approved WITH the grant → 200, the whole manifest, needs_human_cover included', async () => {
  const f = stubFetch({ seen: { status: 'approved', visibility: ['audiobook', 'ebooks'] } });
  try {
    const { res, body } = await getManifest(envWith());
    assert.equal(res.status, 200);
    assert.equal(body.count, 2);
    assert.equal(body.ebooks.length, 2);
    // ⚠️ The gaps list rides INSIDE the gate with the rest — it names files.
    assert.equal(body.needs_human_cover.length, 1);
    assert.equal(body.generated_at, '2026-08-17T02:00:00Z');
    // Never a shared cache: the answer is per-person by construction.
    assert.match(res.headers.get('cache-control') ?? '', /private/);
  } finally {
    f.restore();
  }
});

/* ── download: the LADDER's question, not the estate's (2026-08-17) ─────── */

test('download is a SIDE permission: the shelf opens for a viewer who cannot download', async () => {
  // The half that did not change: `vis_ebooks` opens the shelf, and the
  // download answer never gates it. What DID change is where the download
  // answer comes from — an approved member with no resolvable ladder rung
  // holds no `download`, because the floor is `admin`.
  const f = stubFetch({ seen: { status: 'approved', visibility: ['ebooks'] } });
  try {
    const { res, body } = await getManifest(envWith());
    assert.equal(res.status, 200, 'the shelf is a view grant — download never gates it');
    assert.equal(body.can_download, false);
    // ⚠️ null role = "we could not resolve your rung" (no service account in
    // this env), which a reader can tell apart from a resolved-but-too-low
    // rung. A bare false meaning both would be the indistinguishable failure.
    assert.equal(body.role, null);
  } finally {
    f.restore();
  }
});

test('⚠️ the estate CANNOT grant download any more — a directory still sending it is ignored', async () => {
  // The regression guard on the owner's 2026-08-17 directive: *"For ebooks I
  // don't want a download check box, I want to use roles we have. Set up the
  // roles to match library."* An auth-worker that is mid-deploy, rolled back,
  // or hand-patched can still put `download_ebooks: true` on the /seen answer.
  // If that ever again turned into a download, the checkbox would be back in
  // all but name — so this pins that it does not.
  const f = stubFetch({
    seen: { status: 'approved', visibility: ['ebooks'], download_ebooks: true },
  });
  try {
    const { res, body } = await getManifest(envWith());
    assert.equal(res.status, 200);
    assert.equal(body.can_download, false, 'the estate does not decide this any more');
  } finally {
    f.restore();
  }
});

/* ── the break-glass, and the two ways the estate can be wrong ─────────── */

test('the owner is served without a directory round-trip — break-glass, never a lockout', async () => {
  // ⚠️ NO fetch stub: any call to /seen would throw "unexpected fetch". The
  // owner path must not make one, so that a broken or unreachable directory
  // can never lock the owner out of his own shelf.
  const { res, body } = await getManifest(envWith({ DEV_EMAIL: 'owner@example.com' }));
  assert.equal(res.status, 200);
  assert.equal(body.ebooks.length, 2);
  // The break-glass reaches the DOWNLOAD half too, and now does so through the
  // ladder rather than the directory: OWNER_EMAILS forces the `owner` rung, and
  // `owner` clears the `admin` floor on `download`. No service account is
  // consulted — a broken role store cannot lock the owner out either.
  assert.equal(body.role, 'owner');
  assert.equal(body.can_download, true);
});

test('an UNCONFIGURED estate refuses and says it is our setup, not their permission', async () => {
  const { res, body } = await getManifest(
    envWith({ ESTATE_AUTH_URL: undefined, ESTATE_APP_TOKEN_AUDIOBOOK: undefined }),
  );
  assert.equal(res.status, 503);
  assert.equal(body.error, 'estate_unconfigured');
  // §1e point 5: an outage is not a permission failure. Nobody should be sent
  // to ask for access they may already hold.
  assert.equal(/permission/i.test(body.detail) && !/not a decision/i.test(body.detail), false);
  assert.equal(body.ebooks, undefined);
});

test('an UNREACHABLE estate is a 502 outage, never an invented approval', async () => {
  const f = stubFetch({ seen: 'error' });
  try {
    const { res, body } = await getManifest(envWith());
    assert.equal(res.status, 502);
    assert.equal(body.error, 'estate_unreachable');
    assert.equal(body.ebooks, undefined);
  } finally {
    f.restore();
  }
});

/* ── the store's own two failure modes, told apart ─────────────────────── */

test('an unbound bucket and an absent object are DIFFERENT sentences', async () => {
  const f = stubFetch({ seen: { status: 'approved', visibility: ['ebooks'] } });
  try {
    const unbound = await getManifest(envWith({ EBOOKS_GATED: undefined }));
    assert.equal(unbound.res.status, 503);
    assert.equal(unbound.body.error, 'manifest_store_unbound');

    resetEstateCache();
    const empty = await getManifest(envWith({ EBOOKS_GATED: fakeBucket(null) }));
    assert.equal(empty.res.status, 503);
    assert.equal(empty.body.error, 'manifest_absent');
    // The fixes are nothing alike, so the fix lines must differ.
    assert.notEqual(unbound.body.fix, empty.body.fix);
  } finally {
    f.restore();
  }
});

/* ── the ESTATE_CHECK question, pinned so nobody "fixes" it later ───────── */

test('⚠️ the gate does NOT respect ESTATE_CHECK — off/shadow refuse exactly the same', async () => {
  // The mode exists to shadow an EXISTING behaviour before it starts refusing
  // people. This route had no existing behaviour, and a shelf that serves in
  // shadow mode is an ungated shelf. If a future session adds a mode gate
  // here, this test is the tripwire.
  for (const mode of ['off', 'shadow', 'enforce']) {
    resetEstateCache();
    const f = stubFetch({ seen: { status: 'approved', visibility: ['audiobook'] } });
    try {
      const { res, body } = await getManifest(envWith({ ESTATE_CHECK: mode }));
      assert.equal(res.status, 403, `mode ${mode} must still refuse`);
      assert.equal(body.error, 'no_ebooks_grant');
    } finally {
      f.restore();
    }
  }
});
