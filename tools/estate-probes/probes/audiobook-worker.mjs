/**
 * audiobook-api.heygabi.ai (`apps/audiobook-worker`) — the FOURTH consumer
 * of the estate pattern, deployed 2026-08-16 (Phase 0 + the Phase 1 server
 * half of the audiobook auth migration). Surface, from `src/index.ts`:
 *
 *   GET  /api/health       open; liveness + the current estate-check mode.
 *   GET  /api/me           canonical verifier; tokenless → the worded 401.
 *   POST /api/gate/shadow  the would-deny telemetry receiver — 204 ALWAYS.
 *
 * The health envelope here is deliberately NOT `docs/info/health-envelope.md`'s
 * `{ ok, service, time, detail }` — this Worker answers `{ ok, service,
 * time, estate_check }` (index.ts), no `detail`, because the mode IS the
 * detail that matters: the shadow flip is imminent and this suite is how
 * drift gets noticed, so the probe below asserts the mode is in the legal
 * set AND PRINTS the current value on every run.
 *
 * ## Why the one POST to /api/gate/shadow is inside the read-only contract
 *
 * Verified by reading `src/gate-shadow.ts` (the receiver), not guessed:
 *   - it answers 204 with no body ALWAYS — mode off, malformed body, missing
 *     token, internal bug (its own "iron rule 1");
 *   - it stores NOTHING — "nothing is stored in D1 or Firestore" is the
 *     file's own contract, `wrangler.toml` binds no D1/KV/R2 at all, and the
 *     only side effect is one `console.log` JSON line read via `wrangler
 *     tail`;
 *   - a TOKENLESS report (this probe sends no token) skips every outbound
 *     read: `estateStatusFor`, `cachedStoredRole` and `isClubManager` are
 *     all gated on a verified identity existing (processReport: `if
 *     (identity && email)` / `if (sa && identity?.uid ...)`), so the probe
 *     cannot even trigger a Firestore READ, let alone a write;
 *   - `action: "probe"` is not in ACTION_GATES, so gateDecision returns
 *     `{ wouldDeny: null, reason: 'unknown_action' }` — logged as such by
 *     design ("an action it sends that is not here still logs"), clearly
 *     synthetic in the tail, harmless in every mode ('off' does not even
 *     process it).
 *
 * Cost of the probe: at most one log line and one unit of the receiver's
 * 240/min per-isolate budget. That is the entire blast radius.
 */

import { get, post, options, check, header } from '../lib/kit.mjs';
import { AUDIOBOOK_API_ORIGIN, AUDIOBOOK_SITE_ORIGIN, FOREIGN_ORIGIN, GARBAGE_BEARER } from '../lib/origins.mjs';

const AREA = 'ab-worker';

/** env.ts's EstateCheckMode — the only three values estateCheckMode() can return. */
const ESTATE_CHECK_MODES = ['off', 'shadow', 'enforce'];

/**
 * The worded-refusal contract (ROLES.md §1e, index.ts's /api/me): never a
 * bare status — 401 + `error: "unauthenticated"` + a human `detail`
 * sentence. Asserting the detail is a non-empty string pins the "worded"
 * half, not just the shape.
 */
function expectWordedUnauthenticated(id, method, path, r) {
  const url = `${AUDIOBOOK_API_ORIGIN}${path}`;
  if (!r.ok) {
    check(AREA, id, method, url, 'answers 401 { error: "unauthenticated", detail: <worded> }', false, `request failed: ${r.error}`);
    return;
  }
  const ok =
    r.status === 401 &&
    r.json?.error === 'unauthenticated' &&
    typeof r.json?.detail === 'string' &&
    r.json.detail.length > 0;
  check(AREA, id, method, url, 'answers 401 { error: "unauthenticated", detail: <worded> }', ok, `status=${r.status} body=${JSON.stringify(r.json)}`);
}

