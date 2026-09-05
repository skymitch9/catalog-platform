/**
 * The sealed Claude key, end to end, with a THROWAWAY keypair (design §6).
 *
 * ⚠️ WHY THIS IS THE TEST THAT MATTERS. The envelope is produced by a browser
 * module and opened by a Node script in a different directory, written by two
 * different agents against a contract pinned in prose. Prose agreement is not
 * agreement: the only proof is bytes in, bytes out. So these tests import the
 * REAL `sites/heygabi-home/public/assets/catalog-seal.js` — the exact file the
 * browser downloads — and the REAL `scripts/lib/catalog-seal.mjs`, and make one
 * open what the other sealed.
 *
 * 🔴 THE REAL PROVISIONING KEYPAIR IS NEVER TOUCHED HERE. Every test mints its
 * own in memory. A test that read `docs/access/keys/` would be a test that puts
 * the private key in a stack trace the first time it failed.
 *
 * Node ≥ 20 ships the same WebCrypto the browser does, which is what makes this
 * possible at all — and is itself a fact worth pinning: if it were not the same
 * implementation, a green suite here would say nothing about a real submit.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { webcrypto } from 'node:crypto';

import {
  CATALOG_PROVISIONING_KID,
  CATALOG_PROVISIONING_PUBLIC_JWK,
  CATALOG_SEAL_ALG,
  CATALOG_SEAL_MAX_ENVELOPE_BYTES,
  CATALOG_SEAL_MAX_PLAINTEXT_BYTES,
  SealError,
  plaintextBytes,
  sealSecret,
  sealSupported,
} from '../../sites/heygabi-home/public/assets/catalog-seal.js';
import { mintKeypair, kidFromSpki, publicConstantFrom, splicePublicKey } from '../catalog-key-mint.mjs';
import {
  BUCKET,
  assertEnvelopeShape,
  decryptEnvelope,
  envelopeCandidates,
  injectSealedKey,
  looksAbsent,
  looksBucketMissing,
} from '../lib/catalog-seal.mjs';

/** One throwaway keypair for the whole file — minting 4096 bits is not free. */
const throwaway = await mintKeypair();
const SEAL_OPTS = { publicJwk: throwaway.publicJwk, kid: throwaway.kid };

/** A private JWK shaped exactly as catalog-key-mint writes it to disk. */
const PRIVATE = { ...throwaway.privateJwk, kid: throwaway.kid, alg: 'RSA-OAEP-256' };

/** Looks like an Anthropic key and is not one. */
const FAKE_KEY = 'sk-ant-api03-THROWAWAY-not-a-real-key-0000000000000000000000000000';

