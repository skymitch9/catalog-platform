/**
 * SHELF ↔ DRIVE PARITY — GET/POST /api/estate/shelf/parity.
 *
 * Owner, 2026-08-20: *"i want to see a progress bar or % or number of books
 * moved, for the server. I want to know when its a 100% parity of drive. and
 * everytime a new book shows up i want to be sure its still a 100% paraity."*
 *
 * ── WHY THE NUMBER ARRIVES FROM OUTSIDE THE ESTATE ──────────────────────────
 *
 * Parity needs both sides visible at once, and exactly one machine can see
 * both: Justin's box. It holds the local mirror AND an rclone remote onto the
 * Drive folder. The pipeline PC writes Drive but has no network path to the box
 * (the tunnel is HTTP-only; Tailscale is a later phase), and Cloudflare sees
 * neither. So the box computes and reports; this Worker only stores and serves.
 * Full reasoning: audiobook_catalog/docs/info/shelf-parity-design.md §3.
 *
 * ⚠️ WHY NOT JUST COUNT AUDIOBOOKSHELF'S LIBRARY. It would need no token and no
 * script — and it would be the wrong number. ABS counts what it has SCANNED and
 * parsed; it lags rclone, it can show a half-transferred file as an item, and a
 * file it cannot parse is invisible to it. It can read "100%" with files
 * missing. `rclone check` compares file by file, which is the only thing that
 * answers the question actually asked. Measuring a proxy and calling it proof
 * is the failure this whole endpoint exists to avoid — the estate proved that
 * the same day, when ABS's own byte total was read as evidence the disk was
 * full and it was not.
 *
 * ── THE TOKEN ───────────────────────────────────────────────────────────────
 *
 * `SHELF_PARITY_TOKEN`, dedicated and deliberately tiny. It lives on hardware
 * OUTSIDE the estate's control — a machine that also runs a game server — so it
 * is scoped to the smallest thing that works: it can write one report to one
 * key. It cannot read the library, cannot pass Cloudflare Access, cannot grant
 * anything, and is accepted on no other route. A leak costs a falsified parity
 * reading (bad — this is a TRUST surface) but discloses nothing.
 *
 * ⚠️ THE CONDUCTOR TOKEN IS DELIBERATELY NOT ACCEPTED HERE, unlike the event
 * ring which takes either. The ring's fallback exists for writers that predate
 * its dedicated secret; this route has no such history, and the conductor token
 * can rewrite the agent board. Handing that to Justin's box to save minting one
 * secret would be the trade the ring's own comments argue against.
 *
 * ── WHAT IS STORED ──────────────────────────────────────────────────────────
 *
 * One KV key, `shelf:parity:current`, replaced whole. No history: the question
 * is "is it in parity NOW", and a ring buffer here would be a second thing to
 * trim and evict for a number that is recomputed twice a day anyway.
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import type { AppBindings } from './env.js';
import { requireDevops } from './middleware/auth.js';
import { checkConductorAuth, type ConductorAuth } from './agent-board.js';
import { readRecord, stampUsed, verifyToken, type TokenRecord } from './shelf-token.js';

export const shelfParityRoutes = new Hono<AppBindings>();

/** The one key. Replaced whole on every report. */
export const PARITY_KEY = 'shelf:parity:current';

/**
 * A report older than this is not shown as a result — it is shown as `unknown`.
 *
 * ⚠️ 26 h is chosen against the box's 12-hourly cron: one skipped run is
 * tolerated, two are not. THIS IS THE MOST IMPORTANT NUMBER IN THE FILE. The
 * failure this endpoint must never produce is a green "100%" that is simply
 * three weeks stale because the box stopped reporting. A measurement that did
 * not happen is not a passing measurement.
 */
export const STALE_AFTER_MS = 26 * 60 * 60 * 1000;

/** Bound every count. Large enough for any real library, small enough that a
 *  malformed or hostile report cannot become a storage problem. */
const MAX_COUNT = 10_000_000;
/** ~9 PB in KB — a bound, not an expectation. */
const MAX_KB = 10_000_000_000;

