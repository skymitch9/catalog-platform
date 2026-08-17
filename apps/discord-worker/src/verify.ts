/**
 * Discord request-signature verification — Ed25519 over `timestamp + raw
 * body`, per Discord's interactions spec (research doc §3):
 *
 *   headers  X-Signature-Ed25519 (64-byte signature, hex)
 *            X-Signature-Timestamp
 *   key      the application's PUBLIC key from the Developer Portal
 *            (public by design — this is verification, not a shared secret)
 *
 * ⚠️ Discord actively probes the saved Interactions Endpoint URL with
 * deliberately INVALID signatures at save-time and periodically after, and
 * silently removes the URL if bad signatures are not rejected — so the
 * failure mode of getting this wrong reads as "the portal is broken", not
 * as a code bug (design doc §1.7). Reject loudly, never fail open.
 *
 * The distinction this module keeps sharp:
 *   - a malformed CONFIG value (DISCORD_PUBLIC_KEY not 32 bytes of hex)
 *     THROWS — that is a deployment bug worth a loud 500;
 *   - a malformed or wrong SIGNATURE returns false — that is an
 *     unauthenticated caller and gets a 401.
 */

/** Strict hex → bytes. Null on odd length, empty, or non-hex characters. */
export function hexToBytes(hex: string): Uint8Array | null {
  if (hex.length === 0 || hex.length % 2 !== 0 || /[^0-9a-fA-F]/.test(hex)) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Per-isolate key cache — importKey once, reuse across requests. */
let cachedKey: { hex: string; key: CryptoKey } | null = null;

/** Import the portal public key. Throws on a malformed value (config bug —
 * the message names the constraint, never echoes the value). */
export async function importDiscordPublicKey(hex: string): Promise<CryptoKey> {
  if (cachedKey && cachedKey.hex === hex) return cachedKey.key;
  const bytes = hexToBytes(hex);
  if (!bytes || bytes.length !== 32) {
    throw new Error('DISCORD_PUBLIC_KEY must be exactly 64 hex characters (32 bytes)');
  }
  const key = await crypto.subtle.importKey('raw', bytes, { name: 'Ed25519' }, false, ['verify']);
  cachedKey = { hex, key };
  return key;
}

/**
 * True only for a valid Ed25519 signature over `timestamp + rawBody`.
 * A malformed signature is false (401 material), never a throw; a malformed
 * PUBLIC KEY still throws, via importDiscordPublicKey above.
 */
export async function verifyDiscordSignature(
  publicKeyHex: string,
  signatureHex: string,
  timestamp: string,
  rawBody: string,
): Promise<boolean> {
  const key = await importDiscordPublicKey(publicKeyHex);
  const sig = hexToBytes(signatureHex);
  if (!sig || sig.length !== 64) return false;
  const data = new TextEncoder().encode(timestamp + rawBody);
  try {
    return await crypto.subtle.verify({ name: 'Ed25519' }, key, sig, data);
  } catch {
    return false;
  }
}
