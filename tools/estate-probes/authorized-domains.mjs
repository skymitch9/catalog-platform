#!/usr/bin/env node
/**
 * authorized-domains.mjs — OPTIONAL, CREDENTIALED probe.
 *
 * Built 2026-08-16 for a real incident: earlier tonight the apex
 * (`heygabi.ai`) was accidentally REMOVED from Firebase's authorised-domain
 * list during unrelated cleanup and estate-wide sign-in broke — and nothing
 * caught it. This probe asserts the four estate origins (`heygabi.ai`,
 * `audiobooks.heygabi.ai`, `library.heygabi.ai`, `boardgames.heygabi.ai`)
 * are ALL present in that list, read straight from the source of truth:
 * `GET https://identitytoolkit.googleapis.com/admin/v2/projects/{project}/config`.
 *
 * ⚠️ NOT part of `npm run probe:estate` and NOT imported by `run.mjs`, ON
 * PURPOSE. `README.md`'s contract for the rest of this suite is STRICTLY
 * READ-ONLY, UNAUTHENTICATED-EDGE — no token minted, no secret read, safe
 * for anyone to run with zero credentials. This script necessarily breaks
 * that contract (reading Firebase Auth config needs a real Google access
 * token), so it stays a clearly separate, explicitly opt-in script instead
 * of being bolted onto the zero-auth suite. Run it by hand, or wire it into
 * a job that already holds the credential — it must never be assumed to run
 * by default, and the default `npm run probe:estate` does not touch it.
 *
 * Needs: FIREBASE_SERVICE_ACCOUNT_PATH env var, pointing at a Firebase
 * service-account JSON in the shape `apps/auth-worker/src/firebase-sa.ts`
 * already parses (`client_email`, `private_key`, `project_id`). No env var,
 * or no file at that path → SKIPPED, exit 0. That is the expected state for
 * anyone running this repo without the credential, not a failure — do not
 * make this a hard requirement of anything.
 *
 * Mechanics are the exact ones `docs/info/sso-design.md` §3.3 verified and
 * `apps/auth-worker/src/firebase-sa.ts` already runs in the Worker: a Google
 * OAuth2 access token is just an RS256 JWT grant-assertion signed with the
 * service account's own private key (WebCrypto `importKey` pkcs8 → `sign`
 * RSASSA-PKCS1-v1_5/SHA-256), exchanged at `oauth2.googleapis.com/token`.
 * Deliberately RE-IMPLEMENTED here rather than imported — `firebase-sa.ts`
 * is Worker TypeScript under `apps/auth-worker`, not importable from plain
 * Node tooling without a build step, and this tool tree's whole ethos
 * (`tools/README.md`) is zero dependencies, zero build. Node's global
 * `crypto.subtle` (Node 20+) is the same WebCrypto API the Worker uses.
 *
 * ⚠️ NEVER logs the service-account JSON, the private key, or the minted
 * access token. Only authorised-domain HOSTNAMES are printed — public
 * information, already visible in every CSP header this repo ships.
 */

import { readFileSync, existsSync } from 'node:fs';
import { check, printTable, counts } from './lib/kit.mjs';

/** The estate's four origins (bare hostnames — that is the shape Firebase's
 * authorizedDomains list uses, no scheme). Lifted from lib/origins.mjs's
 * production hosts, not re-imported, because that file's constants carry a
 * scheme (`https://...`) this comparison must NOT have. */
const REQUIRED_DOMAINS = [
  { id: 'D1', host: 'heygabi.ai' },
  { id: 'D2', host: 'audiobooks.heygabi.ai' },
  { id: 'D3', host: 'library.heygabi.ai' },
  { id: 'D4', host: 'boardgames.heygabi.ai' },
];

/** Broad on purpose: identitytoolkit for the Identity Platform admin config
 * read, cloud-platform as a fallback some project IAM grants key off
 * instead. Requesting an unused scope costs nothing; the service account's
 * actual GCP IAM role is what gates the call, not the scope string. */
const SA_SCOPES =
  'https://www.googleapis.com/auth/identitytoolkit https://www.googleapis.com/auth/cloud-platform';

