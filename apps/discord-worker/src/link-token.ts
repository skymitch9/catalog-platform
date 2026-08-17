/**
 * The PENDING-LINK token — how the Discord half of the ceremony survives the
 * trip across the estate half, without the browser being able to lie about it.
 *
 * THE PROBLEM. `/link/callback` learns who the Discord user is (an OAuth code
 * exchange the browser cannot forge). The page it then serves has to sign the
 * person into Firebase and post the result back — and between those two
 * moments the only thing carrying the Discord identity is the browser. Put
 * the Discord user id in the page and anyone can POST any other user's id
 * back, binding a stranger's Discord account to their own estate name. That
 * is the whole ceremony's security, so it is not left to good manners.
 *
 * THE ANSWER. The Worker signs `{discordUserId, discordUsername, exp}` with
 * HMAC-SHA256 and hands it back as an **HttpOnly** cookie. The page never
 * reads it; the browser only replays it. `/link/confirm` verifies the MAC and
 * the expiry, so the Discord half is as trustworthy at confirm time as it was
 * at callback time — and the estate half is proven separately, by a Firebase
 * ID token the same instant. Two independent proofs, one write.
 *
 * THE KEY. Derived from `DISCORD_CLIENT_SECRET` with a fixed label, so this
 * MAC key is not literally the OAuth credential and a future second use gets
 * its own label rather than sharing this one. No new secret to set, no new
 * thing for the owner to rotate: rotating the client secret invalidates every
 * in-flight pending token, which is the correct blast radius for a 15-minute
 * artifact.
 *
 * ⚠️ Everything here is constant-time-compared and fail-closed: a malformed
 * token, a bad MAC and an expired token are the same answer to the caller
 * (`null`), and the caller words all three identically. Distinguishing them
 * would teach an attacker which half of the forgery to fix.
 */

const enc = new TextEncoder();

/** How long a half-finished ceremony stays resumable. */
export const PENDING_TTL_SECONDS = 15 * 60;

/** Domain-separation label — a second MAC use gets a second label, never this one. */
const KEY_LABEL = 'discord-link-pending-v1';

export interface PendingLink {
  discordUserId: string;
  discordUsername: string;
  /** Unix seconds. */
  exp: number;
}

/** base64url, no padding — cookie-safe without further escaping. */
export function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(s: string): Uint8Array | null {
  try {
    const padded = s.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/** A 128-bit nonce — the CSRF `state`, and any other unguessable id here. */
export function newNonce(): string {
  return b64url(crypto.getRandomValues(new Uint8Array(16)));
}

async function macKey(clientSecret: string): Promise<CryptoKey> {
  // HMAC the label under the raw secret, and use THAT as the signing key —
  // one extra hash so the key in use is not the OAuth credential itself.
  const seed = await crypto.subtle.importKey(
    'raw',
    enc.encode(clientSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const derived = await crypto.subtle.sign('HMAC', seed, enc.encode(KEY_LABEL));
  return crypto.subtle.importKey('raw', derived, { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);
}

/** `<base64url(payload)>.<base64url(mac)>` */
export async function signPending(clientSecret: string, pending: PendingLink): Promise<string> {
  const payload = b64url(enc.encode(JSON.stringify(pending)));
  const key = await macKey(clientSecret);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(payload)));
  return `${payload}.${b64url(mac)}`;
}

/**
 * Verify and decode. Null on ANY failure — malformed, bad MAC, expired,
 * wrong shape — deliberately indistinguishable to the caller.
 */
export async function verifyPending(
  clientSecret: string,
  token: string,
  nowSeconds: number,
): Promise<PendingLink | null> {
  const dot = token.indexOf('.');
  if (dot <= 0 || dot === token.length - 1) return null;
  const payload = token.slice(0, dot);
  const macBytes = b64urlDecode(token.slice(dot + 1));
  if (!macBytes) return null;

  const key = await macKey(clientSecret);
  // crypto.subtle.verify is the constant-time comparison; never `===` on MACs.
  let ok: boolean;
  try {
    ok = await crypto.subtle.verify('HMAC', key, macBytes, enc.encode(payload));
  } catch {
    return null;
  }
  if (!ok) return null;

  const raw = b64urlDecode(payload);
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return null;
  }
  const p = parsed as Partial<PendingLink>;
  if (typeof p.discordUserId !== 'string' || p.discordUserId.length === 0) return null;
  if (typeof p.discordUsername !== 'string') return null;
  if (typeof p.exp !== 'number' || !Number.isFinite(p.exp)) return null;
  if (p.exp <= nowSeconds) return null;
  return { discordUserId: p.discordUserId, discordUsername: p.discordUsername, exp: p.exp };
}

/**
 * Constant-time string compare for the CSRF `state` — same reasoning as the
 * MAC: a timing-leaky compare on a 128-bit nonce is a small hole, but it is
 * a hole, and the fix is four lines.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
