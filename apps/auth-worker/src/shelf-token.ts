/**
 * SHELF PARITY TOKEN — self-service mint/rotate, GET/POST
 * /api/estate/shelf/parity/token.
 *
 * Owner, 2026-08-20: *"what we should implement is a way for justin to gen a
 * key or regen a key. and have it all from the ui page for max safety."*
 *
 * ── WHY THIS REPLACES `wrangler secret put` + A DM ──────────────────────────
 *
 * The first parity token was minted by the owner and DM'd to Justin. That put
 * the plaintext in four places at once — the owner's scratchpad, the sender's
 * message history, the recipient's message history, and a third party's
 * servers — none of which can be un-sent, and three of which outlive any
 * rotation. Self-service removes every one of them: the value is generated in
 * the Worker, shown to Justin's browser exactly once, and never stored
 * anywhere in readable form.
 *
 * ⚠️ **ONLY A SHA-256 HASH IS PERSISTED.** After the response that mints it,
 * the plaintext exists in exactly two places on earth: whatever Justin pasted
 * into `/srv/shelf/.parity.env`, and his clipboard until he copies something
 * else. Nobody can read it back — not the owner, not a later Claude session,
 * not a KV dump, not this file. That is the whole point of the design and it
 * is why there is deliberately NO reveal route: a token you can re-read is a
 * token that can be re-leaked.
 *
 * ── WHY KV AND NOT A WORKER SECRET ──────────────────────────────────────────
 *
 * ⚠️ A Worker CANNOT write its own secrets at runtime. `wrangler secret put` is
 * a deploy-time operation, so a self-service button is impossible on that
 * storage. The only workaround would be handing this Worker an account-scoped
 * Cloudflare API token so it could rewrite its own config — storing a
 * credential that can edit every Worker in the account in order to manage the
 * smallest credential in the estate. That trade is strictly backwards, so the
 * token moved to KV instead, hashed.
 *
 * ── THE GRACE WINDOW (owner's call, 2026-08-20) ─────────────────────────────
 *
 * Rotation keeps the OLD hash valid for {@link GRACE_MS} unless the caller
 * ticks "revoke now". The reason is the failure mode, not convenience: if
 * Justin regenerates and fumbles the paste into `.parity.env`, a hard cutover
 * means parity silently stops reporting until someone notices. With a grace
 * window the next cron run still lands on the old token and the bar keeps
 * moving while he fixes it.
 *
 * ⚠️ THE OVERRIDE IS THE POINT. The one case where grace is actively wrong is
 * rotating BECAUSE the token is believed leaked — there, a day of continued
 * validity is a day the leaked value still works. `revoke_now: true` drops the
 * previous hash immediately. Both paths exist because they answer opposite
 * questions ("don't let me break it" vs "kill it now"), and defaulting to
 * either one alone gets the other case wrong.
 *
 * ── WHAT IS STORED ──────────────────────────────────────────────────────────
 *
 * One KV key, {@link TOKEN_KEY}, replaced whole:
 *
 *   { current:  { hash, fp, created_at, created_by, last_used_at },
 *     previous: { hash, fp, grace_until } | null }
 *
 * ⚠️ GENERALISED 2026-08-20 by src/machine-keys.ts, which owns the estate-wide
 * registry. The primitives below take an optional prefix and KV key so every
 * machine credential shares ONE implementation of mint/verify/revoke; the
 * defaults keep this file's own shelf routes behaving exactly as before, and
 * `shelf:parity:token` deliberately keeps its original name so the record
 * written before that refactor is the record read after it.
 *
 * `fp` is the token's first {@link FP_LEN} characters, the GitHub/Stripe
 * idiom. It is shown in the UI so Justin can match the box against the live
 * one (`head -c 30 /srv/shelf/.parity.env`) WITHOUT either side revealing the
 * secret. Six characters off a 43-character body leaves ~220 bits unguessed.
 */

import { Hono } from 'hono';
import type { AppBindings } from './env.js';
import { requireDevops } from './middleware/auth.js';

export const shelfTokenRoutes = new Hono<AppBindings>();

/** The one key. Read-modify-write; at two parity reports a day, uncontended. */
export const TOKEN_KEY = 'shelf:parity:token';

/**
 * How long a rotated-away token keeps working. One full cron interval (12 h)
 * would be the bare minimum; 24 h means a rotation done in the evening
 * survives until the following evening even if Justin walks away mid-task.
 */
export const GRACE_MS = 24 * 60 * 60 * 1000;

/** Characters of the token shown as its fingerprint. */
export const FP_LEN = 6;

