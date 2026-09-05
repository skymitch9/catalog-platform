/**
 * catalog-seal.js — the browser half of the sealed Claude key (design §6).
 *
 * ONE HOME for the provisioning PUBLIC key and for the sealing routine, imported
 * by both surfaces that can supply a key: the "+" form on the front door
 * (assets/apex-request-catalog.js, the requester's own key) and the /admin
 * Accept panel (admin/admin.js, the owner's key). Two copies of a sealing
 * routine would be two chances to get the envelope wrong, and the one that
 * drifted would be the one nobody exercised.
 *
 * ── WHAT IT DOES, AND WHY IN THIS SHAPE ────────────────────────────────────
 *
 * A sealed box. The plaintext is encrypted under a fresh AES-256-GCM key; that
 * one-use symmetric key is then wrapped to the provisioning RSA-OAEP public
 * key. Only the holder of the private half — which lives on the owner's dev
 * machine under docs/access/keys/ and nowhere else — can unwrap it.
 *
 * 🔴 RSA CANNOT ENCRYPT AN ARBITRARY STRING, which is why the AES step is not
 * decoration: RSA-OAEP/SHA-256 with a 4096-bit modulus caps a message at 446
 * bytes, and an API key that grew past that would start failing in a browser
 * with no server-side trace. AES-GCM has no such cap, and the RSA step only
 * ever carries 32 bytes.
 *
 * ⚠️ WebCrypto ONLY — no library, nothing fetched. That is what makes this
 * CSP-safe on a page whose policy is `default-src 'none'` with `script-src
 * 'self'` and no 'unsafe-eval' (public/_headers, the `/` and `/admin/` rules).
 * SubtleCrypto is not governed by CSP at all; a JS crypto library would have
 * needed a script-src entry, a subresource and a supply chain.
 *
 * ── THE ENVELOPE — PINNED 2026-09-05, and the server validates it ──────────
 *
 *   { v: 1,
 *     kid: "<first 16 hex of SHA-256 over the public key's SPKI DER>",
 *     alg: "RSA-OAEP-256+A256GCM",
 *     ek:  "<base64: the 32-byte AES key, RSA-OAEP(SHA-256)-wrapped>",
 *     iv:  "<base64: 12 random bytes>",
 *     ct:  "<base64: AES-256-GCM ciphertext, tag appended (WebCrypto default)>" }
 *
 * Six string-or-number fields, no more. The auth Worker enforces: v === 1, alg
 * exactly as above, every field present, base64 that decodes, serialized
 * envelope ≤ 8 KB. This file enforces the ≤ 512-byte plaintext limit IN WORDS
 * before sealing, so a person is told rather than shown a rejection later.
 *
 * ⚠️ THE `kid` IS NOT DECORATION. Rotating the keypair makes every older
 * envelope permanently undecryptable (design §6.5 — that is a feature). The kid
 * is how the provisioner can SAY that, precisely, instead of failing with a
 * cryptographic error nobody can act on.
 *
 * ── WHAT IS DELIBERATELY ABSENT ────────────────────────────────────────────
 *
 * There is no unseal, no decrypt and no reveal in this file or anywhere in the
 * browser bundle. That absence is the mechanical guarantee behind "the owner
 * can never see it" (design §6.2) — not a policy, an unbuilt path.
 */

/* @generated:public-key-start — written by scripts/catalog-key-mint.mjs --write-public
 * ⚠️ EDIT VIA THAT SCRIPT, NOT BY HAND. The kid is derived from the key; a
 * hand-edited pair that disagrees seals envelopes the provisioner will refuse.
 * A public key in a public bundle is safe by design — the same posture as the
 * Firebase web API key already shipped on this page. */
export const CATALOG_PROVISIONING_KID = "fb6eb908ead63ce7";
export const CATALOG_PROVISIONING_PUBLIC_JWK = Object.freeze({
  kty: "RSA",
  n: "ptUGM3sZbsLWs9oQRyU05Z2Xjq2pTWMbDZ7nr2itNL4E__ev7fX-At8h1PLqUw1iYLE6rYOeU4XxWXTPC3Os9aRJsvIdIWKnRcSqMTvChcLPALTfUukKkmqPhhyguaweQuLTXSXk9u-Mm68nFBRgGpGC4OiSYEvgxXR2p7ToaeY5N_w-TqNpHrNFXZBZS5B-ik16e_w5Zu64go7LnyaK3o14TupnJSuYfI1ON1lbae2OsOEKPThYwzPysREqViJk5J3_aXThchdaf5XYctQ4eWOKdlzSIA-fcyk_0UOdNLebCNiI0Z7ZL9V3UPFnxx5evfesxaeJvS3g188bIR9kwPwzNXUGBlhoTPTE8cHcMCx2rPRANu9JGi_z1ki4-rQPig0PKknU3_syyxOtTUy7OePNN8J_tdjZ4Ij8uXtb0EPZecoqbkcUcVY6iI7cEDLquNAr3RjgcUo7-X7L0JTRafQYHjFAWlUXfJKxc3WIlqQ16kJHewafWbzNoK4ty9oCiw81_8Ml-46XDUTEAVef36i4l04segu8inBMybr9MskamnwFUZdRyzg-TcMq5av93b3lKw3nTw9FnB3cLR8KE3pGjsnQCITM0Wfmu6i2Fgm-rxYq3MkJOm1WoZtdR7oGsE4vg_zXvaLnwmEk8BRuexFya3Grg9m-qopL4Xmt0RU",
  e: "AQAB",
  alg: "RSA-OAEP-256",
  ext: true,
  kid: "fb6eb908ead63ce7",
});
/* @generated:public-key-end */