describe('the envelope contract, pinned 2026-09-05', () => {
  it('seals to the six fields the server validates, and nothing else', async () => {
    const env = await sealSecret(FAKE_KEY, SEAL_OPTS);
    assert.deepEqual(Object.keys(env).sort(), ['alg', 'ct', 'ek', 'iv', 'kid', 'v']);
    assert.equal(env.v, 1);
    assert.equal(env.alg, CATALOG_SEAL_ALG);
    assert.equal(env.alg, 'RSA-OAEP-256+A256GCM'); // the literal, so a rename is caught
    assert.equal(env.kid, throwaway.kid);
    for (const f of ['ek', 'iv', 'ct']) assert.equal(typeof env[f], 'string');
  });

  it('every base64 field decodes, and to the sizes the algorithm implies', async () => {
    const env = await sealSecret(FAKE_KEY, SEAL_OPTS);
    // 4096-bit RSA-OAEP ciphertext is exactly one modulus: 512 bytes.
    assert.equal(Buffer.from(env.ek, 'base64').length, 512);
    // AES-GCM's IV is 12 bytes — the WebCrypto default and the pinned contract.
    assert.equal(Buffer.from(env.iv, 'base64').length, 12);
    // ciphertext + the 16-byte tag WebCrypto appends.
    assert.equal(Buffer.from(env.ct, 'base64').length, plaintextBytes(FAKE_KEY) + 16);
  });

  it('a serialized envelope stays well under the 8 KB ceiling, even at the plaintext limit', async () => {
    const max = 'k'.repeat(CATALOG_SEAL_MAX_PLAINTEXT_BYTES);
    const env = await sealSecret(max, SEAL_OPTS);
    const bytes = Buffer.byteLength(JSON.stringify(env), 'utf8');
    assert.ok(
      bytes <= CATALOG_SEAL_MAX_ENVELOPE_BYTES,
      `a maximal envelope serialized to ${bytes} bytes, over the ${CATALOG_SEAL_MAX_ENVELOPE_BYTES} ceiling`,
    );
    // Measured 2026-09-05: ~1.5 KB. Pinned loosely — this is a headroom check,
    // not a golden number, and a tight assertion here would fail on a key size
    // change that is otherwise fine.
    assert.ok(bytes < 3000, `expected roughly 1.5 KB, got ${bytes}`);
  });

  it('a fresh symmetric key and IV per call — two seals of one secret never match', async () => {
    const a = await sealSecret(FAKE_KEY, SEAL_OPTS);
    const b = await sealSecret(FAKE_KEY, SEAL_OPTS);
    assert.notEqual(a.ct, b.ct);
    assert.notEqual(a.iv, b.iv);
    assert.notEqual(a.ek, b.ek);
  });
});

describe('round trip — the browser seals, the provisioner opens', () => {
  it('bytes in, bytes out', async () => {
    const env = await sealSecret(FAKE_KEY, SEAL_OPTS);
    assert.equal(await decryptEnvelope(env, PRIVATE), FAKE_KEY);
  });

  it('survives multi-byte UTF-8 — the length check is in BYTES, not characters', async () => {
    const odd = 'sk-ant-«clé»-Ω-🔑-0123456789';
    const env = await sealSecret(odd, SEAL_OPTS);
    assert.equal(await decryptEnvelope(env, PRIVATE), odd);
  });

  it('a tampered ciphertext does not decrypt — GCM authenticates, it does not just hide', async () => {
    const env = await sealSecret(FAKE_KEY, SEAL_OPTS);
    const raw = Buffer.from(env.ct, 'base64');
    raw[0] ^= 0xff;
    await assert.rejects(() => decryptEnvelope({ ...env, ct: raw.toString('base64') }, PRIVATE));
  });

  it('a second keypair cannot open the first one’s envelope', async () => {
    const other = await mintKeypair();
    const env = await sealSecret(FAKE_KEY, { publicJwk: other.publicJwk, kid: other.kid });
    await assert.rejects(
      () => decryptEnvelope(env, PRIVATE),
      // ⚠️ The kid check fires FIRST and says so in words. That sentence is the
      // whole reason the kid exists: rotation is a design feature (§6.5) and it
      // must not surface as an unexplained crypto error.
      (err) => /sealed to key/.test(err.message) && /rotated/.test(err.message),
    );
  });
});

describe('what sealSecret refuses, in words', () => {
  it('an over-long plaintext is refused BEFORE any crypto runs', async () => {
    const tooLong = 'x'.repeat(CATALOG_SEAL_MAX_PLAINTEXT_BYTES + 1);
    await assert.rejects(
      () => sealSecret(tooLong, SEAL_OPTS),
      (err) => {
        assert.ok(err instanceof SealError);
        assert.equal(err.code, 'too_long');
        assert.match(err.message, /nothing was sent/);
        return true;
      },
    );
  });

  it('the limit counts BYTES — 200 four-byte characters is over a 512-byte limit', async () => {
    const emoji = '🔑'.repeat(200); // 800 UTF-8 bytes, but only 400 UTF-16 code units
    assert.ok(emoji.length < CATALOG_SEAL_MAX_PLAINTEXT_BYTES, 'the trap: String.length would pass this');
    await assert.rejects(() => sealSecret(emoji, SEAL_OPTS), (err) => err.code === 'too_long');
  });

  it('an empty or whitespace field is its own code, never sealed as an empty key', async () => {
    for (const v of ['', '   ', null, undefined]) {
      await assert.rejects(() => sealSecret(v, SEAL_OPTS), (err) => err.code === 'empty');
    }
  });

  it('every refusal is a sentence, never jargon and never the value', async () => {
    const err = await sealSecret('x'.repeat(999), SEAL_OPTS).catch((e) => e);
    assert.ok(!/DOMException|OperationError|undefined/.test(err.message));
    assert.ok(!err.message.includes('xxx'));
  });
});

