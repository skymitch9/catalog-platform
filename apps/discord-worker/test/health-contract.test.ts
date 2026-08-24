/**
 * RESPONSE CONTRACT TEST — GET /api/health (2026-08-24).
 *
 * The discord-worker is not consumed by a browser render surface, but its
 * health envelope IS consumed: `tools/estate-probes/probes/discord-worker.mjs`
 * reads it to decide whether the worker is up and shaped right, and the estate
 * treats a probe SKIP/again as the signal that a worker exists at all. If a
 * refactor drops `service` or the `configured` map from the health response,
 * the probe's shape check silently starts failing against production — caught
 * after deploy, on the one worker that has no page to white-screen and so no
 * other early warning.
 *
 * DERIVED, NOT HAND-MAINTAINED. The required set is read out of the probe
 * itself — every `body.X` access — and asserted against the response the REAL
 * handler builds (driven through `app.request('/api/health')`, the same way the
 * worker's own tests exercise it). Own-property, so an explicit `false`/`{}` is
 * distinguished from an absent key. It goes RED the moment the handler drops a
 * field the probe reads.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { app } from '../src/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../..');
const CONSUMER = resolve(REPO, 'tools/estate-probes/probes/discord-worker.mjs');

/** The health fields the probe reads off the parsed body. In that file `body`
 * is ONLY the /api/health JSON, so `body.X` accesses are exactly the contract. */
function requiredHealthFields(): string[] {
  const src = readFileSync(CONSUMER, 'utf8');
  const fields = new Set<string>();
  for (const m of src.matchAll(/\bbody\.([a-z_][a-z0-9_]*)/g)) if (m[1]) fields.add(m[1]);
  return [...fields];
}

test('the discord health probe reads a non-empty set, incl. service + configured', () => {
  const required = requiredHealthFields();
  assert.ok(required.length >= 3, `derived too few health fields from the probe: ${required.join(', ')}`);
  for (const anchor of ['ok', 'service', 'configured']) {
    assert.ok(required.includes(anchor), `probe reads body.${anchor} — derivation missed it`);
  }
});

test('GET /api/health provides every field its probe consumer reads', async () => {
  const required = requiredHealthFields();
  const res = await app.request('/api/health', {}, { DISCORD_PUBLIC_KEY: 'x' });
  assert.equal(res.status, 200);
  const body = (await res.json()) as Record<string, unknown>;
  for (const field of required) {
    assert.ok(
      Object.hasOwn(body, field),
      `GET /api/health is MISSING "${field}", which estate-probes reads. On this worker — which has no ` +
        `page to white-screen — the probe's shape check is the early warning, so a dropped field is caught ` +
        `only after deploy. Restore it on the health response (or stop the probe reading it).`,
    );
  }
});
