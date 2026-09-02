/**
 * CORS locked to the audiobook origins (migration design §2's meCors
 * pattern) + the env parsers' fail-safe directions.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import app from '../src/index.js';
import {
  DEFAULT_SITE_ORIGINS,
  estateCheckMode,
  parseOwnerEmails,
  parseSiteOrigins,
} from '../src/env.js';
import type { Env } from '../src/env.js';

const AB = 'https://audiobooks.heygabi.ai';

function health(origin: string, env: Env = {}): Promise<Response> {
  return Promise.resolve(app.request('/api/health', { headers: { Origin: origin } }, env));
}

test('the audiobook origin is allowed by DEFAULT — correct before any var exists', async () => {
  const res = await health(AB);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('access-control-allow-origin'), AB);
});

test('a foreign origin gets NO allow header — exact-origin, no wildcard, no reflection', async () => {
  for (const origin of ['https://evil.example', 'https://audiobooks.heygabi.ai.evil.example', 'http://audiobooks.heygabi.ai']) {
    const res = await health(origin);
    assert.equal(res.headers.get('access-control-allow-origin'), null, origin);
  }
});

test('OPTIONS preflight on /api/me is answered by the middleware, tokenless', async () => {
  const res = await app.request(
    '/api/me',
    {
      method: 'OPTIONS',
      headers: {
        Origin: AB,
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'authorization',
      },
    },
    {},
  );
  assert.equal(res.headers.get('access-control-allow-origin'), AB);
  assert.ok(res.headers.get('access-control-allow-headers')?.toLowerCase().includes('authorization'));
});

/* ── the PLAYER's preflight contract (design §3.2 item 4) ───────────────── */

test('🔴 the audio byte route preflights `Authorization` AND `Range` — both, or playback dies opaquely', async () => {
  // audio-player-design.md §3.2 item 4, and the phase-2 handoff's item 2. The
  // `<audio>` element's ranges get their bearer from a SERVICE WORKER, so every
  // one is a cross-origin credentialed request and every one preflights.
  // Neither header is CORS-safelisted.
  //
  // ⚠️ The mutation that turns this red — dropping either name — does NOT
  // produce a status a person or a log can see. It produces an OPAQUE NETWORK
  // ERROR in the browser, which this estate has already misdiagnosed once as
  // "the Worker is down" (ebook-viewer-phase1.md §2.4), and which the media
  // element reports to the page as a bare `error` event with no status at all.
  const res = await app.request(
    '/api/audio/b-aud0001/file',
    {
      method: 'OPTIONS',
      headers: {
        Origin: AB,
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'authorization,range',
      },
    },
    {},
  );
  assert.equal(res.headers.get('access-control-allow-origin'), AB);
  const allowed = (res.headers.get('access-control-allow-headers') ?? '').toLowerCase();
  assert.ok(allowed.includes('authorization'), allowed);
  assert.ok(allowed.includes('range'), allowed);
  // And the reader must be able to SEE the 206's framing headers back.
  const exposed = (res.headers.get('access-control-expose-headers') ?? '').toLowerCase();
  for (const h of ['content-range', 'accept-ranges', 'content-length']) {
    assert.ok(exposed.includes(h), `${h} not exposed: ${exposed}`);
  }
});

test('`Access-Control-Max-Age` is set, and it is at least Chromium\'s two-hour cap', async () => {
  // Design §3.2 item 4: *"an Access-Control-Max-Age worth setting so a long
  // listen is not preflighting all afternoon"*. MEASURED live at 600 on
  // 2026-09-02 — a re-preflight every ten minutes for the whole of a 13.7-hour
  // mean book, on top of every seek. Raised to 7200, which is Chromium's cap.
  //
  // ⚠️ It caches the PREFLIGHT ANSWER, never an authorisation: the gate still
  // runs on every real request.
  const res = await app.request(
    '/api/audio/b-aud0001/file',
    {
      method: 'OPTIONS',
      headers: {
        Origin: AB,
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'authorization,range',
      },
    },
    {},
  );
  assert.equal(res.headers.get('access-control-max-age'), '7200');
});

test('SITE_ORIGINS set → exactly that list (a dev origin joins via .dev.vars, not code)', async () => {
  const env: Env = { SITE_ORIGINS: 'http://localhost:8788' };
  const dev = await health('http://localhost:8788', env);
  assert.equal(dev.headers.get('access-control-allow-origin'), 'http://localhost:8788');
  const prod = await health(AB, env);
  assert.equal(prod.headers.get('access-control-allow-origin'), null);
});

test('parseSiteOrigins: unset → the production default; trailing slashes trimmed', () => {
  assert.deepEqual(parseSiteOrigins(undefined), DEFAULT_SITE_ORIGINS);
  assert.deepEqual(parseSiteOrigins('https://a.example/, https://b.example'), [
    'https://a.example',
    'https://b.example',
  ]);
  assert.deepEqual(parseSiteOrigins(''), []);
});

test('estateCheckMode: affirmative values only — a typo reads as off', () => {
  assert.equal(estateCheckMode('shadow'), 'shadow');
  assert.equal(estateCheckMode('enforce'), 'enforce');
  for (const raw of [undefined, '', 'off', 'Shadow', 'ENFORCE', 'on', 'true']) {
    assert.equal(estateCheckMode(raw), 'off', String(raw));
  }
});

test('parseOwnerEmails: comma-split, trimmed, lowercased — every consumer the same way', () => {
  assert.deepEqual(parseOwnerEmails(' A@Example.com , b@example.com,'), [
    'a@example.com',
    'b@example.com',
  ]);
  assert.deepEqual(parseOwnerEmails(undefined), []);
});

test('GET /api/health names the service and the current estate-check mode', async () => {
  const res = await app.request('/api/health', {}, { ESTATE_CHECK: 'shadow' });
  const body = (await res.json()) as { ok: boolean; service: string; estate_check: string };
  assert.equal(body.ok, true);
  assert.equal(body.service, 'audiobook-worker');
  assert.equal(body.estate_check, 'shadow');
});