describe('sealSupported — the fail-quiet gate', () => {
  it('true under Node ≥ 20, which ships the browser’s WebCrypto', () => {
    assert.equal(sealSupported(), true);
  });

  it('false when the page is not a secure context', () => {
    const had = Object.prototype.hasOwnProperty.call(globalThis, 'isSecureContext');
    const prev = globalThis.isSecureContext;
    globalThis.isSecureContext = false;
    try {
      assert.equal(sealSupported(), false);
    } finally {
      if (had) globalThis.isSecureContext = prev;
      else delete globalThis.isSecureContext;
    }
  });
});

describe('the shipped public constant', () => {
  it('is a real 4096-bit RSA key, not the placeholder', () => {
    assert.equal(CATALOG_PROVISIONING_PUBLIC_JWK.kty, 'RSA');
    assert.equal(CATALOG_PROVISIONING_PUBLIC_JWK.e, 'AQAB');
    assert.match(CATALOG_PROVISIONING_KID, /^[0-9a-f]{16}$/);
    // 4096 bits = 512 bytes of modulus.
    assert.equal(Buffer.from(CATALOG_PROVISIONING_PUBLIC_JWK.n, 'base64url').length, 512);
  });

  it('the constant’s own kid matches the exported one — a hand edit that split them fails here', () => {
    assert.equal(CATALOG_PROVISIONING_PUBLIC_JWK.kid, CATALOG_PROVISIONING_KID);
  });

  it('seals with the SHIPPED key without the test seam, and nobody here can open it', async () => {
    // ⚠️ This is the closest a test can get to a real submit: no `opts`, so the
    // module reaches for its own constant. It proves the shipped key IMPORTS
    // and ENCRYPTS. It cannot prove the round trip, because the private half is
    // not readable from here — and that is the property, not a gap.
    const env = await sealSecret(FAKE_KEY);
    assert.equal(env.kid, CATALOG_PROVISIONING_KID);
    assert.equal(Buffer.from(env.ek, 'base64').length, 512);
  });
});

describe('kid derivation and the --write-public splice', () => {
  it('the kid is 16 hex of SHA-256 over the SPKI DER, and is stable', async () => {
    const spki = await webcrypto.subtle.exportKey(
      'spki',
      await webcrypto.subtle.importKey(
        'jwk',
        throwaway.publicJwk,
        { name: 'RSA-OAEP', hash: 'SHA-256' },
        true,
        ['encrypt'],
      ),
    );
    assert.equal(kidFromSpki(spki), throwaway.kid);
    assert.match(throwaway.kid, /^[0-9a-f]{16}$/);
  });

  it('the splice replaces only the generated block and keeps the prose around it', () => {
    const src = [
      '/** header prose that a later reader needs */',
      '/* @generated:public-key-start — old banner */',
      "export const CATALOG_PROVISIONING_KID = 'dead';",
      'export const CATALOG_PROVISIONING_PUBLIC_JWK = Object.freeze({ n: "old" });',
      '/* @generated:public-key-end */',
      'export const AFTER = 1;',
    ].join('\n');
    const out = splicePublicKey(src, throwaway.publicJwk, throwaway.kid);
    assert.match(out, /header prose that a later reader needs/);
    assert.match(out, /export const AFTER = 1;/);
    assert.ok(!out.includes("'dead'"));
    assert.ok(!out.includes('"old"'));
    assert.match(out, new RegExp(`CATALOG_PROVISIONING_KID = "${throwaway.kid}"`));
  });

  it('refuses a file whose markers are gone rather than writing the key somewhere arbitrary', () => {
    assert.throws(() => splicePublicKey('no markers here', throwaway.publicJwk, throwaway.kid), /generated block/);
  });

  it('the public constant carries no private material — an allowlist, not an exclusion', () => {
    const pub = publicConstantFrom(throwaway.privateJwk, throwaway.kid);
    assert.deepEqual(Object.keys(pub), ['kty', 'n', 'e', 'alg', 'ext', 'kid']);
    for (const secret of ['d', 'p', 'q', 'dp', 'dq', 'qi']) {
      assert.ok(!(secret in pub), `the private member ${secret} reached the public constant`);
    }
  });
});

