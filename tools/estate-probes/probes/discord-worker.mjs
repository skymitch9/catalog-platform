/**
 * The discord-worker (`apps/discord-worker`) — BUILT, NOT DEPLOYED (no
 * Discord application registered yet, so no hostname exists). This file is
 * the skipped-but-VISIBLE entry: the suite must say "not deployed yet
 * (expected)" out loud rather than silently not knowing the worker exists.
 *
 * The day it deploys: set `DISCORD_API_ORIGIN` in `lib/origins.mjs` to the
 * real hostname and the probes below switch on — they are already written
 * against the shape `src/index.ts` actually serves:
 *
 *   GET /api/health → 200 { ok: true, service: 'estate-discord', features,
 *                           configured: { <secret-name>: boolean, ... } }
 *
 * (config-PRESENCE booleans, never values — design doc §1.7). POST
 * /interactions is deliberately NOT probed: it is Ed25519-signature-gated
 * Discord machinery, and a synthetic unsigned POST proves nothing a health
 * check does not — the refusal path is covered by the worker's own tests.
 */

import { get, check } from '../lib/kit.mjs';
import { DISCORD_API_ORIGIN } from '../lib/origins.mjs';

const AREA = 'discord';

export async function probeDiscordWorker() {
  if (DISCORD_API_ORIGIN === null) {
    console.log('  skip [discord] discord-worker: not deployed yet (expected) — no Discord app registered; set DISCORD_API_ORIGIN in lib/origins.mjs when it ships and these probes switch on');
    return;
  }

  const healthUrl = `${DISCORD_API_ORIGIN}/api/health`;
  const r = await get(healthUrl);
  if (!r.ok) {
    check(AREA, 'D1', 'GET', healthUrl, 'answers 200', false, `request failed: ${r.error}`);
    return;
  }
  check(AREA, 'D1', 'GET', healthUrl, 'answers 200', r.status === 200, `status=${r.status}`);

  const body = r.json;
  const shapeOk =
    r.status === 200 &&
    body !== null &&
    typeof body === 'object' &&
    typeof body.ok === 'boolean' &&
    typeof body.service === 'string' &&
    typeof body.configured === 'object' &&
    body.configured !== null;
  check(
    AREA,
    'D2',
    'GET',
    healthUrl,
    'envelope shape { ok, service, configured } (config-presence booleans, no values)',
    shapeOk,
    JSON.stringify(body)?.slice(0, 300) ?? String(body),
  );
  if (shapeOk) {
    check(AREA, 'D3', 'GET', healthUrl, 'service === "estate-discord"', body.service === 'estate-discord', `service=${body.service}`);
    check(AREA, 'D4', 'GET', healthUrl, 'ok === true', body.ok === true, `ok=${body.ok}`);
    // Which secrets are present is worth SEEING on every run (a missing one
    // is exactly the "deployed but half-configured" state), without failing
    // the suite over it — configuration completeness is the deployer's
    // checklist, not this suite's contract.
    console.log(`      ↳ configured: ${JSON.stringify(body.configured)}`);
  }
}
