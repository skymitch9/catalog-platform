#!/usr/bin/env node
/**
 * catalog-key-mint — mint the ONE provisioning keypair the sealed Claude key
 * rests on (design §6.2 step 1, phase 5 of §10).
 *
 * ## What it makes, and where each half lives
 *
 * | Half | Where it goes | Who may see it |
 * |---|---|---|
 * | PRIVATE JWK | `docs/access/keys/catalog-provisioning.private.jwk` | this machine, and the provisioner's memory |
 * | PUBLIC JWK + `kid` | a build constant in `sites/heygabi-home/public/assets/catalog-seal.js` | everyone — it ships in a public bundle, by design |
 *
 * A public key in a public bundle is not a leak. It is the same posture as the
 * Firebase web API key already shipped on that page: it identifies a
 * destination, it authorises nothing, and the only thing it can do is make a
 * message that only the private half can open.
 *
 * 🔴 THE PRIVATE HALF IS PRINTED BY NOTHING, EVER — not by this script, not by
 * the provisioner, not by an error path. It is written once, straight to the
 * gitignored custody folder (`.gitignore:67`, `docs/access/keys/*` with a single
 * negation for that folder's README), and after that only `scripts/lib/
 * catalog-seal.mjs` reads it, in code, to decrypt in memory. There is no
 * decrypt-to-print path anywhere in the estate, and that ABSENCE is the whole
 * guarantee behind "the owner can never see the requester's key" (design §6.2).
 *
 * ## Usage
 *
 *   node scripts/catalog-key-mint.mjs                     # mint; refuse if one exists
 *   node scripts/catalog-key-mint.mjs --write-public      # …and splice the public half into catalog-seal.js
 *   node scripts/catalog-key-mint.mjs --rotate            # replace an existing keypair (read the warning)
 *   node scripts/catalog-key-mint.mjs --print-public      # re-print the public half of the key on disk
 *
 * ## ⚠️ WHAT `--rotate` COSTS, said out loud because it is not recoverable
 *
 * Every envelope already sitting in `estate-catalog-keys` was sealed to the OLD
 * public key. Replacing the keypair makes all of them **permanently
 * undecryptable** — there is no re-wrap, because the plaintext exists nowhere
 * else on purpose. In practice that means: any request whose requester attached
 * a key, and which has not been provisioned yet, loses that key silently unless
 * somebody goes and looks. Design §6.5 lists this as the MITIGATION for a stolen
 * private key, which is exactly when you want it — and as an accident it is a
 * quiet data loss.
 *
 * So `--rotate` refuses to run without also being told what to do about the
 * envelopes: it prints the wrangler command that lists them and requires
 * `--rotate --i-have-checked-pending-envelopes`.
 */

import { createHash, webcrypto } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, '..');
export const PRIVATE_JWK_PATH = join(
  REPO_ROOT,
  'docs',
  'access',
  'keys',
  'catalog-provisioning.private.jwk',
);
export const SEAL_MODULE_PATH = join(
  REPO_ROOT,
  'sites',
  'heygabi-home',
  'public',
  'assets',
  'catalog-seal.js',
);

const START = '/* @generated:public-key-start';
const END = '/* @generated:public-key-end */';

/**
 * The key id: the first 16 hex characters of SHA-256 over the public key's
 * SPKI DER.
 *
 * ⚠️ DERIVED FROM THE KEY, never chosen. A hand-picked id can be right about a
 * key that has been replaced; a derived one cannot. 16 hex characters is 64
 * bits — this is a LABEL, not a security boundary (nothing trusts a kid; the
 * decryption either works or it does not), and it exists so a failure can say
 * "this envelope was sealed to a key you no longer hold" instead of throwing.
 */
export function kidFromSpki(spkiDer) {
  return createHash('sha256').update(Buffer.from(spkiDer)).digest('hex').slice(0, 16);
}

/**
 * RSA-OAEP, 4096-bit modulus, SHA-256 — the pinned contract, in one place.
 *
 * 4096 rather than 2048 because this key has no rotation cadence: it is minted
 * once and the envelopes it opens may sit for months. The cost is a 512-byte
 * `ek` in every envelope, which the 8 KB envelope ceiling absorbs with room to
 * spare (measured: a sealed 512-byte plaintext serializes to ~1.5 KB).
 */