describe('assertEnvelopeShape — the provisioner’s second lock', () => {
  it('accepts a real envelope', async () => {
    const env = await sealSecret(FAKE_KEY, SEAL_OPTS);
    assert.doesNotThrow(() => assertEnvelopeShape(env));
  });

  it('refuses an unknown version, an unknown alg, and a missing field — each by name', () => {
    const ok = { v: 1, alg: CATALOG_SEAL_ALG, kid: 'k', ek: 'a', iv: 'b', ct: 'c' };
    assert.throws(() => assertEnvelopeShape({ ...ok, v: 2 }), /version/);
    assert.throws(() => assertEnvelopeShape({ ...ok, alg: 'AES-CBC' }), /alg/);
    assert.throws(() => assertEnvelopeShape({ ...ok, ct: 42 }), /"ct"/);
    assert.throws(() => assertEnvelopeShape(null), /JSON object/);
  });
});

describe('envelopeCandidates — order is the policy', () => {
  it('reader before owner, always (§6.4 rows 1 and 2)', () => {
    assert.deepEqual(envelopeCandidates(7), [
      { source: 'reader', key: 'reader/7.json' },
      { source: 'owner', key: 'owner/7.json' },
    ]);
  });

  it('refuses anything that is not a positive integer id', () => {
    for (const bad of ['4; DROP TABLE', 0, -1, 1.5, null, undefined, '../../etc']) {
      assert.throws(() => envelopeCandidates(bad), /positive integer/);
    }
  });
});

/* ------------------------------------------------------------------------- *
 * injectSealedKey — the decisions, with a stubbed wrangler
 * ------------------------------------------------------------------------- */

/**
 * A wrangler that exists only in memory. ⚠️ It RECORDS what it was asked to do,
 * including the secret value, so the tests can assert the value reached
 * `secret put` — the stub is the only place plaintext is legitimately visible,
 * because the stub IS the destination.
 */
function stubRunner(objects, { putExit = 0, delFails = false } = {}) {
  const calls = { get: [], put: [], del: [] };
  return {
    calls,
    get(key) {
      calls.get.push(key);
      const body = objects[key];
      return body ? { found: true, bytes: Buffer.from(body, 'utf8') } : { found: false, bytes: null };
    },
    del(key) {
      calls.del.push(key);
      if (delFails) return { ok: false, detail: 'stubbed failure' };
      delete objects[key];
      return { ok: true, detail: '' };
    },
    async putSecret(args) {
      calls.put.push(args);
      return putExit;
    },
  };
}

async function envelopeJson(plaintext) {
  return JSON.stringify(await sealSecret(plaintext, SEAL_OPTS));
}

