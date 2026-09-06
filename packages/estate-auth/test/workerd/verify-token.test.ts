/**
 * `verify.ts` past the network boundary — a REAL token, verified.
 *
 * ⚠️ WHY THIS FILE EXISTS. The 2026-09-05 mutation run
 * (`docs/info/mutation-run-2026-09-05.md` §5 S1) is blunt about it: the two
 * most load-bearing lines in the estate's auth were unguarded.
 *
 * | id | the mutation that survived, with all 19 cases green |
 * |---|---|
 * | CP-24 | the `email_verified === false` refusal DELETED |
 * | CP-25 | `audience: projectId` dropped from `jwtVerify` — **any Firebase project's token accepted** |
 *
 * `verify.ts`'s own header calls the second one out in bold: *"Removing either
 * assertion turns this into 'any Google user of any Firebase app on the
 * internet', which is not a smaller check — it is no check."* Nothing failed
 * when it stopped being true, because `verify.test.ts`'s seven cases all stop
 * BEFORE `jwtVerify` is reached (the dev bypass, a misconfiguration throw, a
 * missing header, `readBearer`'s parsing). The coverage simply ended at the
 * network boundary. This file crosses it.
 *
 * ## How, with no production change and no network
 *
 * `jose` is already a dependency. The test generates an RSA keypair, publishes
 * its public half as a one-key JWKS from a stubbed `fetch`, and signs its own
 * tokens — so `jwtVerify` runs for real against a key set we control, and
 * `getJwks()` stays exactly as it is. ⚠️ **No seam was widened in `verify.ts`
 * to make this possible**, which was the alternative the mutation doc proposed
 * and which would have changed a security module to suit its test.
 *
 * ## ⚠️ Why it lives in `test/workerd/` and runs under `--conditions=workerd`
 *
 * `jose@5` ships two builds. Its **node** build fetches the JWKS with
 * `node:https.get`, which nothing in-process can intercept; its
 * **browser/worker** build uses global `fetch`, which is stubbable. The Worker
 * this module runs inside is `workerd`, so the worker build is **the one
 * production actually executes** — testing under that condition is more
 * faithful than the default, not less. The package's `test` script runs this
 * directory in a second pass with the flag; without it, these tests would
 * silently reach out to Google's real JWKS and fail on a key that is not
 * there.
 */

import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { exportJWK, generateKeyPair, SignJWT, type JWK, type KeyLike } from 'jose';
import { resolveIdentity } from '../../src/verify.js';

const JWKS_URL =
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

/** The project this verifier is pinned to, as `FIREBASE_PROJECT_ID` would set it. */
const PROJECT = 'audiobook-catalog';
/** A different Firebase project on the internet — validly signed by Google too. */
const OTHER_PROJECT = 'somebody-elses-app';

const ENV = { ENVIRONMENT: 'production', FIREBASE_PROJECT_ID: PROJECT } as const;

let signer: KeyLike;
/** A second keypair whose public half is NOT published — "validly signed" by nobody. */
let impostor: KeyLike;
let jwksHits = 0;

