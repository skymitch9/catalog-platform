/**
 * audiobook-api.heygabi.ai (`apps/audiobook-worker`) — the FOURTH consumer
 * of the estate pattern, deployed 2026-08-16 (Phase 0 + the Phase 1 server
 * half of the audiobook auth migration). Surface, from `src/index.ts`:
 *
 *   GET  /api/health       open; liveness + the current estate-check mode.
 *   GET  /api/me           canonical verifier; tokenless → the worded 401.
 *   POST /api/gate/shadow  the would-deny telemetry receiver — 204 ALWAYS.
 *   GET  /api/audio/status      audio player phase 1 (2026-08-18); gated.
 *   GET|HEAD /api/audio/:anchor/file  the audiobook byte stream; gated.
 *   GET  /api/books/available          GABI's book knowledge (2026-08-18); gated.
 *   GET  /api/books/presence           one term rolled up across ≤6 books; gated.
 *   GET  /api/book/:bookId/search      four modes (§6.2); gated.
 *   GET  /api/book/:bookId/passage     one passage + its ±1 stitch; gated.
 *
 * ⚠️ The two audio routes and the two ebook ones are gated on the SAME estate
 * grant (`vis_ebooks`) by owner decision, so this suite can only ever see
 * their refusals — which is the interesting half for a media route anyway.
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

  // --- The AUDIO player's phase-1 surface (2026-08-18) --------------------
  //
  // Both routes are gated on the estate's `vis_ebooks` grant — owner decision
  // 1: "MIRROR EBOOK if they can read an ebook they can listen to an audio."
  // Unauthenticated is the only half this suite can reach, and it is the half
  // that matters most for a media route:
  //
  // ⚠️ `Accept-Ranges: bytes` MUST ride on the 401. Safari decides whether a
  // media element can range-stream AT ALL from the headers of the FIRST
  // response it sees, and for a signed-out listener that response is this
  // refusal. A 401 that omitted it, retried after sign-in, teaches the client
  // to pull the whole 601 MB file. The ebook route learned this LIVE, minutes
  // after its own first deploy — the gate writes plain JSON refusals for a
  // route that needs neither header, and the byte route has to re-dress them.
  //
  // ⚠️ And the refusal must never be cacheable. An authenticated body left
  // cacheable at the edge is a public download endpoint with extra steps, and
  // a refusal naming somebody's approval status must never sit in a shared
  // cache either.
  expectWordedUnauthenticated('AB13', 'GET', '/api/audio/status', await get(`${AUDIOBOOK_API_ORIGIN}/api/audio/status`));

  const audioFileUrl = `${AUDIOBOOK_API_ORIGIN}/api/audio/b-probe000000/file`;
  const audio = await get(audioFileUrl);
  expectWordedUnauthenticated('AB14', 'GET', '/api/audio/:anchor/file', audio);
  if (!audio.ok) {
    check(AREA, 'AB15', 'GET', audioFileUrl, 'the 401 carries Accept-Ranges: bytes and no-store', false, `request failed: ${audio.error}`);
  } else {
    const ar = (header(audio, 'accept-ranges') ?? '').toLowerCase();
    const cc = (header(audio, 'cache-control') ?? '').toLowerCase();
    const vary = (header(audio, 'vary') ?? '').toLowerCase();
    check(
      AREA,
      'AB15',
      'GET',
      audioFileUrl,
      'the 401 carries Accept-Ranges: bytes + no-store + Vary: Authorization (Safari reads the FIRST response)',
      ar === 'bytes' && cc.includes('no-store') && vary.includes('authorization'),
      `accept-ranges=${ar} cache-control=${cc} vary=${vary}`,
    );
  }

  // ⚠️ AND NOTHING ABOUT THE LIBRARY LEAKS THROUGH A REFUSAL. The gate runs
  // before anything touches a bucket precisely so an anonymous caller cannot
  // use this route to probe which books the household holds; this asserts the
  // body says nothing about a file.
  if (audio.ok) {
    const body = JSON.stringify(audio.json ?? audio.text ?? '');
    check(
      AREA,
      'AB16',
      'GET',
      audioFileUrl,
      'the refusal names no file (.m4b) and no path — the gate runs before the bucket',
      !body.includes('.m4b') && !body.includes('estate-audio'),
      body.slice(0, 200),
    );
  }

  // --- GABI's book knowledge: four gated retrieval routes ----------------
  //
  // ⚠️ THE PATHS ARE NOT SYMMETRIC AND THIS COST A ROUND-TRIP TO DISCOVER.
  // The two corpus-wide routes are `/api/books/…` (PLURAL) and the two
  // per-book ones are `/api/book/:bookId/…` (SINGULAR) — `book-routes.ts`
  // lines 277/311 vs 372/429. Guessing `/api/books/pht-1/search` gets Hono's
  // BARE text/plain `404 Not Found`, which looks exactly like "the feature is
  // not deployed" and is in fact "you spelled the route wrong". Recorded here
  // because the next session will otherwise diagnose it twice.
  //
  // These ride the SAME `vis_ebooks` gate as the audio and ebook routes
  // (design: reading rides `vis_ebooks`, never the download capability), so
  // like every other gated route this suite can only ever see the refusal —
  // which is the half that matters for a surface holding the household's
  // derived book text. Nothing here holds `ESTATE_APP_TOKEN_BOOKS`; the
  // suite's zero-credential contract is unchanged.
  expectWordedUnauthenticated('AB17', 'GET', '/api/books/available', await get(`${AUDIOBOOK_API_ORIGIN}/api/books/available`));
  expectWordedUnauthenticated(
    'AB18',
    'GET',
    '/api/books/available',
    await get(`${AUDIOBOOK_API_ORIGIN}/api/books/available`, { headers: { Authorization: GARBAGE_BEARER } }),
  );
  expectWordedUnauthenticated(
    'AB19',
    'GET',
    '/api/books/presence',
    await get(`${AUDIOBOOK_API_ORIGIN}/api/books/presence?term=probe&books=b-probe000000`),
  );
  expectWordedUnauthenticated(
    'AB20',
    'GET',
    '/api/book/:bookId/search',
    await get(`${AUDIOBOOK_API_ORIGIN}/api/book/b-probe000000/search?q=probe`),
  );
  const passageUrl = `${AUDIOBOOK_API_ORIGIN}/api/book/b-probe000000/passage?ord=0`;
  const passage = await get(passageUrl);
  expectWordedUnauthenticated('AB21', 'GET', '/api/book/:bookId/passage', passage);

  // ⚠️ AND THE REFUSAL LEAKS NO BOOK TEXT AND NO STORAGE SHAPE. Same argument
  // as AB16 one layer in: the gate runs before any R2 GET, so an anonymous
  // caller must not be able to learn from a refusal which books are packed,
  // what the bucket is called, or that packs live under a `text/` prefix.
  // The derived text is a MORE attractive scrape target than the files
  // (access doc §5: smaller, cleaner, searchable), so this is asserted rather
  // than assumed.
  if (passage.ok) {
    const body = JSON.stringify(passage.json ?? passage.text ?? '');
    check(
      AREA,
      'AB22',
      'GET',
      passageUrl,
      'the refusal names no pack, bucket or prefix — the gate runs before R2',
      !body.includes('ebooks-gated') && !body.includes('.json.gz') && !body.includes('text/'),
      body.slice(0, 200),
    );
  }
}