describe('injectSealedKey', () => {
  const WORKER = '/tmp/some-worker';

  it('the reader’s key WINS when both envelopes exist (§6.4 row 1)', async () => {
    const objects = {
      'reader/4.json': await envelopeJson('reader-key-value'),
      'owner/4.json': await envelopeJson('owner-key-value'),
    };
    const runner = stubRunner(objects);
    const lines = [];
    const out = await injectSealedKey({
      requestId: 4,
      workerDir: WORKER,
      envName: 'amber',
      runner,
      log: (l) => lines.push(l),
      privateJwkPath: writeTempJwk(),
    });
    assert.equal(out.source, 'reader');
    assert.equal(runner.calls.put.length, 1);
    assert.equal(runner.calls.put[0].value, 'reader-key-value');
    assert.equal(runner.calls.put[0].name, 'ANTHROPIC_API_KEY');
    assert.equal(runner.calls.put[0].env, 'amber');
    assert.equal(runner.calls.put[0].cwd, WORKER);
    // The owner's envelope was never opened, and the reader's is gone.
    assert.deepEqual(runner.calls.del, ['reader/4.json']);
    assert.ok(!('reader/4.json' in objects));
    assert.ok('owner/4.json' in objects);
    assert.match(lines.join('\n'), /reader key used/);
  });

  it('falls through to the owner’s envelope when the reader attached none', async () => {
    const objects = { 'owner/9.json': await envelopeJson('owner-key-value') };
    const runner = stubRunner(objects);
    const lines = [];
    const out = await injectSealedKey({
      requestId: 9,
      workerDir: WORKER,
      envName: 'amber',
      runner,
      log: (l) => lines.push(l),
      privateJwkPath: writeTempJwk(),
    });
    assert.equal(out.source, 'owner');
    assert.equal(runner.calls.put[0].value, 'owner-key-value');
    assert.deepEqual(runner.calls.get, ['reader/9.json', 'owner/9.json']);
    assert.match(lines.join('\n'), /owner-at-accept key used/);
  });

  it('“none” is a normal answer, not a throw — the caller applies §6.4 row 3', async () => {
    const runner = stubRunner({});
    const out = await injectSealedKey({
      requestId: 1,
      workerDir: WORKER,
      envName: 'amber',
      runner,
      log: () => {},
      privateJwkPath: writeTempJwk(),
    });
    assert.equal(out.source, 'none');
    assert.equal(runner.calls.put.length, 0);
    assert.equal(runner.calls.del.length, 0);
  });

  it('🔴 a failed secret put does NOT delete the envelope', async () => {
    const objects = { 'reader/4.json': await envelopeJson('reader-key-value') };
    const runner = stubRunner(objects, { putExit: 1 });
    await assert.rejects(
      () =>
        injectSealedKey({
          requestId: 4,
          workerDir: WORKER,
          envName: 'amber',
          runner,
          log: () => {},
          privateJwkPath: writeTempJwk(),
        }),
      (err) => /exited 1/.test(err.message) && /left in place/.test(err.message),
    );
    assert.equal(runner.calls.del.length, 0);
    assert.ok('reader/4.json' in objects, 'the only copy of the key was deleted after a failed put');
  });

  it('a failed DELETE is reported and does not fail the step — the key already landed', async () => {
    const objects = { 'reader/4.json': await envelopeJson('reader-key-value') };
    const runner = stubRunner(objects, { delFails: true });
    const lines = [];
    const out = await injectSealedKey({
      requestId: 4,
      workerDir: WORKER,
      envName: 'amber',
      runner,
      log: (l) => lines.push(l),
      privateJwkPath: writeTempJwk(),
    });
    assert.equal(out.source, 'reader');
    assert.match(lines.join('\n'), /the key is set, but/);
    assert.match(lines.join('\n'), /r2 object delete/);
  });

  it('🔴 the plaintext is never returned, never logged, and never in an error', async () => {
    const SECRET = 'sk-ant-CANARY-9f2b7c';
    const objects = { 'reader/4.json': await envelopeJson(SECRET) };
    const runner = stubRunner(objects);
    const lines = [];
    const out = await injectSealedKey({
      requestId: 4,
      workerDir: WORKER,
      envName: 'amber',
      runner,
      log: (l) => lines.push(l),
      privateJwkPath: writeTempJwk(),
    });
    assert.deepEqual(out, { source: 'reader' });
    assert.ok(!JSON.stringify(out).includes('CANARY'));
    assert.ok(!lines.join('\n').includes('CANARY'), 'the plaintext reached the log');
    // The only place it legitimately appears is the stub standing in for wrangler.
    assert.equal(runner.calls.put[0].value, SECRET);
  });

  it('dry: true reports presence by KEY NAME and touches nothing', async () => {
    const objects = { 'owner/12.json': await envelopeJson('owner-key-value') };
    const runner = stubRunner(objects);
    const lines = [];
    const out = await injectSealedKey({
      requestId: 12,
      workerDir: WORKER,
      envName: 'amber',
      dry: true,
      runner,
      log: (l) => lines.push(l),
    });
    assert.equal(out.source, 'owner');
    assert.equal(runner.calls.put.length, 0);
    assert.equal(runner.calls.del.length, 0);
    const text = lines.join('\n');
    assert.match(text, new RegExp(`${BUCKET}/reader/12\\.json`));
    assert.match(text, new RegExp(`${BUCKET}/owner/12\\.json`));
    assert.match(text, /PRESENT/);
    assert.match(text, /absent/);
    assert.ok(!text.includes('owner-key-value'));
  });

  it('dry with nothing attached says the owner’s key will be used, and names the decision', async () => {
    const lines = [];
    const out = await injectSealedKey({
      requestId: 3,
      workerDir: WORKER,
      envName: 'amber',
      dry: true,
      runner: stubRunner({}),
      log: (l) => lines.push(l),
    });
    assert.equal(out.source, 'none');
    assert.match(lines.join('\n'), /standing decision 2026-09-05/);
  });

  it('refuses a non-JSON object rather than guessing', async () => {
    const runner = stubRunner({ 'reader/4.json': 'not json at all' });
    await assert.rejects(
      () =>
        injectSealedKey({
          requestId: 4,
          workerDir: WORKER,
          envName: 'amber',
          runner,
          log: () => {},
          privateJwkPath: writeTempJwk(),
        }),
      /is not JSON/,
    );
  });
});

