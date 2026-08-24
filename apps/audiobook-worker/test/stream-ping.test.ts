/**
 * POST /api/audio/:anchor/stream-ping — the eviction access-timestamp route.
 *
 * These pin the AUDIT F3 fix: the client-supplied `:anchor` is a LOOKUP in the
 * gated manifest, never a string interpolated straight into a Firestore
 * document path. Before the fix, a `%2F`/`%23` anchor escaped the
 * `audio_streams` collection and named whichever document the rules-bypassing
 * service account writes; the route still answered 204.
 *
 * Exercised through the REAL exported Hono app with the estate directory
 * stubbed at `globalThis.fetch` and a fake gated bucket — the audio-file.test
 * idiom. No real service account is needed: the security decision happens
 * BEFORE any token mint, so an unknown/malicious anchor is refused with 404
 * without touching crypto or Firestore.
 */

import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import app from '../src/index.js';
import { resetEstateCache } from '../src/estate-status.js';
import { resetAudioManifestIndex } from '../src/audio-manifest.js';
import { resetManifestIndex } from '../src/ebook-manifest.js';
import { resetStreamPingThrottle } from '../src/stream-ping.js';
import type { Env } from '../src/env.js';

const UP_ANCHOR = 'b-aud0001';

const AUDIO_MANIFEST = {
  bucket: 'estate-audio',
  generated: '2026-08-18T02:00:00Z',
  count: 1,
  streamable: 1,
  files: {
    'Brandon Sanderson/Skyward.m4b': {
      anchor: UP_ANCHOR,
      title: 'Skyward',
      bookId: 'skyward',
      size: 40,
      streamable: true,
      since: '2026-08-18T01:00:00Z',
    },
  },
};

function fakeGatedBucket(audio: unknown | null) {
  return {
    async get(key: string) {
      if (key === 'audio_manifest.json') {
        return audio === null ? null : { async json() { return audio; } };
      }
      return null;
    },
  } as unknown as R2Bucket;
}

interface Script {
  seen: { status: string; visibility?: unknown } | 'error';
}

function stubFetch(script: Script) {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/estate/seen')) {
      if (script.seen === 'error') return new Response('boom', { status: 500 });
      return Response.json(script.seen);
    }
    // Any hit to Google's token/Firestore endpoints means the anchor got past
    // the manifest gate — the tests below must never reach here for a
    // malicious anchor.
    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;
  return { restore: () => void (globalThis.fetch = original) };
}

/** A syntactically valid SA whose key cannot actually sign — so if a valid
 *  anchor reaches the write path, it lands on `token_mint_failed` (503), which
 *  is decidedly NOT the 404 an unknown anchor gets. Proves the lookup admits a
 *  real anchor without needing real crypto. */
const FAKE_SA = JSON.stringify({
  client_email: 'sa@audiobook-catalog.iam.gserviceaccount.com',
  private_key: '-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n',
  project_id: 'audiobook-catalog',
});

function envWith(over: Partial<Env> = {}): Env {
  return {
    ENVIRONMENT: 'development',
    DEV_EMAIL: 'member@example.com',
    FIREBASE_PROJECT_ID: 'audiobook-catalog',
    OWNER_EMAILS: 'owner@example.com',
    ESTATE_AUTH_URL: 'https://auth.example',
    ESTATE_APP_TOKEN_AUDIOBOOK: 'ab-token',
    ESTATE_CHECK: 'enforce',
    SITE_ORIGINS: 'https://audiobooks.heygabi.ai,https://ebooks.heygabi.ai',
    EBOOKS_GATED: fakeGatedBucket(AUDIO_MANIFEST),
    FIREBASE_SERVICE_ACCOUNT: FAKE_SA,
    ...over,
  } as Env;
}

const GRANTED: Script = { seen: { status: 'approved', visibility: ['audiobook', 'ebooks'] } };

const pingUrl = (rawAnchorSegment: string) => `/api/audio/${rawAnchorSegment}/stream-ping`;

beforeEach(() => {
  resetEstateCache();
  resetAudioManifestIndex();
  resetManifestIndex();
  resetStreamPingThrottle();
});

test('⚠️ F3: a path-injection anchor (%2F + %23) is REFUSED 404 before any write', async () => {
  // `..%2Fsite_roles%2F<uid>%23` — Hono decodes %2F to a literal `/` in
  // param() while still matching one route segment, so before the fix this
  // string became `audio_streams/../site_roles/<uid>#…`, escaping the
  // collection and dropping the update mask, and the route answered 204.
  const f = stubFetch(GRANTED);
  try {
    const malicious = '..%2Fsite_roles%2Fowner-uid%23';
    const res = await app.request(pingUrl(malicious), { method: 'POST' }, envWith());
    // The manifest lookup rejects it: 404, never a Firestore write. Before the
    // fix this was 204 (or 503), and the stubFetch throw guarded the write.
    assert.equal(res.status, 404);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body.error, 'unknown_book');
  } finally {
    f.restore();
  }
});

test('⚠️ F3: an unknown-but-clean anchor is REFUSED 404, never written', async () => {
  const f = stubFetch(GRANTED);
  try {
    const res = await app.request(pingUrl('b-does-not-exist'), { method: 'POST' }, envWith());
    assert.equal(res.status, 404);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body.error, 'unknown_book');
  } finally {
    f.restore();
  }
});

test('F3: a KNOWN anchor passes the lookup and reaches the write path (not 404)', async () => {
  // With a real (present) anchor the route proceeds past validation to the
  // token mint; the fake SA cannot sign, so it lands on token_mint_failed
  // (503) — decidedly not the 404/unknown_book an unknown anchor gets. This
  // proves the new lookup does not reject legitimate pings.
  const f = stubFetch(GRANTED);
  try {
    const res = await app.request(pingUrl(UP_ANCHOR), { method: 'POST' }, envWith());
    assert.notEqual(res.status, 404);
    const body = (await res.json()) as Record<string, unknown>;
    assert.notEqual(body.error, 'unknown_book');
    assert.equal(res.status, 503);
    assert.equal(body.error, 'token_mint_failed');
  } finally {
    f.restore();
  }
});