before(async () => {
  const real = await generateKeyPair('RS256', { extractable: true });
  const fake = await generateKeyPair('RS256', { extractable: true });
  signer = real.privateKey;
  impostor = fake.privateKey;

  const jwk: JWK = { ...(await exportJWK(real.publicKey)), kid: 'estate-test-kid', alg: 'RS256', use: 'sig' };

  // The ONE network call this module makes, served locally. Anything else is a
  // test bug and says so rather than reaching the internet.
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url !== JWKS_URL) throw new Error(`unexpected fetch: ${url}`);
    jwksHits++;
    return new Response(JSON.stringify({ keys: [jwk] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
});

interface TokenOpts {
  iss?: string;
  aud?: string;
  claims?: Record<string, unknown>;
  key?: 'signer' | 'impostor';
  /** Relative (`'5m'`) or an ABSOLUTE epoch-seconds value, which is how the expiry case reaches the past. */
  expiresAt?: string | number;
  issuedAt?: number;
}

async function mint(opts: TokenOpts = {}): Promise<string> {
  const {
    iss = `https://securetoken.google.com/${PROJECT}`,
    aud = PROJECT,
    claims = {},
    key = 'signer',
    expiresAt = '5m',
  } = opts;
  const jwt = new SignJWT({ email: 'member@example.test', email_verified: true, ...claims })
    .setProtectedHeader({ alg: 'RS256', kid: 'estate-test-kid' })
    .setIssuer(iss)
    .setAudience(aud)
    .setSubject('firebase-uid-1')
    .setIssuedAt(opts.issuedAt)
    .setExpirationTime(expiresAt);
  return jwt.sign(key === 'signer' ? signer : impostor);
}

function bearer(token: string): Request {
  return new Request('https://auth.heygabi.ai/api/estate/users', {
    headers: { Authorization: `Bearer ${token}` },
  });
}

// ---------------------------------------------------------------------------
// the happy path — proof the harness verifies rather than merely not-throwing
// ---------------------------------------------------------------------------

test('a token from the pinned project resolves, and every claim lands where it belongs', async () => {
  const token = await mint({ claims: { name: 'A Member', picture: 'https://x/p.png' } });
  const identity = await resolveIdentity(bearer(token), ENV);

  assert.deepEqual(identity, {
    email: 'member@example.test',
    uid: 'firebase-uid-1',
    name: 'A Member',
    picture: 'https://x/p.png',
  });
  assert.ok(jwksHits > 0, 'the JWKS was actually consulted — a null here would prove nothing');
});

// ---------------------------------------------------------------------------
// CP-25 — the audience assertion
// ---------------------------------------------------------------------------

test('🔴 CP-25: the SAME SIGNER with a DIFFERENT `aud` is refused — any Firebase project’s token is validly signed by Google', async () => {
  // The whole reason `audience` is asserted. Google signs every Firebase
  // project's tokens with the same key set, so a signature check alone admits
  // "any Google user of any Firebase app on the internet". `iss` is left
  // CORRECT here on purpose: this test must fail on the audience alone, or it
  // is not measuring the audience.
  const token = await mint({ aud: OTHER_PROJECT });
  assert.equal(await resolveIdentity(bearer(token), ENV), null);
});

test('🔴 the SAME SIGNER with a DIFFERENT `iss` is refused — the issuer half, measured on its own', async () => {
  // Mirror of the above with `aud` left correct, so neither assertion can be
  // deleted while the other silently covers for it.
  const token = await mint({ iss: `https://securetoken.google.com/${OTHER_PROJECT}` });
  assert.equal(await resolveIdentity(bearer(token), ENV), null);
});

test('🔴 a token for another project is refused even when its email is one of ours', async () => {
  // The attack the two assertions actually stop: the same human, the same
  // Google account, a token minted by an app we do not control. Email is the
  // estate's join key, so this token would otherwise resolve to a REAL member.
  const token = await mint({
    iss: `https://securetoken.google.com/${OTHER_PROJECT}`,
    aud: OTHER_PROJECT,
    claims: { email: 'owner@example.test' },
  });
  assert.equal(await resolveIdentity(bearer(token), ENV), null);
});

test('the project id is read from env, not baked in — a second project id verifies its own tokens', async () => {
  // Proof that the pin is `FIREBASE_PROJECT_ID` and nothing else: the same
  // token that fails above passes when the env names that project.
  const token = await mint({ iss: `https://securetoken.google.com/${OTHER_PROJECT}`, aud: OTHER_PROJECT });
  const identity = await resolveIdentity(bearer(token), {
    ENVIRONMENT: 'production',
    FIREBASE_PROJECT_ID: OTHER_PROJECT,
  });
  assert.equal(identity?.email, 'member@example.test');
});

// ---------------------------------------------------------------------------
// CP-24 — the unverified-email refusal
// ---------------------------------------------------------------------------

test('🔴 CP-24: `email_verified: false` is refused — the difference between "cannot sign in" and "signed in as somebody else"', async () => {
  // Firebase will mint tokens for unverified addresses, and email is the join
  // key everywhere (design §1.4). Admitting one means a stranger who typed a
  // household member's address becomes that member.
  const token = await mint({ claims: { email_verified: false } });
  assert.equal(await resolveIdentity(bearer(token), ENV), null);
});

test('⚠️ an ABSENT `email_verified` still resolves — the rule is `=== false`, not truthiness', async () => {
  // Written down because it is a deliberate line, not an oversight: the check
  // refuses an explicit denial and does not demand an explicit affirmation.
  // Tightening it to `!== true` would lock out any token shape that omits the
  // claim, so if that is ever wanted it should be a decision, not a drift.
  const token = await mint({ claims: { email_verified: undefined } });
  const identity = await resolveIdentity(bearer(token), ENV);
  assert.equal(identity?.email, 'member@example.test');
});

test('a token with NO email is refused — there is nothing to join on', async () => {
  const token = await mint({ claims: { email: undefined } });
  assert.equal(await resolveIdentity(bearer(token), ENV), null);
});

test('a non-string email is refused rather than coerced', async () => {
  const token = await mint({ claims: { email: 12345 } });
  assert.equal(await resolveIdentity(bearer(token), ENV), null);
});

// ---------------------------------------------------------------------------
// the rest of the closed door
// ---------------------------------------------------------------------------

test('🔴 a token signed by a key that is NOT in the JWKS is refused', async () => {
  // Same kid, same issuer, same audience, same claims — only the signature is
  // somebody else's. If this ever passes, nothing above means anything.
  const token = await mint({ key: 'impostor' });
  assert.equal(await resolveIdentity(bearer(token), ENV), null);
});

test('an EXPIRED token is refused, however correct the rest of it is', async () => {
  // ⚠️ An ABSOLUTE epoch expiry: `setExpirationTime('1s')` is relative to NOW
  // and would mint a token that is still valid, which is a test that measures
  // nothing (it caught itself the first time this file ran).
  const past = Math.floor(Date.now() / 1000) - 7200;
  const token = await mint({ issuedAt: past, expiresAt: past + 60 });
  assert.equal(await resolveIdentity(bearer(token), ENV), null);
});

test('garbage in the Authorization header is refused, and does not throw', async () => {
  // A 401 is the answer; an exception here would surface as a 500 and read as
  // an outage rather than a refusal.
  for (const value of ['Bearer not.a.jwt', 'Bearer ', 'Basic abc123']) {
    const req = new Request('https://auth.heygabi.ai/x', { headers: { Authorization: value } });
    assert.equal(await resolveIdentity(req, ENV), null, value);
  }
});

test('⚠️ the dev bypass is still unreachable in production, with a valid token present', async () => {
  // `ENVIRONMENT === 'development'` is the affirmative check (the 2026-08-10
  // hardening). A DEV_EMAIL set in production must be inert — and this is the
  // one test in the file that proves the bypass loses to real verification
  // rather than merely being absent.
  const token = await mint({ claims: { email: 'real@example.test' } });
  const identity = await resolveIdentity(bearer(token), {
    ENVIRONMENT: 'production',
    FIREBASE_PROJECT_ID: PROJECT,
    DEV_EMAIL: 'imposter@example.test',
  });
  assert.equal(identity?.email, 'real@example.test');
});