/**
 * This route's OWN refusals. Pure and exported so the tests can pin the words.
 *
 * ⚠️ IT DELIBERATELY DOES NOT REUSE `conductorRefusal`, and that is not
 * duplication for its own sake — it was a live bug. Borrowing it made a bad
 * bearer here answer *"That bearer is not the conductor token this Worker
 * holds… re-read it from the custody file named in docs/access/agent-board.md"*,
 * which names a credential this route does not accept and sends whoever is
 * debugging to the wrong secret and the wrong document. The caller here is
 * Justin's box, whose owner has never heard of the conductor token.
 *
 * worker-events.ts already learned exactly this for `secret_unset`; the lesson
 * applies to every branch, not just that one. A refusal that misidentifies the
 * credential is worse than a bare status: it is confidently wrong directions.
 */
export function parityRefusal(auth: Exclude<ConductorAuth, 'ok'>): {
  status: 401 | 503;
  body: { error: string; detail: string; fix?: string };
} {
  switch (auth) {
    case 'secret_unset':
      return {
        status: 503,
        body: {
          error: 'shelf_parity_token_unset',
          detail:
            'The shelf cannot report parity yet — this Worker holds no shelf parity token, so it has no way to tell a real report from anyone else’s.',
          fix: 'Generate one at https://heygabi.ai/status/api (devops sign-in) and paste it into /srv/shelf/.parity.env on the shelf server.',
        },
      };
    case 'no_header':
      return {
        status: 401,
        body: {
          error: 'unauthenticated',
          detail:
            'This endpoint takes the shelf parity token as a bearer. No Authorization header was sent.',
          fix: 'Send: Authorization: Bearer <SHELF_PARITY_TOKEN>. On the shelf server it lives in /srv/shelf/.parity.env.',
        },
      };
    case 'bad_token':
      return {
        status: 401,
        body: {
          error: 'bad_token',
          detail:
            'That bearer is not the shelf parity token. This route accepts only that one token — not the conductor token, and not a signed-in session.',
          fix: 'Check /srv/shelf/.parity.env on the shelf server. If it was rotated, generate a fresh one at https://heygabi.ai/status/api — nobody can look the old one up.',
        },
      };
  }
}

export type ParityReport = {
  rc: number;
  total: number;
  matched: number;
  missing: number;
  extra: number;
  differing: number;
  free_kb: number;
  used_kb: number;
  containers?: string[];
  /**
   * ⚠️ SHADOW-TREE DRIFT — books on Justin's disk that are NOT hardlinked into
   * Audiobookshelf's shadow tree, so ABS renders them "Missing". Optional and
   * for back-compat: a report that omits it is valid and treated as "not
   * reported" (no shadow alarm). This is the one thing `rclone check` cannot
   * see — it compares Drive⇄disk and passes 100% while ABS is still broken,
   * which is exactly the live failure (Mashton / Arcane Pathfinder) that this
   * field exists to surface. Only the box can count it.
   */
  shadow_missing?: number;
};

function intOk(v: unknown, max: number): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max;
}

/**
 * Validate a posted report. Pure and exported so the tests can pin every
 * rejection without a live Worker.
 *
 * ⚠️ THE CROSS-FIELD CHECK IS NOT PEDANTRY. `matched + missing + differing`
 * must equal `total`, because `total` is derived from exactly those three on
 * the box. A report that fails it is a bug in the script, and storing it would
 * render a bar with a nonsense denominator — a wrong number displayed
 * confidently, which is worse than no number.
 *
 * ⚠️ `rc` is accepted at any value on purpose, INCLUDING failures. rc>1 means
 * `rclone check` itself did not run, and that has to be storable so it can be
 * rendered as `unknown`. Rejecting it would leave the last GOOD report standing
 * as though nothing had gone wrong — the exact silent-staleness trap.
 */
