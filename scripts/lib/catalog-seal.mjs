/**
 * catalog-seal.mjs — the PROVISIONER half of the sealed Claude key (design §6).
 *
 * The one consumer of `docs/access/keys/catalog-provisioning.private.jwk`, and
 * the only place in the estate where a sealed envelope is ever opened.
 *
 * ## 🔴 The property this file exists to hold
 *
 * Plaintext lives in exactly one place here: a local `const` inside
 * `injectSealedKey`, from the moment it is decrypted to the moment
 * `wrangler secret put` has consumed it off stdin. It is **never** returned,
 * logged, thrown inside an error message, written to disk, or passed in argv.
 * The function's return value is `{ source }` — a WORD, not a value — precisely
 * so no caller can accidentally print it.
 *
 * ⚠️ THAT IS WHY THERE IS NO `readSealedKey()` HELPER. A function that returns
 * the plaintext would be correct, small, and the exact thing design §6.2 says
 * must not exist: *"the owner never decrypts to READ — only to INJECT."* The
 * absence is the guarantee. Do not add one "just for a test" — the tests here
 * prove the round trip by sealing something they already know.
 *
 * ## The flow, in order
 *
 * 1. `reader/<id>.json` — the requester's own key, sealed in their browser at
 *    submit. §6.4 row 1: **the reader's key wins.**
 * 2. `owner/<id>.json` — the owner's key, sealed in his browser at Accept.
 *    §6.4 row 2. Used only when the reader attached none.
 * 3. Neither → `{ source: 'none' }`, and the CALLER applies §6.4 row 3 (the
 *    owner's own local `ANTHROPIC_API_KEY`, his standing decision of
 *    2026-09-05) exactly as it does today. This module does not reach into
 *    anybody's `.dev.vars`; that is the caller's business and its log line.
 *
 * On a successful `secret put` the R2 object is DELETED. A key that has reached
 * its destination has no reason to keep sitting in a bucket, and design §6.1
 * puts the destination Worker's secret — not R2 — as the intended place at rest.
 *
 * ## Measured, 2026-09-05
 *
 * - `wrangler 4.123.0`'s `r2 object get` **does** carry `-p, --pipe` (read out
 *   of `--help`), so no temp file is ever written. If a future wrangler drops
 *   it, write to a scratch path and delete it — it is ciphertext, but an
 *   envelope on disk is still one more copy than the design allows.
 * - `--remote` is passed EXPLICITLY on every R2 call. It is not decoration:
 *   these commands also have a `--local` mode backed by the miniflare state
 *   directory, and a provisioner that silently read an empty local bucket would
 *   report `'none'` and quietly spend the owner's key instead of the reader's.
 *
 * ## ⚠️ The Windows wrangler quirk, inherited deliberately
 *
 * `library_catalog/scripts/lib/d1.mjs` records that wrangler on Windows can
 * print a perfectly good result and then exit non-zero on a libuv teardown
 * race. So a non-zero exit WITH usable stdout is not treated as a failure here
 * either — but the failure path is asymmetric on purpose: that tolerance
 * applies to READS. A `secret put` that exits non-zero is treated as failed and
 * the envelope is NOT deleted, because the recoverable mistake is running the
 * step twice and the unrecoverable one is deleting the only copy of a key that
 * never landed.
 */

import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { webcrypto } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
/** `scripts/lib/` → the repo root. */
export const PLATFORM_ROOT = resolve(HERE, '..', '..');
export const PRIVATE_JWK_PATH = join(
  PLATFORM_ROOT,
  'docs',
  'access',
  'keys',
  'catalog-provisioning.private.jwk',
);
/** The private bucket (design §6.2 step 3). No public URL, no custom domain. */
export const BUCKET = 'estate-catalog-keys';
export const SEAL_ALG = 'RSA-OAEP-256+A256GCM';
/** Where the auth Worker's wrangler config lives — R2 calls run from here. */
export const AUTH_WORKER_DIR = join(PLATFORM_ROOT, 'apps', 'auth-worker');

/**
 * The candidates, in precedence order. ⚠️ ORDER IS THE POLICY (§6.4): reader
 * before owner. Reversing these two lines would silently override a person's
 * own key with the owner's, which is a money decision, not a bug in a loop.
 */
export function envelopeCandidates(requestId) {
  const id = Number(requestId);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error(`injectSealedKey needs a positive integer request id; got ${JSON.stringify(requestId)}`);
  }
  return [
    { source: 'reader', key: `reader/${id}.json` },
    { source: 'owner', key: `owner/${id}.json` },
  ];
}

/** Anything wrangler says when the object simply is not there. */
function looksAbsent(text) {
  return /does not exist|NoSuchKey|not found|no such (object|key)|10007|404/i.test(String(text || ''));
}

/**
 * The real wrangler runner. Injected as a parameter everywhere below so the
 * tests exercise the DECISIONS without a Cloudflare account, a network or a
 * login — the estate's own rule that a test which needs credentials is a test
 * nobody runs.
 */
