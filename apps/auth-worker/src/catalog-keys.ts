/**
 * CATALOG KEYS — the SERVER half of the sealed Claude key (design
 * docs/info/request-a-catalog-design.md §6).
 *
 * 🔴 THIS FILE NEVER SEES A KEY. It moves an OPAQUE ENVELOPE from the wire into
 * a private R2 bucket and back out again by DELETING it. There is no decrypt
 * here, no private key here, and deliberately no `.get()` anywhere in this
 * Worker — §6.2's closing line is that the absence of a decrypt-to-read path,
 * not a policy, is what makes *"the owner can never see it"* mechanical. Adding
 * a read route to this module would quietly undo the whole design.
 *
 * The envelope contract is PINNED (2026-09-05) so the browser half and this
 * half agree without talking:
 *
 *   { v: 1,
 *     kid: "<first 16 hex chars of SHA-256 over the public key's SPKI DER>",
 *     alg: "RSA-OAEP-256+A256GCM",
 *     ek:  "<base64: the 32-byte AES-256-GCM key, RSA-OAEP(SHA-256)-wrapped>",
 *     iv:  "<base64: 12 random bytes>",
 *     ct:  "<base64: AES-256-GCM ciphertext, tag appended (WebCrypto default)>" }
 *
 * ⚠️ WHAT THIS FILE CHECKS IS EXACTLY WHAT THE CONTRACT SAYS THE SERVER
 * ENFORCES, AND NOT ONE CHECK MORE: `v === 1`, `alg` matched literally, the
 * five string fields present and non-empty, base64 that actually decodes, and
 * the serialized envelope ≤ 8 KB. It deliberately does NOT police the DECODED
 * byte lengths (a 12-byte IV, a 512-byte wrap): AES-GCM accepts other IV
 * lengths and RSA moduli change, so a length rule here would reject envelopes
 * that decrypt perfectly well — refusing a working key at the one moment a
 * person is trying to hand one over. The plaintext ceiling (512 bytes) is the
 * CLIENT's, said in words there, and cannot be re-checked on ciphertext.
 *
 * ⚠️ AND IT REFUSES, NEVER STRIPS — an unknown field is a 400 with words, the
 * estate's standing rule for every write door. A sealed envelope with a field
 * nobody recognises is either a client the contract has drifted from or
 * somebody probing; both want to be told, not tolerated.
 */

/** The one algorithm string. A mismatch is a refusal, never a fallback. */
export const SEALED_ALG = 'RSA-OAEP-256+A256GCM';

/** The serialized ceiling from the pinned contract. */
export const SEALED_MAX_BYTES = 8192;

export interface SealedEnvelope {
  v: 1;
  kid: string;
  alg: string;
  ek: string;
  iv: string;
  ct: string;
}

export type SealedError = { error: string; detail: string };

const ENVELOPE_KEYS = ['v', 'kid', 'alg', 'ek', 'iv', 'ct'] as const;
const STRING_KEYS = ['kid', 'alg', 'ek', 'iv', 'ct'] as const;
const BASE64_KEYS = ['ek', 'iv', 'ct'] as const;

/**
 * ⚠️ `atob` IS LENIENT AND THE REGEX IS NOT OPTIONAL. Workers' `atob` accepts
 * plenty of strings a strict base64 decoder would reject, so the shape is
 * checked first and the decode second: the shape catches the sloppy encoder,
 * the decode catches the truncation.
 */
const BASE64_SHAPE = /^[A-Za-z0-9+/]+={0,2}$/;

