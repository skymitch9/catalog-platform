/**
 * The one bearer-token comparison this Worker owns.
 *
 * Lifted VERBATIM out of `push.ts` (2026-08-23) when the machine READ surface
 * needed the same check — a second copy of a credential comparison is the
 * "one canonical implementation of anything that makes a decision" rule's
 * exact target, and a constant-time compare that drifts into a `===` in one
 * of two copies fails silently and forever.
 *
 * ⚠️ Length-gated `crypto.subtle.timingSafeEqual`: the token's LENGTH is not a
 * secret worth hiding (it is fixed by whoever minted it), the token BYTES are.
 * `timingSafeEqual` throws on differing lengths, so the gate is required, not
 * an optimisation.
 */

/**
 * ⚠️ `crypto.subtle.timingSafeEqual` is a **Cloudflare Workers extension** —
 * standard WebCrypto has no such method, and Node's does not either. On the
 * Workers runtime this is the platform primitive and always the one used; the
 * fallback below exists ONLY so `npm test` (plain Node, `tsx --test`) can
 * exercise a token check at all.
 *
 * 🔴 **This was found by measurement, 2026-08-23, and it is a real gap it
 * closes: until this line existed, NO test in this Worker had ever presented a
 * CORRECT token.** `test/auth.test.ts`'s push case sends `Bearer wrong`, which
 * differs in LENGTH and so returns false at the length gate — the
 * `timingSafeEqual` call was never reached, so the suite passed while the only
 * line that can say "yes, this credential is valid" was unexecuted on Node.
 * The first test to present a matching token threw `TypeError: ... is not a
 * function` on all seven of its cases.
 */
const subtleTimingSafeEqual = (
  crypto.subtle as unknown as {
    timingSafeEqual?: (a: ArrayBufferView, b: ArrayBufferView) => boolean;
  }
).timingSafeEqual;

/**
 * Constant-time byte comparison of two EQUAL-LENGTH arrays — the Node-side
 * stand-in. Accumulates every XOR before testing anything, so no input makes
 * it return earlier than any other. Length is checked by the caller (both
 * implementations require it).
 */
function xorEqual(a: Uint8Array, b: Uint8Array): boolean {
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

/** True when `header` is `Bearer <expected>`, compared in constant time. */
export async function tokenMatches(header: string | undefined, expected: string): Promise<boolean> {
  if (!header?.startsWith('Bearer ')) return false;
  const given = new TextEncoder().encode(header.slice('Bearer '.length));
  const want = new TextEncoder().encode(expected);
  if (given.byteLength !== want.byteLength) return false;
  return typeof subtleTimingSafeEqual === 'function'
    ? subtleTimingSafeEqual.call(crypto.subtle, given, want)
    : xorEqual(given, want);
}

/** True when a header is present AND presents itself as a bearer at all. */
export function hasBearer(header: string | undefined): boolean {
  return typeof header === 'string' && header.startsWith('Bearer ') && header.length > 'Bearer '.length;
}