export function defaultRunner({
  authWorkerDir = AUTH_WORKER_DIR,
  wranglerBin = join(PLATFORM_ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js'),
} = {}) {
  return {
    /** @returns {{found: boolean, bytes: Buffer|null}} */
    get(objectKey) {
      try {
        const bytes = execFileSync(
          process.execPath,
          [wranglerBin, 'r2', 'object', 'get', `${BUCKET}/${objectKey}`, '--pipe', '--remote'],
          { cwd: authWorkerDir, maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] },
        );
        return { found: bytes && bytes.length > 0, bytes };
      } catch (err) {
        const out = err?.stdout;
        // The teardown quirk: a usable body plus a non-zero exit is a success.
        if (out && out.length > 0) return { found: true, bytes: out };
        const why = String(err?.stderr || err?.message || '');
        if (looksAbsent(why)) return { found: false, bytes: null };
        throw new Error(`Could not read ${BUCKET}/${objectKey} — ${why.trim()}`);
      }
    },
    /** @returns {{ok: boolean, detail: string}} */
    del(objectKey) {
      try {
        execFileSync(
          process.execPath,
          [wranglerBin, 'r2', 'object', 'delete', `${BUCKET}/${objectKey}`, '--remote'],
          { cwd: authWorkerDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
        );
        return { ok: true, detail: '' };
      } catch (err) {
        const why = String(err?.stderr || err?.message || '');
        // Already gone is the state we wanted; it is not a failure.
        if (looksAbsent(why)) return { ok: true, detail: 'already absent' };
        return { ok: false, detail: why.trim() };
      }
    },
    /**
     * ⚠️ STDIN, NEVER ARGV — `push-secrets.mjs:655–673`, *"so they never reach
     * a process list"*. `stdio[1]`/`[2]` are inherited so wrangler's own words
     * reach the operator; wrangler does not echo the value it read.
     * @returns {Promise<number>} the child's exit code
     */
    putSecret({ name, value, cwd, env }) {
      return new Promise((done, fail) => {
        const child = spawn(
          process.execPath,
          [wranglerBin, 'secret', 'put', name, ...(env ? ['--env', env] : [])],
          { cwd, stdio: ['pipe', 'inherit', 'inherit'] },
        );
        child.on('error', fail);
        child.stdin.end(value);
        child.on('exit', (code) => done(code));
      });
    },
  };
}

/** Read the private JWK. Its VALUE never leaves this module. */
export function loadPrivateJwk(path = PRIVATE_JWK_PATH) {
  if (!existsSync(path)) {
    throw new Error(
      'The provisioning private key is not on this machine.\n' +
        `Expected: ${path}\n\n` +
        'Mint one with `node scripts/catalog-key-mint.mjs` in catalog-platform, or restore the\n' +
        'copy recorded in docs/access/RECOVERY.md. ⚠️ Minting a NEW one does not help with an\n' +
        'envelope already sealed to the old key — that envelope is unrecoverable by design.',
    );
  }
  return JSON.parse(readFileSync(path, 'utf8'));
}

function fromBase64(s) {
  return Buffer.from(String(s), 'base64');
}

/**
 * Validate the envelope's SHAPE before touching a key. The auth Worker runs the
 * same checks at the door; this is the second lock, and it is here because the
 * bucket is the trust boundary the Worker cannot re-check for us.
 */
export function assertEnvelopeShape(env) {
  if (!env || typeof env !== 'object') throw new Error('The envelope is not a JSON object.');
  if (env.v !== 1) throw new Error(`Unknown envelope version ${JSON.stringify(env.v)}; this build reads v1.`);
  if (env.alg !== SEAL_ALG) throw new Error(`Unknown envelope alg ${JSON.stringify(env.alg)}; expected ${SEAL_ALG}.`);
  for (const f of ['kid', 'ek', 'iv', 'ct']) {
    if (typeof env[f] !== 'string' || !env[f]) throw new Error(`The envelope's "${f}" is missing or not a string.`);
  }
  return env;
}

/**
 * Open one envelope. ⚠️ The ONE function that returns plaintext, and it is
 * module-internal in spirit: it is exported only so the round-trip test can
 * prove the browser module and this one agree. Nothing in the provisioning path
 * calls it except `injectSealedKey`, which never lets the value escape.
 */
export async function decryptEnvelope(envelope, privateJwk, subtle = webcrypto.subtle) {
  assertEnvelopeShape(envelope);
  if (privateJwk.kid && envelope.kid !== privateJwk.kid) {
    throw new Error(
      `This envelope was sealed to key ${envelope.kid}, and the key on this machine is ${privateJwk.kid}.\n` +
        'The keypair was rotated after the envelope was made, so it cannot be opened — by design\n' +
        '(design §6.5). Ask the requester for the key again, or provision with the owner’s.',
    );
  }
  const rsa = await subtle.importKey(
    'jwk',
    { ...privateJwk, kid: undefined, minted: undefined },
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['decrypt'],
  );
  const rawAes = await subtle.decrypt({ name: 'RSA-OAEP' }, rsa, fromBase64(envelope.ek));
  const aes = await subtle.importKey('raw', rawAes, { name: 'AES-GCM' }, false, ['decrypt']);
  const plain = await subtle.decrypt(
    { name: 'AES-GCM', iv: new Uint8Array(fromBase64(envelope.iv)) },
    aes,
    fromBase64(envelope.ct),
  );
  return new TextDecoder().decode(plain);
}

/**
 * Fetch → decrypt → `wrangler secret put` over stdin → delete the envelope.
 *
 * @param {object}   o
 * @param {number}   o.requestId    the `catalog_request` row id
 * @param {string}   o.workerDir    where the DESTINATION worker's wrangler.toml lives
 * @param {string}   o.envName      the destination `[env.<name>]`
 * @param {string}  [o.secretName]  default `ANTHROPIC_API_KEY`
 * @param {boolean} [o.dry]         report presence/absence and touch nothing
 * @param {Function}[o.log]         default `console.log`
 * @param {object}  [o.runner]      TEST SEAM: `{ get, del, putSecret }`
 * @param {string}  [o.privateJwkPath]
 * @returns {Promise<{source: 'reader'|'owner'|'none'}>}
 *
 * ⚠️ `'none'` IS A NORMAL ANSWER, NOT AN ERROR. It means nobody attached a key,
 * which is the common case, and the caller then applies §6.4 row 3. Throwing
 * would make the ordinary path an exception path.
 */
export async function injectSealedKey({
  requestId,
  workerDir,
  envName,
  secretName = 'ANTHROPIC_API_KEY',
  dry = false,
  log = console.log,
  runner = null,
  privateJwkPath = PRIVATE_JWK_PATH,
} = {}) {
  const candidates = envelopeCandidates(requestId);
  const wr = runner || defaultRunner();

  if (dry) {
    // ⚠️ A dry run reads the BUCKET but not the KEY: it says which envelopes
    // exist, never what is in one. Presence is the fact the operator needs to
    // rehearse with; the plaintext is not part of any rehearsal.
    let found = 'none';
    for (const c of candidates) {
      let present = false;
      try {
        present = wr.get(c.key).found === true;
      } catch (err) {
        log(`  sealed key       could not check ${BUCKET}/${c.key} — ${String(err.message).split('\n')[0]}`);
        continue;
      }
      log(`  sealed key       ${present ? 'PRESENT' : 'absent '}  ${BUCKET}/${c.key}   (${c.source})`);
      if (present && found === 'none') found = c.source;
    }
    if (found === 'none') {
      log('  sealed key       none attached — the owner’s key is used (design §6.4 row 3, standing decision 2026-09-05)');
    } else {
      log(`  sealed key       would set ${secretName} on --env ${envName} from the ${found} envelope, then delete it`);
    }
    return { source: found };
  }

  const privateJwk = loadPrivateJwk(privateJwkPath);

  for (const c of candidates) {
    const got = wr.get(c.key);
    if (!got.found) continue;

    let envelope;
    try {
      envelope = JSON.parse(Buffer.from(got.bytes).toString('utf8'));
    } catch {
      throw new Error(
        `${BUCKET}/${c.key} is not JSON. It should be a v1 envelope written by the auth Worker; ` +
          'something else wrote it, and this script will not guess.',
      );
    }

    // ── the only window in which plaintext exists ──────────────────────────
    const plaintext = await decryptEnvelope(envelope, privateJwk);
    const code = await wr.putSecret({ name: secretName, value: plaintext, cwd: workerDir, env: envName });
    if (code !== 0) {
      // ⚠️ NOT deleted. See the header: a lost key is unrecoverable, a repeated
      // `secret put` costs one command.
      throw new Error(
        `wrangler secret put ${secretName} --env ${envName} exited ${code}, so the ${c.source} key was NOT set.\n` +
          `The envelope is left in place at ${BUCKET}/${c.key} — re-run this step once the cause is fixed.`,
      );
    }
    log(`  ${c.source === 'reader' ? 'reader key used' : 'owner-at-accept key used'}   ${secretName} set on --env ${envName}`);

    const gone = wr.del(c.key);
    if (gone.ok) {
      log(`  envelope deleted ${BUCKET}/${c.key}${gone.detail ? ` (${gone.detail})` : ''}`);
    } else {
      // The secret DID land, so this is a tidiness failure, not a provisioning
      // one — say so precisely rather than failing a finished step.
      log(
        `  ⚠️ the key is set, but ${BUCKET}/${c.key} could not be deleted — ${gone.detail}\n` +
          `     Delete it by hand from apps/auth-worker:  npx wrangler r2 object delete ${BUCKET}/${c.key} --remote`,
      );
    }
    return { source: c.source };
  }

  return { source: 'none' };
}
