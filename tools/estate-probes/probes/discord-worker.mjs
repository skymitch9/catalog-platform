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

    // --- GABI's book knowledge: the FOURTH tool allowlist, live ----------
    //
    // The four retrieval routes on the audiobook Worker are probed there
    // (AB17–AB22) but only ever from OUTSIDE the gate. This is the other
    // end of the same wire: `gabi_books_ready` is the AND of posture-on +
    // `ESTATE_APP_TOKEN_BOOKS` set + service account set, so a `false` here
    // is a SETUP gap and never a permissions one (access doc §6) — which is
    // exactly the distinction worth catching mechanically, because the
    // feature's failure mode is silent: `makeBooksPort()` returns null, the
    // tools are never described to the model, and she simply answers from
    // the catalogue instead. Nothing looks broken.
    //
    // ⚠️ Asserted as a SET, not a count. The whole point of the fourth
    // allowlist is that these names travel together and no further tool
    // joins them without a decision; the discord-worker's own
    // `book-knowledge.test.ts` pins that structurally at build time, and
    // this pins the same claim against what is actually deployed.
    //
    // ⚠️ `count_phrase` became the fifth on 2026-09-03 (`272ac67`, deployed
    // `estate-discord` the same day) and this array was not updated with it,
    // so D5 failed on every run from then until 2026-09-05 — a standing false
    // failure, which is the kind that makes people stop reading a suite. The
    // fix is the array, NOT the assertion: keep it a SET (a length check would
    // silently accept a swap) and do not relax it to a subset test.
    const BOOKS_TOOLS = ['book_presence', 'count_phrase', 'list_book_knowledge', 'read_book_passage', 'search_book_text'];
    const got = Array.isArray(body.gabi_books_tools) ? [...body.gabi_books_tools].sort() : null;
    check(
      AREA,
      'D5',
      'GET',
      healthUrl,
      `gabi_books_tools === the five names in GABI_BOOKS_TOOL_NAMES (${BOOKS_TOOLS.join(', ')})`,
      got !== null && got.length === BOOKS_TOOLS.length && got.every((n, i) => n === BOOKS_TOOLS[i]),
      `gabi_books_tools=${JSON.stringify(body.gabi_books_tools)}`,
    );

    // Posture and readiness are PRINTED, not failed on: `GABI_BOOKS` is an
    // affirmative-only lever the owner may legitimately pull to "off" (access
    // doc §3, and it is the documented rollback), so a suite that failed on
    // it would fight the rollback it exists to make safe.
    console.log(
      `      ↳ gabi_books: enabled=${body.gabi_books_enabled} ready=${body.gabi_books_ready} ` +
        `bytes/turn=${body.gabi_books_bytes_per_turn} passages/turn=${body.gabi_books_passages_per_turn} turns/day=${body.gabi_books_turns_per_day}`,
    );
  }
}