/* The throwaway private key, written to a scratch file because injectSealedKey
 * reads it from disk exactly as the real run does. ⚠️ Under the session's own
 * scratch dir, never the repo. */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tempJwkPath = null;
function writeTempJwk() {
  if (tempJwkPath) return tempJwkPath;
  const dir = mkdtempSync(join(tmpdir(), 'catalog-seal-test-'));
  tempJwkPath = join(dir, 'throwaway.private.jwk');
  writeFileSync(tempJwkPath, JSON.stringify(PRIVATE), 'utf8');
  return tempJwkPath;
}

describe('🔴 what wrangler ACTUALLY says when an envelope is not there', () => {
  // MEASURED 2026-09-05, wrangler 4.123.0, against the real (not yet created)
  // bucket. Pinned as fixtures because the first version of defaultRunner().get
  // read "any stdout means a hit" — and a missing object exits 127 with a
  // SINGLE NEWLINE on stdout, so every absent envelope reported PRESENT.
  const MISSING_KEY = 'X [ERROR] The specified key does not exist.';
  const MISSING_BUCKET = 'X [ERROR] The specified bucket does not exist.';

  it('a missing key and a missing bucket both read as absent', () => {
    assert.equal(looksAbsent(MISSING_KEY), true);
    assert.equal(looksAbsent(MISSING_BUCKET), true);
    assert.equal(looksAbsent('NoSuchKey'), true);
  });

  it('a missing BUCKET is distinguished, so "not deployed yet" is not read as "no key attached"', () => {
    assert.equal(looksBucketMissing(MISSING_BUCKET), true);
    assert.equal(looksBucketMissing(MISSING_KEY), false);
  });

  it('a real failure is NOT absent — an auth or network error must surface', () => {
    for (const real of [
      'Authentication error [code: 10000]',
      'A request to the Cloudflare API failed.',
      'fetch failed',
      '',
    ]) {
      assert.equal(looksAbsent(real), false, `"${real}" was misread as an absent object`);
    }
  });
});