function decodesAsBase64(value: string): boolean {
  if (!BASE64_SHAPE.test(value) || value.length % 4 !== 0) return false;
  try {
    atob(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate one envelope off the wire.
 *
 * 🔴 EVERY RETURN IS EITHER A VALID ENVELOPE OR A SENTENCE A PERSON CAN ACT ON.
 * The person on the other end of this is handing over a credential and cannot
 * see what went wrong; "invalid" would send them to the owner with nothing.
 */
export function parseSealedEnvelope(input: unknown): SealedEnvelope | SealedError {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return {
      error: 'bad_sealed_key',
      detail:
        'The sealed key has to be the envelope object the form builds, or left out entirely. ' +
        'Nothing was stored and the request was not filed.',
    };
  }
  const obj = input as Record<string, unknown>;

  for (const k of Object.keys(obj)) {
    if (!(ENVELOPE_KEYS as readonly string[]).includes(k)) {
      return {
        error: 'bad_sealed_key',
        detail:
          `“${k}” is not part of a sealed key envelope. Known fields: ${ENVELOPE_KEYS.join(', ')}. ` +
          'The envelope is refused whole rather than trimmed — a key half-understood is a key nobody should store.',
      };
    }
  }

  // ⚠️ THE NUMBER 1, NOT THE STRING "1". The version is what lets this contract
  // change later without a guess; a version read tolerantly is a version that
  // stops meaning anything the day there is a second one.
  if (obj.v !== 1) {
    return {
      error: 'bad_sealed_key',
      detail:
        'That sealed key says it is a version this estate does not know (the only version is 1). ' +
        'Reload heygabi.ai so the form is current, then attach the key again.',
    };
  }

  for (const k of STRING_KEYS) {
    if (typeof obj[k] !== 'string' || (obj[k] as string).length === 0) {
      return {
        error: 'bad_sealed_key',
        detail:
          `The sealed key envelope is missing its “${k}” field, or it is not text. The key was NOT stored ` +
          'and nothing was recorded about it — attach it again, or submit without one and tell the owner.',
      };
    }
  }

  if (obj.alg !== SEALED_ALG) {
    return {
      error: 'bad_sealed_key',
      detail:
        `That sealed key was sealed with an algorithm this estate does not accept (it accepts ${SEALED_ALG} ` +
        'and nothing else). Nothing was stored. Reload heygabi.ai so the form is current and try again.',
    };
  }

  for (const k of BASE64_KEYS) {
    if (!decodesAsBase64(obj[k] as string)) {
      return {
        error: 'bad_sealed_key',
        detail:
          `The sealed key envelope’s “${k}” is not readable base64, so the envelope could not be a key that ` +
          'would ever decrypt. Nothing was stored. Attach it again from the form rather than by hand.',
      };
    }
  }

  const bytes = new TextEncoder().encode(JSON.stringify(obj)).length;
  if (bytes > SEALED_MAX_BYTES) {
    return {
      error: 'sealed_key_too_big',
      detail:
        `That sealed key envelope is ${bytes} bytes and the limit is ${SEALED_MAX_BYTES}. An API key sealed by ` +
        'the form is a fraction of that, so this is a sign something other than a key was attached. Nothing was stored.',
    };
  }

  return {
    v: 1,
    kid: obj.kid as string,
    alg: obj.alg as string,
    ek: obj.ek as string,
    iv: obj.iv as string,
    ct: obj.ct as string,
  };
}

/** The two object keys, in one place so nothing spells them twice. */
export function envelopeKey(side: 'reader' | 'owner', id: number): string {
  return `${side}/${id}.json`;
}

/**
 * Store one envelope. Returns whether it landed.
 *
 * ⚠️ IT SWALLOWS THE ERROR AND RETURNS FALSE ON PURPOSE, AND THE CALLER MUST
 * SAY SO IN WORDS. A failed put must not fail the whole request: the row is the
 * thing the person came for, and losing it because a bucket blinked would be a
 * strictly worse outcome than a request that carries no key. But the boolean in
 * D1 then stays 0 — "a key was attached" is a claim about storage, and the two
 * must never disagree.
 *
 * ⚠️ NOTHING IS LOGGED HERE, not the error, not the key, not a truncation of
 * either. An R2 error can echo the request it failed on.
 */
export async function putEnvelope(
  bucket: R2Bucket,
  side: 'reader' | 'owner',
  id: number,
  envelope: SealedEnvelope,
): Promise<boolean> {
  try {
    await bucket.put(envelopeKey(side, id), JSON.stringify(envelope), {
      httpMetadata: { contentType: 'application/json' },
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Delete BOTH sides for a request id — decline, withdraw, and the provisioner's
 * purge all mean "this envelope has no future".
 *
 * ⚠️ A MISSING OBJECT IS A SUCCESS, NOT AN ERROR. R2's delete is idempotent, and
 * the common case is exactly the absent one (most requests carry no key at
 * all). A delete that threw on 404 would turn "decline a request nobody attached
 * a key to" into a 502.
 */
export async function deleteEnvelopes(bucket: R2Bucket | undefined, id: number): Promise<void> {
  if (!bucket) return;
  for (const side of ['reader', 'owner'] as const) {
    try {
      await bucket.delete(envelopeKey(side, id));
    } catch {
      // Deliberately ignored: see the note above. The envelope is undecryptable
      // to everyone but the owner's machine, so a stranded object is a
      // housekeeping matter, never an exposure — and it must not cost the
      // person their decline.
    }
  }
}

/**
 * The refusal for a deployment with no key store bound.
 *
 * 🔴 THE ONE THING THIS MUST NOT DO IS SUCCEED QUIETLY. Dropping the key and
 * filing the request anyway leaves a person believing their own key is in use
 * while the catalog is provisioned with somebody else's (§6.4 row 3 — the
 * owner's, which he PAYS for). That is a money decision made by a silent
 * fallback, which the design says explicitly must never be the code's default
 * by accident.
 */
export const KEY_STORE_MISSING = {
  error: 'key_store_unconfigured',
  detail:
    'This deployment has nowhere to put a sealed key — the key store is not configured on it, so the key ' +
    'was NOT stored and the request was NOT filed. Submit again without a key (the catalog can be set up ' +
    'without one and a key added later), or tell the owner that CATALOG_KEYS is unbound on auth.heygabi.ai.',
} as const;

/** The sentence a client shows when the row landed but the key did not. */
export const KEY_NOT_STORED_WARNING =
  'The request was filed, but the key was not stored — the key store refused the write. Nothing about the ' +
  'key was recorded, so nothing is half-set: tell the owner, and hand the key over again when he asks.';