export async function probeAudiobookWorker() {
  // --- /api/health: liveness + the estate-check mode ---------------------
  const healthUrl = `${AUDIOBOOK_API_ORIGIN}/api/health`;
  const h = await get(healthUrl);
  if (!h.ok) {
    check(AREA, 'AB1', 'GET', healthUrl, 'answers 200', false, `request failed: ${h.error}`);
  } else {
    check(AREA, 'AB1', 'GET', healthUrl, 'answers 200', h.status === 200, `status=${h.status}`);
    const body = h.json;
    const envelopeOk =
      h.status === 200 &&
      body !== null &&
      typeof body === 'object' &&
      typeof body.ok === 'boolean' &&
      typeof body.service === 'string' &&
      typeof body.time === 'string' &&
      typeof body.estate_check === 'string';
    check(
      AREA,
      'AB2',
      'GET',
      healthUrl,
      'envelope shape { ok, service, time, estate_check } (this Worker\'s own — no detail, by design)',
      envelopeOk,
      JSON.stringify(body)?.slice(0, 300) ?? String(body),
    );
    if (envelopeOk) {
      check(AREA, 'AB3', 'GET', healthUrl, 'service === "audiobook-worker"', body.service === 'audiobook-worker', `service=${body.service}`);
      check(AREA, 'AB4', 'GET', healthUrl, 'ok === true', body.ok === true, `ok=${body.ok}`);
      const t_ms = Date.parse(body.time);
      const withinADay = Number.isFinite(t_ms) && Math.abs(Date.now() - t_ms) < 24 * 60 * 60 * 1000;
      check(AREA, 'AB5', 'GET', healthUrl, 'time parses to roughly now', withinADay, `time=${body.time}`);
      check(
        AREA,
        'AB6',
        'GET',
        healthUrl,
        'estate_check ∈ { off, shadow, enforce }',
        ESTATE_CHECK_MODES.includes(body.estate_check),
        `estate_check=${JSON.stringify(body.estate_check)}`,
      );
      // The drift instrument: the shadow flip is a deliberate act, and THIS
      // line is how a run of the suite reports which mode production is in —
      // printed every run, pass or fail, so the flip (or an accidental
      // revert) is visible without reading wrangler config.
      console.log(`      ↳ estate_check mode is "${body.estate_check}" (the shadow flip will show here)`);
    }
  }

  // --- /api/me: tokenless AND garbage-bearer → the worded 401 ------------
  expectWordedUnauthenticated('AB7', 'GET', '/api/me', await get(`${AUDIOBOOK_API_ORIGIN}/api/me`));
  expectWordedUnauthenticated(
    'AB8',
    'GET',
    '/api/me',
    await get(`${AUDIOBOOK_API_ORIGIN}/api/me`, { headers: { Authorization: GARBAGE_BEARER } }),
  );

  // --- CORS: abCors() on /api/* — the audiobook site admitted, nothing wider
  const meUrl = `${AUDIOBOOK_API_ORIGIN}/api/me`;
  const mePre = await options(meUrl, {
    headers: {
      Origin: AUDIOBOOK_SITE_ORIGIN,
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'Authorization',
    },
  });
  if (!mePre.ok) {
    check(AREA, 'AB9', 'OPTIONS', meUrl, `access-control-allow-origin === ${AUDIOBOOK_SITE_ORIGIN}`, false, `request failed: ${mePre.error}`);
    check(AREA, 'AB10', 'OPTIONS', meUrl, 'access-control-allow-methods includes GET', false, `request failed: ${mePre.error}`);
  } else {
    const acao = header(mePre, 'access-control-allow-origin');
    check(AREA, 'AB9', 'OPTIONS', meUrl, `access-control-allow-origin === ${AUDIOBOOK_SITE_ORIGIN} (abCors, site-only)`, acao === AUDIOBOOK_SITE_ORIGIN, `ACAO=${acao}`);
    const acam = (header(mePre, 'access-control-allow-methods') ?? '').toUpperCase();
    check(AREA, 'AB10', 'OPTIONS', meUrl, 'access-control-allow-methods includes GET', acam.includes('GET'), `ACAM=${acam}`);
  }

  const meEvil = await options(meUrl, {
    headers: { Origin: FOREIGN_ORIGIN, 'Access-Control-Request-Method': 'GET' },
  });
  if (!meEvil.ok) {
    check(AREA, 'AB11', 'OPTIONS', meUrl, `no access-control-allow-origin for ${FOREIGN_ORIGIN}`, false, `request failed: ${meEvil.error}`);
  } else {
    const acao = header(meEvil, 'access-control-allow-origin');
    check(AREA, 'AB11', 'OPTIONS', meUrl, `no access-control-allow-origin for ${FOREIGN_ORIGIN}`, acao === null, `ACAO=${acao}`);
  }

  // --- POST /api/gate/shadow: the ONE by-design non-refused POST in this
  // suite (see the file header for the full safety argument, verified
  // against src/gate-shadow.ts). Tokenless, action "probe" — unknown to
  // ACTION_GATES, so in shadow/enforce it logs one clearly-synthetic
  // `unknown_action` line; in off it is not even processed. 204 + empty
  // body ALWAYS is the receiver's own iron rule 1, so anything else here is
  // a real finding. This row is allowlisted in run.mjs's method-discipline
  // audit — a new non-GET probe must be added there ON PURPOSE or the suite
  // fails itself.
  const shadowUrl = `${AUDIOBOOK_API_ORIGIN}/api/gate/shadow`;
  const shadow = await post(shadowUrl, {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'probe' }),
  });
  if (!shadow.ok) {
    check(AREA, 'AB12', 'POST', shadowUrl, 'answers 204 with empty body (fire-and-forget, always)', false, `request failed: ${shadow.error}`);
  } else {
    check(
      AREA,
      'AB12',
      'POST',
      shadowUrl,
      'answers 204 with empty body (fire-and-forget, always — iron rule 1)',
      shadow.status === 204 && shadow.text === '',
      `status=${shadow.status} body=${JSON.stringify(shadow.text.slice(0, 120))}`,
    );
  }
}
