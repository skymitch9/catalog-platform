/**
 * MACHINE KEYS — the estate's credential registry, GET /api/estate/keys and
 * POST /api/estate/keys/:id.
 *
 * Owner, 2026-08-20: *"we should put all api key rotation stuff here for our
 * portfolio."* This generalises the shelf parity key (shipped hours earlier,
 * src/shelf-token.ts) into one registry that owns EVERY machine credential the
 * estate holds, and it is deliberately a REGISTRY rather than five copies of
 * one route: five copies is five places for a revoke to be subtly wrong.
 *
 * ── WHY THE REGISTRY LISTS KEYS IT CANNOT ROTATE ────────────────────────────
 *
 * ⚠️ THE TWO MOST POWERFUL CREDENTIALS IN THE ESTATE ARE THE TWO THIS PAGE
 * CANNOT MINT, and omitting them would make the page a liar by silence. A
 * reader who sees seven keys and no caveat concludes those are all of them, and
 * the two missing ones — the token signer and the Firebase service account —
 * are precisely the ones whose rotation actually matters. So `mode: 'manual'`
 * entries appear alongside the rest, carrying the exact command or console step
 * instead of a button. An inventory that is honest about its own edges is worth
 * more than one that looks complete.
 *
 * ── THE THREE MODES ─────────────────────────────────────────────────────────
 *
 *   self-service  Minted here. Only a SHA-256 hash is persisted; the value is
 *                 shown once and can never be read back. The estate owns BOTH
 *                 ends, so rotating cannot strand a third party.
 *
 *   paired        ⚠️ Rotating from this side alone breaks something, so there is
 *                 no button. TWO DIFFERENT REASONS land here and the
 *                 distinction is the useful part:
 *                   • OUTBOUND — this Worker SENDS the value and something
 *                     else verifies it (the pipeline trigger). A grace window
 *                     is useless because the verifier is not this Worker.
 *                   • MULTI-PARTY — the value is installed in several sibling
 *                     Workers at once (the five app tokens), so one rotation
 *                     needs a coordinated redeploy of each.
 *                 Both need a two-phase cutover, which is a design, not a flag.
 *
 *   manual        Cannot be minted by this Worker at all — a Google-issued
 *                 service account, or a signing key whose rotation invalidates
 *                 every token already issued.
 *
 * ── WHAT IS STORED ──────────────────────────────────────────────────────────
 *
 * One KV record per self-service key, at the id in {@link KEY_REGISTRY}:
 *
 *   { current: { hash, fp, created_at, created_by, last_used_at },
 *     previous: { hash, fp, grace_until } | null }
 *
 * The shelf key keeps its original `shelf:parity:token` key so the record
 * written before this refactor is still the record read after it. A registry
 * that renamed its own storage would have silently orphaned the one live key.
 */

import { Hono } from 'hono';
import type { AppBindings, Env } from './env.js';
import { requireDevops } from './middleware/auth.js';
import {
  GRACE_MS,
  fingerprint,
  mintToken,
  publicView,
  readRecord,
  sha256Hex,
  verifyToken,
  type TokenPrevious,
  type TokenRecord,
} from './shelf-token.js';

export const machineKeyRoutes = new Hono<AppBindings>();

export type KeyMode = 'self-service' | 'paired' | 'manual';

export type KeyDef = {
  /** URL-safe id; also the POST path segment. */
  id: string;
  label: string;
  /** The one-line scope shown beside the title. */
  tag: string;
  /** What it is and what it is for, in a sentence a non-author can act on. */
  body: string;
  /** ⚠️ What a leak actually costs. Never "it is secret" — that says nothing. */
  blast: string;
  /** Where the value is installed, so somebody can go and change it. */
  livesAt: string;
  mode: KeyMode;
  /** Searchable prefix for minted values (self-service only). */
  prefix?: string;
  /** KV record key (self-service only). */
  kvKey?: string;
  /** Env binding still accepted as a fallback while a key migrates. */
  legacyEnv?: keyof Env & string;
  /** For paired/manual: the exact thing to run, and why there is no button. */
  manualFix?: string;
  manualWhy?: string;
};

/**
 * ⚠️ THE ORDER IS BLAST RADIUS, SMALLEST FIRST. A reader scanning this page
 * should meet the harmless key before the one that is root-equivalent, not
 * discover the service account at the bottom after deciding the page is boring.
 */
