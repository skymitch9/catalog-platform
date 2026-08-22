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
  /** ⚠️ URL-safe id; also the POST path segment. NOT the display name —
   *  renaming `label` is cosmetic, renaming this changes a route. */
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
  /** For paired/manual: why there is no button. */
  manualWhy?: string;
  /** ⚠️ WHERE THE VALUE COMES FROM. Not the same question as where it lives:
   *  a key nobody can say the ORIGIN of is a key nobody can correctly replace. */
  origin: string;
  /** The rotation procedure, in the order the steps must happen. */
  rotateHow: string;
  /** ⚠️ Where a freshly minted value actually GOES, per key. This used to be
   *  one shared "installing a key" accordion at the bottom of the page, which
   *  could only describe the shelf server concretely and left the other two as
   *  an exercise — generic instructions for a specific credential are how
   *  somebody pastes a key into the wrong place. */
  installHow?: string;
  /** The exact command, when there is one. */
  manualFix?: string;
};

/**
 * ⚠️ THE ORDER IS BLAST RADIUS, SMALLEST FIRST. A reader scanning this page
 * should meet the harmless key before the one that is root-equivalent, not
 * discover the service account at the bottom after deciding the page is boring.
 */
export const KEY_REGISTRY: KeyDef[] = [
  {
    id: 'shelf-parity',
    label: 'Shelf server reporter',
    tag: 'writes one number, one route',
    body: 'Used by 03-shelf-parity.sh on the shelf server to post how many books match Drive.',
    blast: 'A leaked one can report a false number and nothing else. It cannot read the library, cannot pass the Google gate, and is accepted on no other route.',
    livesAt: '/srv/shelf/.parity.env on the shelf server (hardware outside the estate)',
    mode: 'self-service',
    prefix: 'shelfpar_',
    kvKey: 'shelf:parity:token',
    legacyEnv: 'SHELF_PARITY_TOKEN',
    installHow: `On the shelf server:
  echo 'SHELF_PARITY_TOKEN=<the value>' | sudo tee /srv/shelf/.parity.env
  sudo chmod 600 /srv/shelf/.parity.env
Then check it landed without printing it:
  sudo test -s /srv/shelf/.parity.env && echo 'token file present'
Run ./03-shelf-parity.sh once, then reload this page — Last used should show a moment ago.`,
    origin: 'Minted on this page — 32 bytes of CSPRNG as base64url, stored only as a SHA-256 hash. The original was hand-minted and DM’d; that one is the legacy fallback and should be deleted once a minted key shows a Last used.',
    rotateHow: 'Generate above → paste into /srv/shelf/.parity.env on the shelf server → chmod 600. The old key keeps working 24 h, so nothing goes dark if the paste goes wrong.',
  },
  {
    id: 'shelf-config',
    label: 'Shelf connection reader',
    tag: 'reads four config values, one route',
    body: "Used by audiobook_catalog/scripts/sync_to_server.py on the pipeline PC to read where Justin's box is - host, path, ssh user, port - so those never have to be relayed through a chat message and hand-copied into a .env.",
    blast: "A leaked one can READ a tailnet hostname, a unix username, a path and a port. It writes nothing and is accepted on no other route. ⚠️ Worth being honest about what that is: those four are CONFIG, not credentials - knowing them gets you nowhere without the SSH private key, which lives only on the pipeline PC and is not in this estate at all. It is still a disclosure, which is why the route is gated rather than public.",
    livesAt: "the pipeline PC's environment (SHELF_CONFIG_TOKEN), beside the SSH key it pairs with",
    mode: 'self-service',
    prefix: 'shelfcfg_',
    kvKey: 'shelf:config:token',
    installHow: `On the pipeline PC (the owner's machine):
  setx SHELF_CONFIG_TOKEN "<the value>"      # new shells only
Then check the pipeline can read the config, without printing it:
  python scripts/sync_to_server.py --dry-run
"not configured" means the four values are still blank in the form; an auth
error means the token did not land.`,
    origin: 'Minted on this page - 32 bytes of CSPRNG as base64url, stored only as a SHA-256 hash. There is no legacy value: this key was born self-service.',
    rotateHow: 'Generate above, then setx SHELF_CONFIG_TOKEN on the pipeline PC. The old key keeps working 24 h, so a bad paste does not strand the push.',
  },
  {
    id: 'claude-usage',
    label: 'Claude usage reporter',
    tag: 'writes four percentages, one route',
    body: 'Used by a Claude session to post what it just read off claude.ai/settings/usage, so /status can show where the budget stands without anyone asking.',
    blast: 'A leaked one can post a FALSE budget reading and nothing else. It reads nothing, grants nothing, and is accepted on no other route. ⚠️ It is still a TRUST surface: a wrong number here gets believed and a run gets started that should not have been.',
    livesAt: 'the reporting session’s environment on the owner’s machine (CLAUDE_USAGE_TOKEN)',
    mode: 'self-service',
    prefix: 'clu_',
    kvKey: 'claude:usage:token',
    installHow: `Put it in the environment the reporter reads, on the owner's machine:
  setx CLAUDE_USAGE_TOKEN "<the value>"      # new shells only
Then post one reading and reload this page — Last used should show a moment ago:
  node scripts/report-claude-usage.mjs --session 2 --weekly 93 --fable 94 --credits 63
⚠️ There is no legacy fallback for this key: until it is installed, nothing can report.`,
    origin: 'Minted on this page — 32 bytes of CSPRNG as base64url, stored only as a SHA-256 hash. It has no hand-minted predecessor; this key was self-service from the day it shipped.',
    rotateHow: 'Generate above → set CLAUDE_USAGE_TOKEN in the reporting session’s environment within the 24 h grace window. Nothing else holds it, so a rotation here cannot strand another service.',
  },
  {
    id: 'worker-events',
    label: 'Service event log',
    tag: 'appends to a log',
    body: 'Lets the estate’s Workers append their own errors and notable events to the shared ring the status pages read.',
    blast: 'A leaked one can write noise into the event ring — a trust problem for the log, not a disclosure. It reads nothing.',
    livesAt: 'the other Workers’ secrets; custody note in docs/access/keys/',
    mode: 'self-service',
    prefix: 'evt_',
    kvKey: 'estate:events:token',
    legacyEnv: 'ESTATE_EVENTS_TOKEN',
    installHow: `Set it on every Worker that pushes events — auth-worker, index-worker and audiobook-worker — from each app directory:
  npx wrangler secret put ESTATE_EVENTS_TOKEN
⚠️ Use the file-redirect transport, never a PowerShell pipe: a piped secret picks up an invisible BOM and the stored value is wrong while looking perfect. Finish all three inside the 24 h grace window.`,
    origin: 'Minted on this page. The legacy value predates it and was conductor-minted with `openssl rand -hex 32`; a custody copy is docs/access/keys/estate-events-token.txt.',
    rotateHow: 'Generate above → update the sibling Workers that push events (wrangler secret put in each) within the 24 h grace window.',
  },
  {
    id: 'pipeline-trigger',
    label: 'Book pipeline trigger',
    tag: 'starts a run on the home machine',
    body: 'The bearer the home watcher checks before acting on a run request from /status/pipelines.',
    blast: '⚠️ A leaked one can START PIPELINE RUNS on the home machine — GPU time and real writes to the catalogue. It still cannot read anything back through this Worker.',
    livesAt: 'the watcher’s .env on the home machine',
    mode: 'paired',
    legacyEnv: 'PIPELINE_TRIGGER_TOKEN',
    manualWhy:
      '⚠️ THIS ONE IS OUTBOUND, WHICH IS WHY IT HAS NO BUTTON. Every other key here is one this Worker CHECKS, so a grace window can accept the old and new value at once while the far side catches up. This value is one the Worker SENDS — it is written into the Firestore request document and the watcher on the home machine compares it against its own .env. Minting a new one here would make the Worker start sending a value the watcher does not know, instantly and with no overlap, because the verifier is not this Worker. A grace window cannot protect a cutover it does not sit on.',
    origin: '⚠️ Generated by hand and installed on BOTH sides; no generation method is recorded anywhere in the repo. Use `openssl rand -hex 32` to match the estate’s other bearers.',
    rotateHow: 'Change it in the watcher’s .env on the home machine FIRST — the watcher is the verifier, so it must be able to accept the new value before the Worker starts sending it — then: npx wrangler secret put PIPELINE_TRIGGER_TOKEN',
    manualFix: 'npx wrangler secret put PIPELINE_TRIGGER_TOKEN   # AFTER the watcher’s .env',
  },
  {
    id: 'conductor',
    label: 'Agent board publisher',
    tag: 'rewrites the agent board',
    body: 'Used by the conductor session to push the agent-board snapshot that /status/agents renders.',
    blast: '⚠️ A leaked one can REWRITE THE AGENT BOARD — i.e. make the estate’s picture of what Claude is doing say anything at all. The board is a trust surface; treat this as the largest of the three the estate can mint here.',
    livesAt: 'the conductor’s environment on the owner’s machine',
    mode: 'self-service',
    prefix: 'cond_',
    kvKey: 'estate:conductor:token',
    legacyEnv: 'ESTATE_CONDUCTOR_TOKEN',
    installHow: `Put it in the conductor's environment on the owner's machine (the value scripts/push-agent-board.mjs reads), then push the board once and reload this page — Last used should show a moment ago. Finish inside the 24 h grace window.`,
    origin: 'Minted on this page. The legacy value was conductor-minted with `openssl rand -hex 32`; custody copy at docs/access/keys/estate-conductor-token.txt.',
    rotateHow: 'Generate above → update the conductor’s environment on the owner’s machine within the 24 h grace window.',
  },
  {
    id: 'app-tokens',
    label: 'Sister service keys (×5)',
    tag: 'library · games · index · audiobook · discord-docs',
    body: 'One shared bearer per sibling service, so each can call the estate’s APIs as itself.',
    blast: 'Scoped to one calling service each. A leak lets someone impersonate that service to this Worker.',
    livesAt: '⚠️ BOTH SIDES — here as ESTATE_APP_TOKEN_*, and in the calling Worker’s own secrets',
    mode: 'paired',
    manualWhy: 'These ARE inbound-verified, so the grace window would technically work — the honest blocker is coordination, not mechanism. Each value also lives in a sibling Worker’s secrets, so five keys means five other services to redeploy inside the window, and a rotation somebody starts and does not finish leaves an integration that fails the moment the grace expires. Worth doing per-service, deliberately, not from one button that rotates all five.',
    origin: '⚠️ Generated by hand, one per sibling service; no generation method is recorded. Use `openssl rand -hex 32`.',
    rotateHow: 'One service at a time. Mint a value → set it on THIS Worker → set the same value on the calling service → redeploy that service. Do not start a second service until the first is verified.',
    manualFix: 'npx wrangler secret put ESTATE_APP_TOKEN_<SERVICE>   # here AND in the calling service',
  },
  {
    id: 'token-signer',
    label: 'Sign-in token signer',
    tag: 'Google-issued · impersonation-capable',
    body: 'A service-account KEY for the estate-token-minter account, used to sign the short-lived Firebase custom tokens the SSO convenience layer issues.',
    blast: '⚠️ Possessing this value IS the capability: it can sign a token for ANY uid and produce a normal Firebase session as any estate member, including the owner. It grants no Google Cloud IAM permission and is not a Firestore-admin credential — a custom-token session is an ordinary user session, still subject to Firestore rules.',
    livesAt: 'TOKEN_SIGNER_KEY, a Worker secret',
    mode: 'manual',
    manualWhy: 'Google issues it, not this Worker — there is nothing for a button here to mint. It is NOT dangerous to rotate: Google lets a service account hold two valid keys at once, so the overlap is native and there is no outage window.',
    origin: 'Google Cloud console → IAM & Admin → Service Accounts → the estate-token-minter account → Keys. Google generates it; the estate never does.',
    rotateHow: '⚠️ ROUTINE, AND DOCUMENTED IN FULL at docs/access/estate-auth.md §3.4 — recommended yearly, or whenever someone with console access leaves the household. Create a SECOND key in the console (both work at once, no outage) → wrangler secret put TOKEN_SIGNER_KEY → wrangler deploy → verify with tools/estate-probes/run.mjs → ONLY THEN delete the old key. The tokens it signs are 5-minute-lived, so anything in flight has expired before a human finishes the steps.',
    manualFix: 'npx wrangler secret put TOKEN_SIGNER_KEY   # after creating the second key in the console',
  },
  {
    id: 'firebase-sa',
    label: 'Firebase admin credential',
    tag: 'Google-issued · not ours to mint',
    body: 'The service-account credential this Worker uses to reach Firebase.',
    blast: '⚠️ Full programmatic access to the Firebase project under that account’s roles. The widest credential in the estate.',
    livesAt: 'FIREBASE_SERVICE_ACCOUNT, a Worker secret; issued by Google',
    mode: 'manual',
    manualWhy: 'Google issues and revokes it, not this Worker. There is nothing for a button here to do — minting a replacement happens in the Google Cloud console, and the old key must be DELETED there or rotation has only added a second working credential.',
    origin: 'Google Cloud console → IAM & Admin → Service Accounts → Keys. Google generates it; the estate never does.',
    rotateHow: 'Same two-key overlap as the signing key: create a SECOND key in the console → npx wrangler secret put FIREBASE_SERVICE_ACCOUNT → deploy → verify → ONLY THEN delete the old key in the console. ⚠️ Deleting the old one is part of the rotation, not optional cleanup — skip it and you have simply added a second working credential.',
    manualFix: 'npx wrangler secret put FIREBASE_SERVICE_ACCOUNT   # after creating the second key in the console',
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
    const { kvKey, legacyEnv, prefix, ...pub } = def; // installHow rides along in pub
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
      fp: fingerprint(token, def.prefix),
      created_at: new Date(now).toISOString(),
      created_by: actor.email,
      last_used_at: null,
      use_count: 0,
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

/**
 * Revoke a live key WITHOUT minting a replacement.
 *
 * ⚠️ THIS EXISTS BECAUSE ROTATION WAS THE ONLY WAY TO KILL ANYTHING, and it
 * cannot kill the CURRENT key: every rotate mints a new current, so a key
 * created by mistake could only ever be replaced by another one. Testing the
 * revocation path left four live test keys behind and no way to remove the
 * last one — the gap the owner hit directly.
 *
 * `slot` is explicit rather than inferred:
 *   previous — end a grace window early; the current key is untouched.
 *   current  — kill the newest key. ⚠️ If a previous is still in its window it
 *              STAYS VALID and is promoted, because silently killing a key the
 *              caller did not name would be a bigger surprise than leaving it.
 *   all      — remove the record entirely. The route then accepts only the
 *              legacy env secret, if one is still installed.
 *
 * ⚠️ `all` ON A KEY WITH NO LEGACY SECRET LEAVES NOTHING THAT CAN AUTHENTICATE
 * until somebody mints again. That is a real outage for whatever machine uses
 * it, so the response says so plainly rather than reporting a bare success.
 */
// ⚠️ A POST SUB-ROUTE, NOT `DELETE`. This shipped as DELETE and was blocked at
// the CORS PREFLIGHT — adminCors() allows GET, POST and OPTIONS, so the browser
// refused before the Worker ever saw it, and the UI reported it as a network
// failure. Widening the shared CORS methods for every admin route in the estate
// to serve one button is the wrong trade; a POST verb the allow-list already
// permits costs nothing and keeps the blast radius of the config unchanged.
machineKeyRoutes.post('/estate/keys/:id/revoke', requireDevops(), async (c) => {
  const def = keyById(c.req.param('id'));
  if (!def) return c.json({ error: 'unknown_key', detail: 'No machine key by that name.' }, 404);
  if (def.mode !== 'self-service' || !def.kvKey) {
    return c.json(
      { error: 'not_self_service', detail: def.manualWhy ?? 'This credential is not managed by this Worker.', fix: def.manualFix },
      400,
    );
  }

  const kv = c.env.estate_docs;
  if (!kv) {
    return c.json({ error: 'docs_kv_unbound', fix: 'add the estate_docs kv_namespaces binding' }, 503);
  }

  let slot: 'current' | 'previous' | 'all' = 'current';
  try {
    const body = (await c.req.json()) as { slot?: unknown };
    if (body && (body.slot === 'previous' || body.slot === 'all' || body.slot === 'current')) {
      slot = body.slot;
    }
  } catch {
    /* default */
  }

  let rec: TokenRecord | null;
  try {
    rec = await readRecord(kv, def.kvKey);
  } catch {
    return c.json({ error: 'machine_key_corrupt' }, 500);
  }
  if (!rec) return c.json({ error: 'no_key', detail: 'There is no minted key to revoke.' }, 404);

  const now = Date.now();
  const prevLive = rec.previous && Date.parse(rec.previous.grace_until) > now ? rec.previous : null;
  const legacy = def.legacyEnv ? Boolean(c.env[def.legacyEnv]) : false;

  if (slot === 'all') {
    await kv.delete(def.kvKey);
    return c.json({
      revoked: 'all',
      remaining: 0,
      legacy_still_accepted: legacy,
      warning: legacy
        ? 'Every minted key is gone. Only the original hand-installed secret still works.'
        : '⚠️ Nothing can authenticate on this route now. Generate a key and install it.',
      token_view: publicView(null, now),
    });
  }

  if (slot === 'previous') {
    if (!prevLive) return c.json({ error: 'no_previous', detail: 'No previous key is in its grace window.' }, 404);
    rec.previous = null;
    await kv.put(def.kvKey, JSON.stringify(rec));
    return c.json({ revoked: 'previous', remaining: 1, legacy_still_accepted: legacy, token_view: publicView(rec, now) });
  }

  // slot === 'current'
  if (prevLive) {
    // Promote the still-valid previous rather than killing it unasked.
    const promoted: TokenRecord = { current: { ...prevLive }, previous: null };
    delete (promoted.current as Partial<TokenPrevious>).grace_until;
    await kv.put(def.kvKey, JSON.stringify(promoted));
    return c.json({
      revoked: 'current',
      remaining: 1,
      promoted_previous: true,
      note: 'The previous key was still in its grace window, so it is now the only key. It was not revoked, because you did not ask for that.',
      legacy_still_accepted: legacy,
      token_view: publicView(promoted, now),
    });
  }

  await kv.delete(def.kvKey);
  return c.json({
    revoked: 'current',
    remaining: 0,
    legacy_still_accepted: legacy,
    warning: legacy
      ? 'No minted key remains. Only the original hand-installed secret still works.'
      : '⚠️ Nothing can authenticate on this route now. Generate a key and install it.',
    token_view: publicView(null, now),
  });
});