export async function mintKeypair(subtle = webcrypto.subtle) {
  const pair = await subtle.generateKey(
    {
      name: 'RSA-OAEP',
      modulusLength: 4096,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['encrypt', 'decrypt'],
  );
  const publicJwk = await subtle.exportKey('jwk', pair.publicKey);
  const privateJwk = await subtle.exportKey('jwk', pair.privateKey);
  const spki = await subtle.exportKey('spki', pair.publicKey);
  return { publicJwk, privateJwk, kid: kidFromSpki(spki) };
}

/**
 * The public half of a keypair, in the exact key order the module constant
 * carries. Sorted deliberately: a re-mint that reorders keys would produce a
 * noisy diff that hides the one line that matters.
 */
export function publicConstantFrom(jwk, kid) {
  return {
    kty: jwk.kty,
    n: jwk.n,
    e: jwk.e,
    alg: 'RSA-OAEP-256',
    ext: true,
    kid,
  };
}

/**
 * Splice the public half between the two generated markers in catalog-seal.js.
 *
 * ⚠️ MARKER-DELIMITED, NOT REGEX-OVER-THE-WHOLE-FILE. The header comment above
 * the constants contains the words `kid` and `public key`; a pattern loose
 * enough to find the constant is loose enough to eat the paragraph explaining
 * it, and the paragraph is the half a later reader needs.
 *
 * @returns {string} the rewritten module source
 */
export function splicePublicKey(source, publicJwk, kid) {
  const start = source.indexOf(START);
  const end = source.indexOf(END);
  if (start === -1 || end === -1 || end < start) {
    throw new Error(
      `Could not find the generated block in catalog-seal.js.\n` +
        `Expected a "${START} …" comment and a "${END}" line around the two constants.\n` +
        'They are the only edit point; restore them rather than writing the key in by hand.',
    );
  }
  const head = source.slice(0, start);
  const tail = source.slice(end + END.length);
  const banner =
    `${START} — written by scripts/catalog-key-mint.mjs --write-public\n` +
    ' * ⚠️ EDIT VIA THAT SCRIPT, NOT BY HAND. The kid is derived from the key; a\n' +
    ' * hand-edited pair that disagrees seals envelopes the provisioner will refuse.\n' +
    ' * A public key in a public bundle is safe by design — the same posture as the\n' +
    ' * Firebase web API key already shipped on this page. */\n';
  const constant = publicConstantFrom(publicJwk, kid);
  const body =
    `export const CATALOG_PROVISIONING_KID = ${JSON.stringify(kid)};\n` +
    'export const CATALOG_PROVISIONING_PUBLIC_JWK = Object.freeze({\n' +
    Object.entries(constant)
      .map(([k, v]) => `  ${k}: ${JSON.stringify(v)},`)
      .join('\n') +
    '\n});\n';
  return `${head}${banner}${body}${END}${tail}`;
}

/* ------------------------------------------------------------------------- *
 * CLI
 * ------------------------------------------------------------------------- */

function say(...lines) {
  for (const l of lines) console.log(l);
}

async function main(argv) {
  const rotate = argv.includes('--rotate');
  const writePublic = argv.includes('--write-public');
  const printOnly = argv.includes('--print-public');
  const checked = argv.includes('--i-have-checked-pending-envelopes');

  if (printOnly) {
    if (!existsSync(PRIVATE_JWK_PATH)) {
      console.error('No keypair on disk yet — run this script with no flags to mint one.');
      process.exit(1);
    }
    // ⚠️ Reads the PRIVATE file and prints only the PUBLIC members of it. The
    // private exponents (d, p, q, dp, dq, qi) are never touched by name here
    // because the fields are picked by an allowlist, not by exclusion — the
    // estate's default-deny projection rule, applied to a key.
    const jwk = JSON.parse(readFileSync(PRIVATE_JWK_PATH, 'utf8'));
    const kid = jwk.kid;
    if (!kid) {
      console.error(
        'The key on disk carries no kid. It predates this script; re-mint with --rotate after reading the warning.',
      );
      process.exit(1);
    }
    say('kid ' + kid, JSON.stringify(publicConstantFrom(jwk, kid), null, 2));
    return;
  }

  if (existsSync(PRIVATE_JWK_PATH) && !rotate) {
    console.error(
      'A provisioning keypair already exists at docs/access/keys/catalog-provisioning.private.jwk.',
      '\n\nMinting a second one would ORPHAN every envelope already sealed to the first:',
      '\nthe plaintext exists nowhere else, so there is nothing to re-wrap. Nothing was written.',
      '\n\nIf you genuinely mean to rotate — a stolen private key is the case design §6.5 names —',
      '\nread this script’s header, then run:',
      '\n  node scripts/catalog-key-mint.mjs --rotate --i-have-checked-pending-envelopes',
      '\n\nTo see what is pending first, from apps/auth-worker:',
      '\n  npx wrangler r2 object list estate-catalog-keys',
      '\n\nTo re-print the PUBLIC half of the key you already have:',
      '\n  node scripts/catalog-key-mint.mjs --print-public',
    );
    process.exit(1);
  }

  if (rotate && existsSync(PRIVATE_JWK_PATH) && !checked) {
    console.error(
      '--rotate replaces the keypair and makes every envelope in estate-catalog-keys',
      '\nPERMANENTLY undecryptable. There is no re-wrap.',
      '\n\nList them first, from apps/auth-worker:',
      '\n  npx wrangler r2 object list estate-catalog-keys',
      '\n\nAny reader/<id>.json there belongs to a request whose requester attached a key and',
      '\nwhose catalog has not been provisioned. Those people must be asked again.',
      '\n\nThen re-run with:  --rotate --i-have-checked-pending-envelopes',
    );
    process.exit(1);
  }

  const { publicJwk, privateJwk, kid } = await mintKeypair();

  mkdirSync(dirname(PRIVATE_JWK_PATH), { recursive: true });
  // The kid travels WITH the private key so the provisioner can verify an
  // envelope's kid without importing the public constant from a web bundle.
  writeFileSync(
    PRIVATE_JWK_PATH,
    `${JSON.stringify({ ...privateJwk, kid, alg: 'RSA-OAEP-256', minted: new Date().toISOString() }, null, 2)}\n`,
    { encoding: 'utf8', mode: 0o600 },
  );

  say(
    '',
    `Minted an RSA-OAEP-4096/SHA-256 provisioning keypair.`,
    '',
    `  kid            ${kid}`,
    `  private JWK    docs/access/keys/catalog-provisioning.private.jwk   (gitignored, never printed)`,
    '',
    'PUBLIC half — safe to publish, this is what ships in the browser bundle:',
    '',
    JSON.stringify(publicConstantFrom(publicJwk, kid), null, 2),
    '',
  );

  if (writePublic) {
    const src = readFileSync(SEAL_MODULE_PATH, 'utf8');
    writeFileSync(SEAL_MODULE_PATH, splicePublicKey(src, publicJwk, kid), 'utf8');
    say(
      'Spliced the public half into sites/heygabi-home/public/assets/catalog-seal.js.',
      '⚠️ Commit that file, and pin the kid in sites/heygabi-home/predeploy.checks.json',
      '   so a deploy that ships the old bundle fails loudly instead of sealing to a dead key.',
      '',
    );
  } else {
    say(
      'Not written to the bundle. Re-run with --write-public, or paste the block above',
      'between the @generated markers in assets/catalog-seal.js.',
      '',
    );
  }

  say(
    '⚠️ CUSTODY: this private key exists on this machine ONLY. Put a copy in 1Password',
    '   and record it in docs/access/RECOVERY.md — a secret with no reachable copy is a',
    '   named gap at the top of that document, not a footnote.',
    '',
  );
}

// `import`ed by the tests; run only when invoked directly.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(String(err && err.message ? err.message : err));
    process.exit(1);
  });
}