export const KEY_REGISTRY: KeyDef[] = [
  {
    id: 'shelf-parity',
    label: 'Shelf parity reporter',
    tag: 'writes one number, one route',
    body: 'Used by 03-shelf-parity.sh on the shelf server to post how many books match Drive.',
    blast: 'A leaked one can report a false number and nothing else. It cannot read the library, cannot pass the Google gate, and is accepted on no other route.',
    livesAt: '/srv/shelf/.parity.env on the shelf server (hardware outside the estate)',
    mode: 'self-service',
    prefix: 'shelfpar_',
    kvKey: 'shelf:parity:token',
    legacyEnv: 'SHELF_PARITY_TOKEN',
  },
  {
    id: 'worker-events',
    label: 'Worker event ring',
    tag: 'appends to a log',
    body: 'Lets the estate’s Workers append their own errors and notable events to the shared ring the status pages read.',
    blast: 'A leaked one can write noise into the event ring — a trust problem for the log, not a disclosure. It reads nothing.',
    livesAt: 'the other Workers’ secrets; custody note in docs/access/keys/',
    mode: 'self-service',
    prefix: 'evt_',
    kvKey: 'estate:events:token',
    legacyEnv: 'ESTATE_EVENTS_TOKEN',
  },
  {
    id: 'pipeline-trigger',
    label: 'Pipeline trigger',
    tag: 'starts a run on the home machine',
    body: 'The bearer the home watcher checks before acting on a run request from /status/pipelines.',
    blast: '⚠️ A leaked one can START PIPELINE RUNS on the home machine — GPU time and real writes to the catalogue. It still cannot read anything back through this Worker.',
    livesAt: 'the watcher’s .env on the home machine',
    mode: 'paired',
    legacyEnv: 'PIPELINE_TRIGGER_TOKEN',
    manualWhy:
      '⚠️ THIS ONE IS OUTBOUND, WHICH IS WHY IT HAS NO BUTTON. Every other key here is one this Worker CHECKS, so a grace window can accept the old and new value at once while the far side catches up. This value is one the Worker SENDS — it is written into the Firestore request document and the watcher on the home machine compares it against its own .env. Minting a new one here would make the Worker start sending a value the watcher does not know, instantly and with no overlap, because the verifier is not this Worker. A grace window cannot protect a cutover it does not sit on.',
    manualFix:
      'Change it in the watcher’s .env FIRST, then: npx wrangler secret put PIPELINE_TRIGGER_TOKEN',
  },
  {
    id: 'conductor',
    label: 'Conductor push bearer',
    tag: 'rewrites the agent board',
    body: 'Used by the conductor session to push the agent-board snapshot that /status/agents renders.',
    blast: '⚠️ A leaked one can REWRITE THE AGENT BOARD — i.e. make the estate’s picture of what Claude is doing say anything at all. The board is a trust surface; treat this as the largest of the three the estate can mint here.',
    livesAt: 'the conductor’s environment on the owner’s machine',
    mode: 'self-service',
    prefix: 'cond_',
    kvKey: 'estate:conductor:token',
    legacyEnv: 'ESTATE_CONDUCTOR_TOKEN',
  },
  {
    id: 'app-tokens',
    label: 'App-to-app tokens (×5)',
    tag: 'library · games · index · audiobook · discord-docs',
    body: 'One shared bearer per sibling service, so each can call the estate’s APIs as itself.',
    blast: 'Scoped to one calling service each. A leak lets someone impersonate that service to this Worker.',
    livesAt: '⚠️ BOTH SIDES — here as ESTATE_APP_TOKEN_*, and in the calling Worker’s own secrets',
    mode: 'paired',
    manualWhy: 'These ARE inbound-verified, so the grace window would technically work — the honest blocker is coordination, not mechanism. Each value also lives in a sibling Worker’s secrets, so five keys means five other services to redeploy inside the window, and a rotation somebody starts and does not finish leaves an integration that fails the moment the grace expires. Worth doing per-service, deliberately, not from one button that rotates all five.',
    manualFix: 'npx wrangler secret put ESTATE_APP_TOKEN_<SERVICE>   # in apps/auth-worker AND the calling service, in that order',
  },
  {
    id: 'token-signer',
    label: 'Token signing key',
    tag: 'signs every issued token',
    body: 'The key this Worker signs its own issued tokens with.',
    blast: '⚠️ A leak lets someone MINT TOKENS THIS ESTATE WILL TRUST. This is the largest credential the Worker itself holds.',
    livesAt: 'TOKEN_SIGNER_KEY, a Worker secret',
    mode: 'manual',
    manualWhy: '⚠️ Rotating it INVALIDATES EVERY TOKEN ALREADY ISSUED — everyone signed in is signed out, and every machine holding a signed token fails at once. Safe rotation needs a dual-key overlap (verify against old AND new while the old ages out) that does not exist yet. A button here would be an estate-wide sign-out wearing the same styling as the shelf key.',
    manualFix: 'npx wrangler secret put TOKEN_SIGNER_KEY   # only with the overlap design in place',
  },
  {
    id: 'firebase-sa',
    label: 'Firebase service account',
    tag: 'Google-issued · not ours to mint',
    body: 'The service-account credential this Worker uses to reach Firebase.',
    blast: '⚠️ Full programmatic access to the Firebase project under that account’s roles. The widest credential in the estate.',
    livesAt: 'FIREBASE_SERVICE_ACCOUNT, a Worker secret; issued by Google',
    mode: 'manual',
    manualWhy: 'Google issues and revokes it, not this Worker. There is nothing for a button here to do — minting a replacement happens in the Google Cloud console, and the old key must be DELETED there or rotation has only added a second working credential.',
    manualFix: 'Google Cloud console → IAM & Admin → Service Accounts → Keys → Add key, then DELETE the old one, then: npx wrangler secret put FIREBASE_SERVICE_ACCOUNT',
  },
];