export function validateReport(body: unknown): { ok: true; report: ParityReport } | { ok: false; detail: string } {
  if (typeof body !== 'object' || body === null) {
    return { ok: false, detail: 'The report must be a JSON object.' };
  }
  const b = body as Record<string, unknown>;

  for (const f of ['total', 'matched', 'missing', 'extra', 'differing'] as const) {
    if (!intOk(b[f], MAX_COUNT)) {
      return { ok: false, detail: `"${f}" must be a whole number between 0 and ${MAX_COUNT}.` };
    }
  }
  for (const f of ['free_kb', 'used_kb'] as const) {
    if (!intOk(b[f], MAX_KB)) {
      return { ok: false, detail: `"${f}" must be a whole number between 0 and ${MAX_KB}.` };
    }
  }
  if (typeof b.rc !== 'number' || !Number.isInteger(b.rc)) {
    return { ok: false, detail: '"rc" must be rclone\'s integer exit code.' };
  }

  const total = b.total as number;
  const sum = (b.matched as number) + (b.missing as number) + (b.differing as number);
  if (sum !== total) {
    return {
      ok: false,
      detail: `matched + missing + differing (${sum}) must equal total (${total}); the report is internally inconsistent.`,
    };
  }

  // Optional, for whoever opts into the container heartbeat (Option A on
  // Justin's page). Strings only, bounded, and never rendered as markup.
  let containers: string[] | undefined;
  if (b.containers !== undefined) {
    if (!Array.isArray(b.containers) || b.containers.length > 50) {
      return { ok: false, detail: '"containers" must be an array of at most 50 short strings.' };
    }
    if (!b.containers.every((x) => typeof x === 'string' && x.length <= 200)) {
      return { ok: false, detail: 'Each "containers" entry must be a string of at most 200 characters.' };
    }
    containers = b.containers as string[];
  }

  // Optional shadow-tree drift count. Absent OR null → not reported, which is
  // valid for back-compat with reporters that predate this field. When
  // present it is bounded exactly like the other counts.
  let shadow_missing: number | undefined;
  if (b.shadow_missing !== undefined && b.shadow_missing !== null) {
    if (!intOk(b.shadow_missing, MAX_COUNT)) {
      return { ok: false, detail: `"shadow_missing" must be a whole number between 0 and ${MAX_COUNT}.` };
    }
    shadow_missing = b.shadow_missing as number;
  }

  return {
    ok: true,
    report: {
      rc: b.rc as number,
      total,
      matched: b.matched as number,
      missing: b.missing as number,
      extra: b.extra as number,
      differing: b.differing as number,
      free_kb: b.free_kb as number,
      used_kb: b.used_kb as number,
      ...(containers ? { containers } : {}),
      ...(shadow_missing !== undefined ? { shadow_missing } : {}),
    },
  };
}

/**
 * Turn a stored report + the clock into the state the page renders.
 *
 * Pure and exported: every one of these branches is a thing that has to be
 * right at 3am, and none of them should need a live Worker to test.
 *
 * ⚠️ ORDER MATTERS. Staleness is checked BEFORE parity, so a stale report can
 * never render green no matter how good its numbers were when it was written.
 */
export function deriveState(
  stored: (ParityReport & { received_at: string }) | null,
  nowMs: number,
): { state: string; detail: string } {
  if (!stored) {
    return {
      state: 'never_reported',
      detail:
        'The server has never reported. Either the parity script is not installed on the box yet, or it has never managed to reach this endpoint.',
    };
  }

  const age = nowMs - Date.parse(stored.received_at);
  if (!Number.isFinite(age) || age > STALE_AFTER_MS) {
    return {
      state: 'unknown',
      detail:
        'The last report is more than a day old, so this number is not current. The box checks twice daily — two missed runs means the script, the cron, or the machine has stopped.',
    };
  }
  if (stored.rc > 1) {
    return {
      state: 'unknown',
      detail:
        'The last check did not complete — rclone itself failed, so nothing was actually compared. This is not the same as "nothing is missing".',
    };
  }

  const missingBytes = (stored.missing / Math.max(stored.total, 1)) * stored.used_kb;
  if (stored.missing > 0 && missingBytes > stored.free_kb) {
    return {
      state: 'cannot_fit',
      detail:
        'What is still missing looks larger than the free space left on the server, so waiting will not finish this.',
    };
  }
  // ⚠️ SHADOW-TREE DRIFT — checked AFTER staleness and rc>1 (a stale or crashed
  // report must still win), but BEFORE the in_parity green branch below, so a
  // report that is file-parity-100% can never render green while books on disk
  // are missing from Audiobookshelf's shadow tree. rclone compares Drive⇄disk
  // and cannot see this; only the box's own shadow count can, and it is the
  // exact live failure this alarm exists for. Absent/null → behave as today.
  if (typeof stored.shadow_missing === 'number' && stored.shadow_missing > 0) {
    const n = stored.shadow_missing;
    return {
      state: 'shelf_behind',
      detail:
        `${n} book(s) are on the disk but not in Audiobookshelf's shadow tree, so ABS shows them Missing. ` +
        'The hardlink rebuild has not run — see SHELF_JUSTIN §4 (re-run 02-abs-hardlinks.sh + install the */15 cron).',
    };
  }
  if (stored.missing === 0 && stored.differing === 0) {
    return { state: 'in_parity', detail: 'Every file on Drive is on the server, at the same size.' };
  }
  return {
    state: 'behind',
    detail:
      'Files on Drive are not on the server. If books were added in the last few hours this is normal and the next pull will heal it; if not, the sync ran and still missed them.',
  };
}