const b64url = (bytes) =>
  Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlOfJson = (obj) => b64url(Buffer.from(JSON.stringify(obj)));

async function importPrivateKey(pem) {
  const body = pem
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s+/g, '');
  const der = Buffer.from(body, 'base64');
  return crypto.subtle.importKey(
    'pkcs8',
    der,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

/** Mint a one-shot Google OAuth2 access token for the service account.
 * No caching — this script runs once and exits, unlike the Worker's
 * per-isolate cache in firebase-sa.ts. */
async function mintAccessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64urlOfJson({ alg: 'RS256', typ: 'JWT' });
  const claims = b64urlOfJson({
    iss: sa.client_email,
    scope: SA_SCOPES,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  });
  const signingInput = `${header}.${claims}`;
  const key = await importPrivateKey(sa.private_key);
  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(signingInput),
  );
  const jwt = `${signingInput}.${b64url(new Uint8Array(sig))}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  if (!res.ok) {
    // Google's error body names the grant problem, never key material.
    throw new Error(`OAuth token exchange failed (${res.status}): ${await res.text()}`);
  }
  const data = await res.json();
  return data.access_token;
}

/** null when there is no credential to use — the expected, non-failure case. */
function loadServiceAccount() {
  const path = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (!path) {
    console.log(
      'authorized-domains: FIREBASE_SERVICE_ACCOUNT_PATH is not set — SKIPPED.\n' +
        '  This probe is optional and credentialed; see tools/estate-probes/README.md\n' +
        '  ("authorized-domains.mjs — optional, credentialed") for how to run it.',
    );
    return null;
  }
  if (!existsSync(path)) {
    console.log(`authorized-domains: no file at ${path} — SKIPPED.`);
    return null;
  }
  let raw;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    throw new Error(`FIREBASE_SERVICE_ACCOUNT_PATH does not parse as JSON: ${e.message}`);
  }
  for (const field of ['client_email', 'private_key', 'project_id']) {
    if (typeof raw[field] !== 'string' || raw[field].length === 0) {
      throw new Error(`service account JSON is missing "${field}"`);
    }
  }
  return raw;
}

async function main() {
  console.log(
    'authorized-domains: OPTIONAL, CREDENTIALED probe — NOT part of `npm run probe:estate`.\n',
  );

  const sa = loadServiceAccount();
  if (!sa) {
    process.exitCode = 0;
    return;
  }

  const configUrl = `https://identitytoolkit.googleapis.com/admin/v2/projects/${sa.project_id}/config`;
  let domains;
  try {
    const token = await mintAccessToken(sa);
    const res = await fetch(configUrl, { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) {
      const body = await res.text();
      check(
        'firebase',
        'D0',
        'GET',
        configUrl,
        'admin/v2 config answers 200',
        false,
        `${res.status}: ${body.slice(0, 300)}`,
      );
      printTable();
      console.error(
        '\nauthorized-domains: could not read the config (see D0 above) — this is either an ' +
          'IAM permission gap on the service account or an unrelated API error, not proof the ' +
          'domain list itself is wrong. Fix the credential/permission, then re-run.',
      );
      process.exitCode = 1;
      return;
    }
    const data = await res.json();
    domains = new Set(Array.isArray(data.authorizedDomains) ? data.authorizedDomains : []);
  } catch (err) {
    console.error('authorized-domains: request failed:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
    return;
  }

  const sortedDomains = [...domains].sort().join(', ');
  for (const { id, host } of REQUIRED_DOMAINS) {
    check(
      'firebase',
      id,
      'GET',
      configUrl,
      `${host} is a Firebase authorised domain`,
      domains.has(host),
      `authorizedDomains: ${sortedDomains}`,
    );
  }

  printTable();
  const { passed, failed } = counts();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.error(
      '\nA missing estate origin here is the EXACT incident this probe exists for (2026-08-16: ' +
        'the apex was silently dropped from this list and sign-in broke estate-wide with nothing ' +
        'catching it). Fix it in the Firebase console — project audiobook-catalog → Authentication ' +
        '→ Settings → Authorised domains — do not "fix" this script.',
    );
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('authorized-domains crashed:', err);
  process.exitCode = 1;
});