export function keyById(id: string): KeyDef | undefined {
  return KEY_REGISTRY.find((k) => k.id === id);
}

/**
 * Verify a presented bearer for one registry entry: the hashed key first, then
 * the legacy env value while one is still installed.
 *
 * ⚠️ USED BY EVERY MIGRATED ROUTE, so the fallback lives in exactly one place.
 * The alternative — each route doing its own two-step — is how one of them ends
 * up checking only the legacy leg forever and quietly never honouring a
 * rotation.
 */
export async function verifyRegistryKey(
  kv: KVNamespace | undefined,
  def: KeyDef,
  presented: string,
  legacyValue: string | undefined,
  now: number,
): Promise<'current' | 'previous' | 'legacy' | 'no_match'> {
  if (!presented) return 'no_match';
  if (kv && def.kvKey) {
    let rec: TokenRecord | null = null;
    try {
      rec = await readRecord(kv, def.kvKey);
    } catch {
      // A corrupt record must never fall through to the legacy leg as if no
      // key existed — that reads as a working system while rotation is broken.
      throw new Error('machine_key_corrupt');
    }
    const verdict = await verifyToken(rec, presented, now);
    if (verdict !== 'no_match') return verdict;
  }
  if (legacyValue && presented === legacyValue) return 'legacy';
  return 'no_match';
}

/**
 * The one auth entry point every migrated route uses: verify a bearer for a
 * registry entry and, when it fails, say WHICH cause so the caller gets the
 * right sentence.
 *
 * ⚠️ `secret_unset` IS DOWNGRADED TO `bad_token` WHENEVER A MINTED KEY EXISTS.
 * Without that, a caller presenting a wrong bearer to a route whose legacy env
 * secret has been removed is told "this Worker holds no token, go run wrangler
 * secret put" — confidently wrong directions pointing at a credential that is
 * deliberately gone. The estate has already shipped that bug once, on the
 * parity route, and this is where it stops being possible to ship again.
 *
 * ⚠️ RETURNS THE VERDICT TOO, so a route can tell a caller they authenticated
 * on the PREVIOUS key. That is the signal that a rotation was started and never
 * finished, and it is invisible unless something says it out loud.
 */