/**
 * POST — the box reporting. Bearer only, never a user session.
 *
 * ⚠️ A SIGNED-IN COOKIE MUST NOT WORK HERE. This is machine auth: a family
 * member's browser must never be able to write the number that tells the
 * household whether their library is safe.
 */
shelfParityRoutes.post('/estate/shelf/parity', async (c: Context<AppBindings>) => {
  const kv = c.env.estate_docs;
  if (!kv) {
    return c.json({ error: 'docs_kv_unbound', fix: 'add the estate_docs kv_namespaces binding' }, 503);
  }

  // ⚠️ TWO ACCEPTED CREDENTIALS, ON PURPOSE AND TEMPORARILY. The self-service
  // key (hashed in KV, minted from /status/api) is the real one. The legacy
  // `SHELF_PARITY_TOKEN` env secret is the hand-delivered original, still
  // installed on the box; dropping it the moment this deployed would have
  // stopped parity reporting from a machine nobody can reach to fix.
  //
  // ⚠️ DELETE THE LEGACY LEG once the box reports on a minted key — that is
  // observable, not guessed: GET .../parity/token shows `last_used_at`, and
  // the page says so in words. Shadow-first, then remove; leaving it forever
  // would keep a credential alive that no longer has a rotation story.
  const header = c.req.header('authorization') ?? null;
  const presented = /^Bearer\s+(.+)$/i.exec((header ?? '').trim())?.[1]?.trim() ?? '';

  let rec: TokenRecord | null = null;
  try {
    rec = await readRecord(kv);
  } catch {
    return c.json({ error: 'shelf_token_corrupt' }, 500);
  }

  const verdict = presented ? await verifyToken(rec, presented, Date.now()) : 'no_match';
  if (verdict === 'no_match') {
    // Fall back to the legacy env secret, and only then refuse.
    const legacy = checkConductorAuth(c.env.SHELF_PARITY_TOKEN, header);
    if (legacy !== 'ok') {
      // ⚠️ `secret_unset` must not be reported when a minted key EXISTS — that
      // would tell the caller to go run `wrangler secret put` when the real
      // problem is that their bearer is simply wrong.
      const cause: Exclude<ConductorAuth, 'ok'> =
        legacy === 'secret_unset' && rec !== null ? 'bad_token' : legacy;
      const r = parityRefusal(cause);
      return c.json(r.body, r.status);
    }
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'bad_json', detail: 'The body was not readable JSON.' }, 400);
  }

  const v = validateReport(body);
  if (!v.ok) return c.json({ error: 'bad_report', detail: v.detail }, 400);

  // received_at is stamped HERE, not taken from the sender: the box's clock is
  // not ours to trust, and this timestamp is what the staleness rule hangs on.
  const stored = { ...v.report, received_at: new Date().toISOString() };
  await kv.put(PARITY_KEY, JSON.stringify(stored));

  // Best-effort telemetry on the key that just worked. This is what turns
  // "did my paste take?" into a fact on /status/api instead of a guess.
  if (rec !== null && (verdict === 'current' || verdict === 'previous')) {
    await stampUsed(kv, rec, stored.received_at, undefined, verdict);
  }

  return c.json({
    ok: true,
    received_at: stored.received_at,
    // ⚠️ Told plainly so a rotation that never got installed is VISIBLE in the
    // script's own output, not just on a page nobody has open.
    key: verdict === 'previous' ? 'previous (grace window — install the new key)' : verdict,
  });
});

/** GET — the status page reading. Devops-gated like the rest of the shelf. */
shelfParityRoutes.get('/estate/shelf/parity', requireDevops(), async (c: Context<AppBindings>) => {
  const kv = c.env.estate_docs;
  if (!kv) {
    return c.json({ error: 'docs_kv_unbound', fix: 'add the estate_docs kv_namespaces binding' }, 503);
  }

  const raw = await kv.get(PARITY_KEY, 'text');
  let stored: (ParityReport & { received_at: string }) | null = null;
  if (raw) {
    try {
      stored = JSON.parse(raw);
    } catch {
      stored = null; // unreadable stored value renders as never_reported, not as a 500
    }
  }

  const { state, detail } = deriveState(stored, Date.now());
  return c.json({ state, detail, report: stored });
});
