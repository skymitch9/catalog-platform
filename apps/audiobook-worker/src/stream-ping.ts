/**
 * `POST /api/audio/:anchor/stream-ping` — eviction access timestamp.
 * **Audio player phase 2**, 2026-08-19.
 *
 * Design: `docs/info/audio-player-design.md` §10.1 — when a stream is
 * accessed, stamp `audio_streams/{anchor}` in Firestore with
 * `last_accessed_at`. This tells the evictor which files are actually being
 * listened to, so an idle file can be deleted and re-uploaded on request.
 *
 * ## Throttling
 *
 * The CLIENT sends at most once per 10 minutes (audio-player.js §5). This
 * endpoint adds a SERVER-SIDE throttle: one Firestore write per anchor per
 * 10 minutes, across all callers. A client bug or a replay cannot produce
 * a write storm.
 *
 * ## The gate is the same one
 *
 * Same `resolveEbookAccess` — if you can listen, you can ping. A caller who
 * cannot listen cannot ping (and has nothing to ping about).
 *
 * ## Firestore rules note (NOT YET DEPLOYED)
 *
 * This route writes via the Firebase service account, which bypasses client
 * rules. However, for completeness, the clause needed if the SA ever moves
 * to client credentials would be:
 *
 * ```
 * match /audio_streams/{anchor} {
 *   allow write: if request.auth != null
 *     && request.resource.data.keys().hasOnly(['last_accessed_at', 'anchor', 'updatedBy'])
 *     && request.resource.data.last_accessed_at is timestamp;
 * }
 * ```
 *
 * ⚠️ For v1, the SA bypasses rules. The above is recorded for documentation.
 */

import { Hono } from 'hono';
import { resolveEbookAccess } from './ebook-gate.js';
import { audioIndex } from './audio-manifest.js';
import { parseServiceAccount } from '@platform/firebase-sa';
import type { Env } from './env.js';

export const streamPingRoutes = new Hono<{ Bindings: Env }>();

/**
 * Per-anchor throttle: at most one Firestore write per 10 minutes.
 * Module-level state, same pattern as listen-budget.ts.
 */
const THROTTLE_MS = 10 * 60 * 1000;
const lastWriteByAnchor = new Map<string, number>();

/** Tests only. */
export function resetStreamPingThrottle(): void {
  lastWriteByAnchor.clear();
}