export async function checkRegistryAuth(
  kv: KVNamespace | undefined,
  def: KeyDef,
  header: string | null,
  legacyValue: string | undefined,
  now: number = Date.now(),
): Promise<{ ok: true; via: 'current' | 'previous' | 'legacy' } | { ok: false; cause: 'secret_unset' | 'no_header' | 'bad_token' }> {
  const raw = (header ?? '').trim();
  const presented = /^Bearer\s+(.+)$/i.exec(raw)?.[1]?.trim() ?? '';

  let minted: TokenRecord | null = null;
  if (kv && def.kvKey) {
    try {
      minted = await readRecord(kv, def.kvKey);
    } catch {
      throw new Error('machine_key_corrupt');
    }
  }

  // Nothing to check against at all is a CONFIG fault, not a caller fault.
  if (minted === null && !legacyValue) return { ok: false, cause: 'secret_unset' };
  if (!presented) return { ok: false, cause: 'no_header' };

  const verdict = await verifyToken(minted, presented, now);
  if (verdict !== 'no_match') return { ok: true, via: verdict };
  if (legacyValue && presented === legacyValue) return { ok: true, via: 'legacy' };
  return { ok: false, cause: 'bad_token' };
}

/** The whole registry as the UI sees it — definitions plus, for self-service
 *  entries, the safe half of the stored record. Never a hash, never a value. */
machineKeyRoutes.get('/estate/keys', requireDevops(), async (c) => {
  const kv = c.env.estate_docs;
  if (!kv) {
    return c.json({ error: 'docs_kv_unbound', fix: 'add the estate_docs kv_namespaces binding' }, 503);
  }
  const now = Date.now();
  const keys = [];
  for (const def of KEY_REGISTRY) {
    const { kvKey, legacyEnv, prefix, ...pub } = def;
    let view: ReturnType<typeof publicView> | null = null;
    let corrupt = false;
    if (def.mode === 'self-service' && kvKey) {
      try {
        view = publicView(await readRecord(kv, kvKey), now);
      } catch {
        corrupt = true;
      }
    }
    keys.push({
      ...pub,
      token: view,
      corrupt,
      legacy_present: legacyEnv ? Boolean(c.env[legacyEnv]) : false,
    });
  }
  return c.json({ keys });
});

/** Mint or rotate one self-service key. Returns the plaintext ONCE. */
machineKeyRoutes.post('/estate/keys/:id', requireDevops(), async (c) => {
  const def = keyById(c.req.param('id'));
  if (!def) return c.json({ error: 'unknown_key', detail: 'No machine key by that name.' }, 404);

  if (def.mode !== 'self-service' || !def.kvKey) {
    // ⚠️ A worded refusal, not a 404 or a bare 400: the caller pressed a
    // control for a key that deliberately has no button, and the reason is the
    // whole point of listing it.
    return c.json(
      {
        error: 'not_self_service',
        detail: def.manualWhy ?? 'This credential is not minted by this Worker.',
        fix: def.manualFix,
      },
      400,
    );
  }

  const kv = c.env.estate_docs;
  if (!kv) {
    return c.json({ error: 'docs_kv_unbound', fix: 'add the estate_docs kv_namespaces binding' }, 503);
  }

  let revokeNow = false;
  try {
    const body = (await c.req.json()) as unknown;
    if (body && typeof body === 'object' && 'revoke_now' in body) {
      revokeNow = (body as { revoke_now?: unknown }).revoke_now === true;
    }
  } catch {
    /* no body means defaults */
  }

  let existing: TokenRecord | null;
  try {
    existing = await readRecord(kv, def.kvKey);
  } catch {
    return c.json({ error: 'machine_key_corrupt' }, 500);
  }

  const now = Date.now();
  const token = mintToken(def.prefix);
  const actor = c.get('actor');

  // The outgoing CURRENT becomes previous — never the outgoing previous, or a
  // key could stay alive indefinitely by rotating often enough.
  const previous: TokenPrevious | null =
    existing && !revokeNow
      ? {
          hash: existing.current.hash,
          fp: existing.current.fp,
          grace_until: new Date(now + GRACE_MS).toISOString(),
        }
      : null;

  const rec: TokenRecord = {
    current: {
      hash: await sha256Hex(token),
      fp: fingerprint(token, def.prefix),
      created_at: new Date(now).toISOString(),
      created_by: actor.email,
      last_used_at: null,
    },
    previous,
  };
  await kv.put(def.kvKey, JSON.stringify(rec));

  return c.json({
    token, // ⚠️ the only time this value is ever transmitted
    id: def.id,
    rotated: existing !== null,
    revoked_immediately: revokeNow,
    previous_valid_until: previous ? previous.grace_until : null,
    env_line: `${def.legacyEnv ?? 'TOKEN'}=${token}`,
    token_view: publicView(rec, now),
  });
});