/**
 * ⚠️ THE PREFIX IS A SEARCH TERM, NOT DECORATION. If this value ever lands in
 * a log, a paste, or a screenshot, `shelfpar_` is what makes it findable and
 * revocable. Every credential-issuing service converged on this for the same
 * reason.
 */
export const TOKEN_PREFIX = 'shelfpar_';

/**
 * ⚠️ BOTH SIDES CARRY THEIR OWN STATS. `previous` used to hold only a hash, a
 * fingerprint and an expiry — so the moment a key was rotated away from, its
 * creation date and usage history vanished, and the UI could not answer "is
 * the old one still being used?" for the one key where that question decides
 * whether a rotation finished. The stats travel WITH the side.
 */
export type TokenSide = {
  hash: string;
  fp: string;
  created_at: string;
  created_by: string;
  last_used_at: string | null;
  /** Successful authenticated reports. Older records predate it — read `?? 0`. */
  use_count?: number;
};
export type TokenCurrent = TokenSide;
export type TokenPrevious = TokenSide & { grace_until: string };
export type TokenRecord = { current: TokenCurrent; previous: TokenPrevious | null };

/** Length-independent compare, mirroring agent-board.ts's. Comparing hashes
 *  rather than secrets makes timing near-irrelevant here, but a compare that
 *  short-circuits is the kind of thing that gets copied somewhere it matters. */
export function timingSafeEqualHex(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** 32 bytes of CSPRNG as base64url — no padding, no `+/` to mangle in a shell
 *  single-quoted string, which is exactly where this value gets pasted. */
export function mintToken(prefix: string = TOKEN_PREFIX): string {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const b64 = btoa(String.fromCharCode(...raw))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return prefix + b64;
}

export function fingerprint(token: string, prefix: string = TOKEN_PREFIX): string {
  return token.slice(0, prefix.length + FP_LEN);
}

/** What the metadata route and the UI are allowed to see: never a hash, never
 *  a value. The fingerprint is the only part of the token that is safe to
 *  render, and it is what makes "does the box match?" answerable at a glance. */
export function publicView(rec: TokenRecord | null, now: number) {
  if (!rec) return { exists: false as const, active: [] as ActiveKeyView[] };
  const prevLive =
    rec.previous !== null && Date.parse(rec.previous.grace_until) > now ? rec.previous : null;

  // ⚠️ `active` IS THE LIST A PERSON ACTS ON, and it contains only keys that
  // WORK RIGHT NOW. An expired `previous` is deliberately absent rather than
  // listed-as-dead: a revoke button beside something already powerless is a
  // button that teaches the list cannot be trusted at a glance.
  const active: ActiveKeyView[] = [
    {
      slot: 'current' as const,
      fingerprint: rec.current.fp,
      created_at: rec.current.created_at,
      created_by: rec.current.created_by,
      last_used_at: rec.current.last_used_at,
      use_count: rec.current.use_count ?? 0,
      valid_until: null,
    },
  ];
  if (prevLive) {
    active.push({
      slot: 'previous' as const,
      fingerprint: prevLive.fp,
      created_at: prevLive.created_at,
      created_by: prevLive.created_by,
      last_used_at: prevLive.last_used_at,
      use_count: prevLive.use_count ?? 0,
      valid_until: prevLive.grace_until,
    });
  }

  return {
    exists: true as const,
    active,
    // Kept for callers that predate `active`.
    fingerprint: rec.current.fp,
    created_at: rec.current.created_at,
    created_by: rec.current.created_by,
    last_used_at: rec.current.last_used_at,
    previous_valid_until: prevLive ? prevLive.grace_until : null,
    previous_fingerprint: prevLive ? prevLive.fp : null,
  };
}

export type ActiveKeyView = {
  slot: 'current' | 'previous';
  fingerprint: string;
  created_at: string;
  created_by: string;
  last_used_at: string | null;
  use_count: number;
  valid_until: string | null;
};

export type TokenVerdict = 'current' | 'previous' | 'no_match';

/**
 * Which stored hash — if either — the presented bearer matches.
 *
 * ⚠️ AN EXPIRED `previous` IS NOT A MATCH. The expiry is checked against the
 * caller's clock reading here rather than by deleting the record on a timer,
 * because nothing runs on a timer in a Worker: a grace window that were only
 * cleaned up on the next write would stay valid indefinitely on a box that
 * stopped reporting, which is the precise opposite of what it is for.
 */
export async function verifyToken(
  rec: TokenRecord | null,
  presented: string,
  now: number,
): Promise<TokenVerdict> {
  if (!rec) return 'no_match';
  const hash = await sha256Hex(presented);
  if (timingSafeEqualHex(hash, rec.current.hash)) return 'current';
  if (rec.previous && Date.parse(rec.previous.grace_until) > now) {
    if (timingSafeEqualHex(hash, rec.previous.hash)) return 'previous';
  }
  return 'no_match';
}

export async function readRecord(kv: KVNamespace, key: string = TOKEN_KEY): Promise<TokenRecord | null> {
  const raw = await kv.get(key, 'text');
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as TokenRecord;
  } catch {
    // A corrupt record must not read as "no token" — that would silently fall
    // through to the legacy env leg and look like a working system.
    throw new Error('shelf_token_corrupt');
  }
}

