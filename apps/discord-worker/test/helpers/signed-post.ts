/**
 * Post a properly Ed25519-SIGNED interaction to the Worker.
 *
 * Every interaction test needs one, and there must be exactly one of these:
 * a second copy would inevitably drift into signing something subtly
 * different, and then a test would be proving the wrong thing while passing.
 * A fresh keypair per call, with its public half handed to the Worker as
 * DISCORD_PUBLIC_KEY, is what makes the signature real rather than stubbed —
 * the verify path under test is the production one.
 *
 * Not named `*.test.ts`, so the runner's `test/*.test.ts` glob does not try
 * to execute it as a suite.
 */

import { app } from '../../src/index.js';

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

/**
 * @param bodyObj  the interaction payload
 * @param extraEnv anything beyond DISCORD_PUBLIC_KEY the test needs bound.
 *   ⚠️ Deliberately EMPTY by default: no FIREBASE_SERVICE_ACCOUNT, no client
 *   secret, so a test that accidentally reaches the network fails loudly
 *   instead of quietly hitting Firestore.
 */
export async function signedPost(
  bodyObj: unknown,
  extraEnv: Record<string, string> = {},
): Promise<Response> {
  const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const publicKeyHex = toHex(
    new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer),
  );
  const body = JSON.stringify(bodyObj);
  const ts = '1723800100';
  const sig = toHex(
    new Uint8Array(
      await crypto.subtle.sign(
        { name: 'Ed25519' },
        pair.privateKey,
        new TextEncoder().encode(ts + body),
      ),
    ),
  );
  return app.request(
    'https://discord.heygabi.ai/interactions',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-signature-ed25519': sig,
        'x-signature-timestamp': ts,
      },
      body,
    },
    { DISCORD_PUBLIC_KEY: publicKeyHex, ...extraEnv },
  );
}
