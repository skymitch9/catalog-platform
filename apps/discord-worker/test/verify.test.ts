/**
 * Ed25519 signature verification — the gate Discord actively fuzzes (it
 * probes the saved URL with deliberately invalid signatures and silently
 * drops the URL if they are accepted). Real keypairs, real signatures:
 * these tests generate an Ed25519 key via WebCrypto and exercise the same
 * `crypto.subtle.verify` path workerd runs, plus the full request pipeline
 * through the exported Hono app (signed PING → PONG, tampered → 401).
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hexToBytes, importDiscordPublicKey, verifyDiscordSignature } from '../src/verify.js';
import { app } from '../src/index.js';

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

/** One real Ed25519 keypair shared by every test in this file. */
async function makeKeypair() {
  const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const raw = new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer);
  return { pair, publicKeyHex: toHex(raw) };
}

async function sign(pair: CryptoKeyPair, timestamp: string, body: string): Promise<string> {
  const sig = await crypto.subtle.sign(
    { name: 'Ed25519' },
    pair.privateKey,
    new TextEncoder().encode(timestamp + body),
  );
  return toHex(new Uint8Array(sig));
}

// ---------------------------------------------------------------------------
// hexToBytes — strict, because it feeds key material
// ---------------------------------------------------------------------------

test('hexToBytes: round-trips, and refuses odd-length / non-hex / empty', () => {
  assert.deepEqual(Array.from(hexToBytes('00ff10') ?? []), [0, 255, 16]);
  assert.equal(hexToBytes('abc'), null); // odd length
  assert.equal(hexToBytes('zz'), null); //  non-hex
  assert.equal(hexToBytes(''), null); //    empty
});

test('importDiscordPublicKey: malformed secret throws and names the constraint, never the value', async () => {
  for (const bad of ['deadbeef', 'not hex at all', 'zz'.repeat(32)]) {
    await assert.rejects(() => importDiscordPublicKey(bad), /64 hex characters/);
    try {
      await importDiscordPublicKey(bad);
    } catch (err) {
      assert.ok(!(err as Error).message.includes(bad));
    }
  }
});

// ---------------------------------------------------------------------------
// verifyDiscordSignature — the spec's exact signed material: timestamp + body
// ---------------------------------------------------------------------------

test('valid signature over timestamp+body is accepted', async () => {
  const { pair, publicKeyHex } = await makeKeypair();
  const ts = '1723800000';
  const body = JSON.stringify({ type: 1 });
  const sig = await sign(pair, ts, body);
  assert.equal(await verifyDiscordSignature(publicKeyHex, sig, ts, body), true);
});

test('tampered body, tampered timestamp, wrong key, malformed sig — all rejected', async () => {
  const { pair, publicKeyHex } = await makeKeypair();
  const other = await makeKeypair();
  const ts = '1723800000';
  const body = JSON.stringify({ type: 1 });
  const sig = await sign(pair, ts, body);

  assert.equal(await verifyDiscordSignature(publicKeyHex, sig, ts, body + ' '), false);
  assert.equal(await verifyDiscordSignature(publicKeyHex, sig, ts + '1', body), false);
  assert.equal(await verifyDiscordSignature(other.publicKeyHex, sig, ts, body), false);
  assert.equal(await verifyDiscordSignature(publicKeyHex, 'ab'.repeat(63), ts, body), false); // 63 bytes
  assert.equal(await verifyDiscordSignature(publicKeyHex, 'not-hex', ts, body), false);
});

// ---------------------------------------------------------------------------
// The full pipeline through the Worker's fetch handler
// ---------------------------------------------------------------------------

async function post(
  env: Record<string, string>,
  body: string,
  headers: Record<string, string>,
): Promise<Response> {
  return app.request(
    '/interactions',
    { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body },
    env,
  );
}

test('signed PING is answered with PONG', async () => {
  const { pair, publicKeyHex } = await makeKeypair();
  const body = JSON.stringify({ type: 1 });
  const ts = '1723800001';
  const res = await post({ DISCORD_PUBLIC_KEY: publicKeyHex }, body, {
    'x-signature-ed25519': await sign(pair, ts, body),
    'x-signature-timestamp': ts,
  });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { type: 1 });
});

test('invalid signature is 401 bad_signature — never processed', async () => {
  const { publicKeyHex } = await makeKeypair();
  const other = await makeKeypair();
  const body = JSON.stringify({ type: 1 });
  const ts = '1723800002';
  const res = await post({ DISCORD_PUBLIC_KEY: publicKeyHex }, body, {
    'x-signature-ed25519': await sign(other.pair, ts, body), // wrong key's signature
    'x-signature-timestamp': ts,
  });
  assert.equal(res.status, 401);
  assert.equal(((await res.json()) as { error: string }).error, 'bad_signature');
});

test('missing signature headers are 401; unsigned requests never reach the router', async () => {
  const { publicKeyHex } = await makeKeypair();
  const res = await post({ DISCORD_PUBLIC_KEY: publicKeyHex }, JSON.stringify({ type: 1 }), {});
  assert.equal(res.status, 401);
  assert.equal(((await res.json()) as { error: string }).error, 'missing_signature_headers');
});

test('unset DISCORD_PUBLIC_KEY is a 503 naming the exact `wrangler secret put`', async () => {
  const res = await post({}, JSON.stringify({ type: 1 }), {
    'x-signature-ed25519': 'ab'.repeat(64),
    'x-signature-timestamp': '1',
  });
  assert.equal(res.status, 503);
  const data = (await res.json()) as { error: string; fix: string };
  assert.equal(data.error, 'discord_public_key_unset');
  assert.match(data.fix, /wrangler secret put DISCORD_PUBLIC_KEY/);
});

test('malformed DISCORD_PUBLIC_KEY is a loud 500 config error, distinct from a 401', async () => {
  const res = await post({ DISCORD_PUBLIC_KEY: 'garbage' }, JSON.stringify({ type: 1 }), {
    'x-signature-ed25519': 'ab'.repeat(64),
    'x-signature-timestamp': '1',
  });
  assert.equal(res.status, 500);
  assert.equal(((await res.json()) as { error: string }).error, 'discord_public_key_invalid');
});

test('signed but non-JSON body is 400', async () => {
  const { pair, publicKeyHex } = await makeKeypair();
  const body = 'not json{';
  const ts = '1723800003';
  const res = await post({ DISCORD_PUBLIC_KEY: publicKeyHex }, body, {
    'x-signature-ed25519': await sign(pair, ts, body),
    'x-signature-timestamp': ts,
  });
  assert.equal(res.status, 400);
});