streamPingRoutes.post('/api/audio/:anchor/stream-ping', async (c) => {
  // 1. Gate — same as every audio route.
  const gate = await resolveEbookAccess(c);
  if (!gate.ok) return gate.response;
  const { email } = gate.access;

  const anchor = (c.req.param('anchor') ?? '').trim();
  if (!anchor) {
    return c.json({ error: 'no_anchor', detail: 'No book anchor provided.' }, 400);
  }

  // 1b. ⚠️ THE ANCHOR IS A LOOKUP, NEVER A CONSTRUCTION — the same rule
  //     audio-manifest.ts states and audio-file.ts obeys. The `:anchor` in the
  //     URL is a client-supplied string; interpolating it straight into the
  //     Firestore document path (as the earlier code did) let an admitted
  //     caller pick which document the rules-bypassing service account writes
  //     — a `%2F`/`%23` payload escapes the `audio_streams` collection and
  //     drops the update mask. So validate it against the gated manifest and
  //     404 on a miss, exactly as the byte route does; only a known anchor may
  //     name a Firestore document. (audit F3, 2026-08.)
  const gatedBucket = c.env.EBOOKS_GATED;
  if (!gatedBucket) {
    // Cannot validate the anchor without the catalogue — a deployment problem.
    // Fail closed: no unvalidated string reaches the Firestore path.
    return c.json(
      {
        error: 'manifest_store_unbound',
        detail: 'The catalogue is not attached to this Worker, so the ping cannot be recorded.',
        fix: 'add the [[r2_buckets]] EBOOKS_GATED binding (bucket ebooks-gated) and redeploy',
      },
      503,
    );
  }
  const idx = await audioIndex(gatedBucket);
  if (!idx.ok) {
    // The manifest is absent or unreadable, so the anchor cannot be validated.
    // Non-fatal (the player still plays) and fail-closed: record nothing.
    return new Response(null, { status: 204 });
  }
  if (!idx.index.has(anchor)) {
    // ⚠️ 404, never a write. An anchor absent from the manifest is a fact
    // about the LINK, not the caller — and no client-supplied byte ever
    // reaches the Firestore path, the way audio-file.ts refuses an unknown
    // book. This is the line that closes the path-injection.
    return c.json(
      { error: 'unknown_book', detail: 'No audiobook matches that link.' },
      404,
    );
  }

  // 2. Throttle — server-side, per anchor.
  const now = Date.now();
  const lastWrite = lastWriteByAnchor.get(anchor) ?? 0;
  if (now - lastWrite < THROTTLE_MS) {
    // Already written recently — 204 (success, no body, no Firestore write).
    return new Response(null, { status: 204 });
  }

  // 3. Write to Firestore: audio_streams/{anchor}.last_accessed_at
  const saJson = c.env.FIREBASE_SERVICE_ACCOUNT;
  if (!saJson) {
    // No SA — cannot write. Non-fatal: the player still plays, just no stamp.
    return c.json(
      { error: 'service_account_unset', detail: 'Stream ping could not be recorded — no service account.' },
      503,
    );
  }

  let sa;
  try {
    sa = parseServiceAccount(saJson);
  } catch (err) {
    return c.json(
      { error: 'misconfigured', detail: (err as Error).message },
      500,
    );
  }

  if (!sa) {
    return c.json(
      { error: 'service_account_unset', detail: 'Service account is empty.' },
      503,
    );
  }

  // Mint a Firestore-scoped access token from the SA.
  const projectId = sa.project_id;
  const accessToken = await mintFirestoreToken(sa);
  if (!accessToken) {
    return c.json(
      { error: 'token_mint_failed', detail: 'Could not mint a Firestore token.' },
      503,
    );
  }

  // Write the document via REST (lighter than importing the Admin SDK).
  // ⚠️ encodeURIComponent regardless — the anchor is manifest-validated above,
  // but a document-path component is still never built from a raw client
  // string. Belt to the lookup's braces.
  const docPath = `audio_streams/${encodeURIComponent(anchor)}`;
  const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${docPath}`;

  const body = {
    fields: {
      last_accessed_at: { timestampValue: new Date(now).toISOString() },
      anchor: { stringValue: anchor },
      updatedBy: { stringValue: email },
    },
  };

  try {
    const res = await fetch(firestoreUrl + '?updateMask.fieldPaths=last_accessed_at&updateMask.fieldPaths=anchor&updateMask.fieldPaths=updatedBy', {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (res.ok || res.status === 200) {
      lastWriteByAnchor.set(anchor, now);
      return new Response(null, { status: 204 });
    }

    // Non-fatal — the player still plays.
    const errBody = await res.text().catch(() => '');
    console.error('[stream-ping] Firestore write failed:', res.status, errBody);
    return new Response(null, { status: 204 });
  } catch (e) {
    // Network errors writing to Firestore are non-fatal.
    console.error('[stream-ping] Firestore write error:', e);
    return new Response(null, { status: 204 });
  }
});

// ─── Token minting ───────────────────────────────────────────────────────────

/**
 * Mint a short-lived access token from the service account for Firestore REST.
 * Uses the same JWT → token exchange the roles.ts module uses.
 */
async function mintFirestoreToken(sa: { client_email: string; private_key: string; project_id: string }): Promise<string | null> {
  try {
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: 'RS256', typ: 'JWT' };
    const claims = {
      iss: sa.client_email,
      sub: sa.client_email,
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
      scope: 'https://www.googleapis.com/auth/datastore',
    };

    const jwt = await signJwt(header, claims, sa.private_key);

    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
    });

    if (!res.ok) return null;
    const data = await res.json() as { access_token?: string };
    return data.access_token || null;
  } catch {
    return null;
  }
}

/** Sign a JWT with RS256 using the Web Crypto API. */
async function signJwt(
  header: Record<string, string>,
  claims: Record<string, unknown>,
  privateKeyPem: string,
): Promise<string> {
  const enc = new TextEncoder();

  // Parse PEM → binary
  const pemBody = privateKeyPem
    .replace(/-----BEGIN (?:RSA )?PRIVATE KEY-----/g, '')
    .replace(/-----END (?:RSA )?PRIVATE KEY-----/g, '')
    .replace(/\s/g, '');
  const keyBinary = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));

  const key = await crypto.subtle.importKey(
    'pkcs8',
    keyBinary,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const headerB64 = base64url(enc.encode(JSON.stringify(header)));
  const claimsB64 = base64url(enc.encode(JSON.stringify(claims)));
  const payload = `${headerB64}.${claimsB64}`;

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    enc.encode(payload),
  );

  return `${payload}.${base64url(new Uint8Array(signature))}`;
}

function base64url(buf: Uint8Array): string {
  let s = '';
  for (const b of buf) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
