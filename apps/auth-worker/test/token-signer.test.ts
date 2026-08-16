import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ServiceAccount } from '../src/firebase-sa.js';
import {
  CUSTOM_TOKEN_AUD,
  CUSTOM_TOKEN_TTL_SECONDS,
  customTokenClaims,
  mintCustomToken,
  tokenSignerOrUnset,
} from '../src/token-signer.js';

// ---------------------------------------------------------------------------
// customTokenClaims — the §3.3-verified shape, pure (no key needed)
// ---------------------------------------------------------------------------

test('customTokenClaims: iss = sub = SA email, aud fixed, exp = iat+300 (§3.3/§4.3)', () => {
  const sa: ServiceAccount = {
    client_email: 'estate-token-minter@audiobook-catalog.iam.gserviceaccount.com',
    private_key: 'unused-here',
    project_id: 'audiobook-catalog',
  };
  const claims = customTokenClaims(sa, 'uid-abc123', 1_700_000_000);
  assert.deepEqual(claims, {
    iss: sa.client_email,
    sub: sa.client_email,
    aud: CUSTOM_TOKEN_AUD,
    iat: 1_700_000_000,
    exp: 1_700_000_300,
    uid: 'uid-abc123',
  });
  assert.equal(CUSTOM_TOKEN_TTL_SECONDS, 300);
  assert.ok(CUSTOM_TOKEN_AUD.includes('identitytoolkit'));
});

// ---------------------------------------------------------------------------
// tokenSignerOrUnset — the 503 idiom (same shape as service_account_unset /
// app_tokens_unset elsewhere in this Worker)
// ---------------------------------------------------------------------------

test('tokenSignerOrUnset: unset → the 503 shape, naming the exact fix command', () => {
  const r = tokenSignerOrUnset(undefined);
  assert.equal(r.sa, null);
  assert.deepEqual(r.unset, { error: 'token_signer_unset', fix: 'wrangler secret put TOKEN_SIGNER_KEY' });
});

test('tokenSignerOrUnset: empty string is also "unset"', () => {
  const r = tokenSignerOrUnset('');
  assert.equal(r.sa, null);
});

test('tokenSignerOrUnset: present + well-formed → the parsed SA, no unset payload', () => {
  const raw = JSON.stringify({ client_email: 'a@b.iam.gserviceaccount.com', private_key: 'PEM', project_id: 'p' });
  const r = tokenSignerOrUnset(raw);
  assert.deepEqual(r.sa, { client_email: 'a@b.iam.gserviceaccount.com', private_key: 'PEM', project_id: 'p' });
  assert.equal(r.unset, null);
});

test('tokenSignerOrUnset: present but malformed throws loudly (a deploy bug, not "unset")', () => {
  assert.throws(() => tokenSignerOrUnset('not json{'), /not valid JSON/);
});

// ---------------------------------------------------------------------------
// mintCustomToken — the real WebCrypto RS256 signer, end to end against a
// throwaway keypair generated in-test (no network, no real Google key).
// This is the strongest confidence available without the owner's actual
// TOKEN_SIGNER_KEY: it proves the signature this Worker produces is a real,
// verifiable RS256 signature over exactly the claims customTokenClaims()
// specifies — everything EXCEPT Google's own acceptance of it (§10 of
// sso-design.md names that as the one thing this build cannot verify).
// ---------------------------------------------------------------------------

async function generateTestServiceAccount(): Promise<{ sa: ServiceAccount; publicKey: CryptoKey }> {
  const { privateKey, publicKey } = (await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  const pkcs8 = (await crypto.subtle.exportKey('pkcs8', privateKey)) as ArrayBuffer;
  const b64 = Buffer.from(pkcs8).toString('base64');
  const pem = `-----BEGIN PRIVATE KEY-----\n${(b64.match(/.{1,64}/g) ?? []).join('\n')}\n-----END PRIVATE KEY-----\n`;
  return {
    sa: {
      client_email: 'estate-token-minter@audiobook-catalog.iam.gserviceaccount.com',
      private_key: pem,
      project_id: 'audiobook-catalog',
    },
    publicKey,
  };
}

test('mintCustomToken: RS256, three segments, claims match customTokenClaims(), signature verifies', async () => {
  const { sa, publicKey } = await generateTestServiceAccount();
  const token = await mintCustomToken(sa, 'uid-real-user');

  const parts = token.split('.');
  assert.equal(parts.length, 3);
  const [h, p, s] = parts as [string, string, string];

  const header = JSON.parse(Buffer.from(h, 'base64url').toString());
  assert.deepEqual(header, { alg: 'RS256', typ: 'JWT' });

  const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
  assert.equal(payload.iss, sa.client_email);
  assert.equal(payload.sub, sa.client_email);
  assert.equal(payload.aud, CUSTOM_TOKEN_AUD);
  assert.equal(payload.uid, 'uid-real-user');
  assert.equal(payload.exp - payload.iat, CUSTOM_TOKEN_TTL_SECONDS);
  assert.ok(Math.abs(payload.iat - Math.floor(Date.now() / 1000)) < 10, 'iat is close to now');

  const sigBytes = Buffer.from(s, 'base64url');
  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    publicKey,
    sigBytes,
    new TextEncoder().encode(`${h}.${p}`),
  );
  assert.ok(valid, 'the signature verifies against the SA public key — a real RS256 signature, not a placeholder');
});

test('mintCustomToken: two different uids produce different token payloads', async () => {
  const { sa } = await generateTestServiceAccount();
  const t1 = await mintCustomToken(sa, 'uid-x');
  const t2 = await mintCustomToken(sa, 'uid-y');
  assert.notEqual(t1, t2);
});