/** The `alg` string the server pins. One spelling, one home. */
export const CATALOG_SEAL_ALG = 'RSA-OAEP-256+A256GCM';
/** Plaintext ceiling, in BYTES of UTF-8 — the server's own limit, said first. */
export const CATALOG_SEAL_MAX_PLAINTEXT_BYTES = 512;
/** Serialized-envelope ceiling the server enforces; asserted by the tests. */
export const CATALOG_SEAL_MAX_ENVELOPE_BYTES = 8 * 1024;

/**
 * A typed error, so every caller can render its own sentence rather than
 * showing whatever a crypto stack threw. `code` is the branch; `message` is
 * already a sentence a person can read, because a caller that forgets to
 * translate must still not surface jargon.
 */
export class SealError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SealError';
    this.code = code;
  }
}

/**
 * Can this browser seal at all?
 *
 * ⚠️ Both halves matter. `crypto.subtle` is UNDEFINED on a page that is not a
 * secure context — not throwing, undefined — so a check for the object alone
 * passes on some engines and fails on others, and the difference only shows up
 * on somebody else's phone. The caller's contract is fail-QUIET: hide the field
 * and say nothing (design §4.3's posture, applied to a field rather than a
 * button). Never render a broken control and never explain a browser to
 * somebody who cannot change it.
 *
 * In Node (the round-trip test) `globalThis.isSecureContext` is undefined,
 * which is why this reads `!== false` rather than `=== true`.
 */
export function sealSupported() {
  const c = globalThis.crypto;
  if (!c || !c.subtle || typeof c.subtle.encrypt !== 'function') return false;
  if (typeof c.getRandomValues !== 'function') return false;
  return globalThis.isSecureContext !== false;
}

/** UTF-8 byte length — the unit the limit is stated in, not `String.length`. */
export function plaintextBytes(text) {
  return new TextEncoder().encode(String(text)).length;
}

/**
 * base64 of a byte array, chunked.
 *
 * ⚠️ The chunking is not premature: `String.fromCharCode(...bytes)` spreads
 * every byte as an argument and throws RangeError on large inputs in every
 * engine. 512 bytes of RSA ciphertext is safe today, but a routine that breaks
 * silently when a limit moves is a routine that will be moved.
 */
function toBase64(bytes) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let out = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < view.length; i += CHUNK) {
    out += String.fromCharCode.apply(null, view.subarray(i, i + CHUNK));
  }
  return btoa(out);
}

/**
 * Seal one secret to the provisioning public key.
 *
 * @param {string} plaintext            the key as typed — never stored, never logged
 * @param {object} [opts]
 * @param {object} [opts.publicJwk]     TEST SEAM ONLY: a throwaway public JWK
 * @param {string} [opts.kid]           TEST SEAM ONLY: the kid that goes with it
 * @returns {Promise<{v:number,kid:string,alg:string,ek:string,iv:string,ct:string}>}
 * @throws  {SealError} `unsupported` · `empty` · `too_long` · `failed`
 *
 * ⚠️ THE TEST SEAM IS A PARAMETER, NOT A MUTABLE MODULE VARIABLE. A settable
 * "current key" would be one line away from a page that seals to something a
 * script on the page chose. The constants are frozen and the override is
 * per-call, so the shipped callers — which pass nothing — cannot be redirected.
 */
export async function sealSecret(plaintext, opts) {
  if (!sealSupported()) {
    throw new SealError(
      'unsupported',
      'This browser can’t seal a key here, so the field was left out. Nothing else is affected.',
    );
  }
  const text = String(plaintext == null ? '' : plaintext).trim();
  if (!text) {
    throw new SealError('empty', 'There’s nothing in the key field to seal.');
  }
  const bytes = new TextEncoder().encode(text);
  if (bytes.length > CATALOG_SEAL_MAX_PLAINTEXT_BYTES) {
    throw new SealError(
      'too_long',
      `That key is ${bytes.length} bytes long and the limit is ${CATALOG_SEAL_MAX_PLAINTEXT_BYTES}. ` +
        'Check you pasted a key and not a whole file — nothing was sent.',
    );
  }

  const jwk = (opts && opts.publicJwk) || CATALOG_PROVISIONING_PUBLIC_JWK;
  const kid = (opts && opts.kid) || CATALOG_PROVISIONING_KID;

  try {
    const subtle = globalThis.crypto.subtle;
    const rsa = await subtle.importKey(
      'jwk',
      { ...jwk },
      { name: 'RSA-OAEP', hash: 'SHA-256' },
      false,
      ['encrypt'],
    );
    // A FRESH symmetric key per envelope. Reuse across submissions would let two
    // envelopes be compared; there is no reason to reuse and every reason not to.
    const aes = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
    const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, aes, bytes);
    const raw = await subtle.exportKey('raw', aes);
    const ek = await subtle.encrypt({ name: 'RSA-OAEP' }, rsa, raw);
    return {
      v: 1,
      kid,
      alg: CATALOG_SEAL_ALG,
      ek: toBase64(new Uint8Array(ek)),
      iv: toBase64(iv),
      ct: toBase64(new Uint8Array(ct)),
    };
  } catch (err) {
    // ⚠️ The cause is NOT echoed. A WebCrypto DOMException says nothing a person
    // can act on, and the one thing that must never appear near this failure is
    // any fragment of what was being sealed.
    throw new SealError(
      'failed',
      'The key could not be sealed in this browser, so it was not sent. Your request is otherwise unaffected.',
    );
  }
}