/** Stamp last-used after a report lands. Best-effort: a failed stamp must
 *  never fail the report it is describing. */
export async function stampUsed(
  kv: KVNamespace,
  rec: TokenRecord,
  when: string,
  key: string = TOKEN_KEY,
  slot: 'current' | 'previous' = 'current',
): Promise<void> {
  try {
    // ⚠️ STAMP THE SIDE THAT ACTUALLY AUTHENTICATED. Crediting the current key
    // for a report made with the PREVIOUS one would hide the exact situation
    // the grace window exists to make visible: a rotation nobody finished.
    const side = slot === 'previous' ? rec.previous : rec.current;
    if (!side) return;
    side.last_used_at = when;
    side.use_count = (side.use_count ?? 0) + 1;
    await kv.put(key, JSON.stringify(rec));
  } catch {
    /* the parity number is the payload; its telemetry is not worth a 500 */
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Routes. Both requireDevops() — the same predicate as the runbook page they
// are rendered on, so a caller who can read step 3 can mint the token step 3
// describes, and nobody else can.
// ─────────────────────────────────────────────────────────────────────────────

/** Metadata only. There is deliberately no route that returns the value. */
shelfTokenRoutes.get('/estate/shelf/parity/token', requireDevops(), async (c) => {
  const kv = c.env.estate_docs;
  if (!kv) {
    return c.json({ error: 'docs_kv_unbound', fix: 'add the estate_docs kv_namespaces binding' }, 503);
  }
  let rec: TokenRecord | null;
  try {
    rec = await readRecord(kv);
  } catch {
    return c.json({ error: 'shelf_token_corrupt' }, 500);
  }
  return c.json({
    token: publicView(rec, Date.now()),
    legacy_secret_present: Boolean(c.env.SHELF_PARITY_TOKEN),
  });
});

/**
 * Mint or rotate. Returns the plaintext ONCE, in this response, and never
 * again from anywhere.
 */
shelfTokenRoutes.post('/estate/shelf/parity/token', requireDevops(), async (c) => {
  const kv = c.env.estate_docs;
  if (!kv) {
    return c.json({ error: 'docs_kv_unbound', fix: 'add the estate_docs kv_namespaces binding' }, 503);
  }

  // Body is optional: a bare POST is the ordinary "give me a new one".
  let revokeNow = false;
  try {
    const body = (await c.req.json()) as unknown;
    if (body && typeof body === 'object' && 'revoke_now' in body) {
      revokeNow = (body as { revoke_now?: unknown }).revoke_now === true;
    }
  } catch {
    /* no body, or unparseable — both mean "defaults" */
  }

  let existing: TokenRecord | null;
  try {
    existing = await readRecord(kv);
  } catch {
    return c.json({ error: 'shelf_token_corrupt' }, 500);
  }

  const now = Date.now();
  const token = mintToken();
  const actor = c.get('actor');

  // ⚠️ The OLD current becomes previous — never the old previous. Chaining
  // them would let a token stay alive across repeated rotations, which is the
  // one thing "revoke" must never mean.
  const previous: TokenPrevious | null =
    existing && !revokeNow
      ? {
          // ⚠️ SPREAD THE WHOLE OUTGOING SIDE, not just its hash. Rebuilding it
          // field-by-field is how its created_at and usage history got dropped
          // on every rotation — and the usage history of the key being retired
          // is precisely what says whether anything is still using it.
          ...existing.current,
          grace_until: new Date(now + GRACE_MS).toISOString(),
        }
      : null;

  const rec: TokenRecord = {
    current: {
      hash: await sha256Hex(token),
      fp: fingerprint(token),
      created_at: new Date(now).toISOString(),
      created_by: actor.email,
      last_used_at: null,
      use_count: 0,
    },
    previous,
  };
  await kv.put(TOKEN_KEY, JSON.stringify(rec));

  return c.json({
    token, // ⚠️ the only time this value is ever transmitted
    rotated: existing !== null,
    revoked_immediately: revokeNow,
    previous_valid_until: previous ? previous.grace_until : null,
    env_line: `SHELF_PARITY_TOKEN=${token}`,
    token_view: publicView(rec, now),
  });
});
