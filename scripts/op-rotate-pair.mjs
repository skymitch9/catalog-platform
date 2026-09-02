#!/usr/bin/env node
/**
 * Give a MASTER-LESS estate pair a master, by minting a fresh value into the
 * 1Password vault and setting it on BOTH holders in one run.
 *
 *   node scripts/op-rotate-pair.mjs --list
 *   node scripts/op-rotate-pair.mjs --pair INDEX_READ_TOKEN_LIBRARY2 --dry-run
 *   node scripts/op-rotate-pair.mjs --pair INDEX_READ_TOKEN_LIBRARY2
 *
 * Step 3 of `docs/info/secrets-review-2026-08-26.md` §5 — *"this is where the
 * no-master secrets are, so it is the step that actually changes the recovery
 * story"*. §3.1 lists eleven secrets whose only holders are write-only Workers,
 * so there is nothing on this machine to import: the ONLY way to give one a
 * master is to mint a new value and set both sides.
 *
 * ## ⚠️ THE GUARD: no probe, no rotation
 *
 * **A pair with no live handshake this script can run is REFUSED.** Not warned
 * about — refused, before anything is minted.
 *
 * The reason is the failure shape. A half-applied pair does not raise an error
 * anywhere: the verifier simply stops recognising the presenter, and the result
 * is a silent 401/403/404 that reads exactly like a code bug, on a route nobody
 * is watching (`docs/access/RECOVERY.md`, the rotation plan's opening line —
 * *"ORDER IS THE WHOLE GAME"*). Rotating without a way to observe the new pair
 * agreeing means shipping that state and hoping. The estate's verification rule
 * is that a claim is measured or it is labelled a guess; here a guess is an
 * outage.
 *
 * ✅ **ALL FOUR PAIRS NOW HAVE ONE — 2026-09-02.** Three of them carried
 * `probe: null` from 2026-08-26 until then, each with a sentence naming what a
 * probe would need; those sentences are kept **in place**, above the probe that
 * answered them, because the reason a route exists is worth more than the fact
 * that it does. Two read-only routes were built:
 *
 * | Route | Proves | Reaches |
 * |---|---|---|
 * | `GET auth.heygabi.ai/api/estate/app-check` | `ESTATE_APP_TOKEN_LIBRARY2`, `ESTATE_APP_TOKEN_AUDIOBOOK` | no D1, no identity, no write |
 * | `GET audiobook-api.heygabi.ai/api/books/app-check` | `ESTATE_APP_TOKEN_BOOKS` | no bucket, no pack, no email — **no book** |
 *
 * ⚠️ **The guard stays exactly as it was.** A future pair added with
 * `probe: null` is still refused before anything is minted; nothing about this
 * change makes the refusal weaker, and re-adding a pair without a probe is not
 * a shortcut anybody should reach for.
 *
 * 🔴 **A probe existing does NOT mean a pair has been rotated.** As of
 * 2026-09-02 the three are *runnable*, not *run* — minting is the owner's
 * ceremony and a session must not perform it. `docs/TODO.md` carries the exact
 * commands.
 *
 * ## The order, and why it is this order
 *
 * **VERIFIER FIRST, presenter second** — every pair here is inbound-verified.
 * ⚠️ It buys no grace window: the verifier holds exactly ONE value per app, so
 * between step 3 and step 5 the presenter's OLD token is already refused. That
 * gap is inherent to a single-valued verifier, it is what the rotation plan
 * prescribes anyway, and it is why the two pushes happen in one run with no
 * question asked in between.
 *
 * ## ⚠️ Values
 *
 * The minted value exists in this process's memory and reaches `op` and
 * `wrangler` over **stdin**, never argv. It is never printed, never logged, and
 * never written to disk. Every line this script prints is a NAME, a STEP or an
 * HTTP status.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const VAULT = 'Estate';

// ── Where the shared `op` plumbing lives (see scripts/op-import-keys.mjs) ────
const LIB_CANDIDATES = [
  process.env.LIBRARY_CATALOG_DIR,
  join(root, '..', 'bookbuddy', 'library_catalog'),
  join(root, '..', 'library_catalog'),
  'C:\\Users\\nbasl\\OneDrive\\Documents\\vs-code-repos\\bookbuddy\\library_catalog',
].filter(Boolean);

function libraryDir() {
  for (const d of LIB_CANDIDATES) {
    if (existsSync(resolve(d, 'scripts', 'op-cli.mjs'))) return resolve(d);
  }
  return null;
}

/**
 * The four master-less estate-internal pairs from §3.1.
 *
 * `probe` takes the CANDIDATE VALUE and returns `{ ok, status, detail }`. It
 * must be READ-ONLY and it must be reachable without a signed-in human — a
 * probe that needs a browser is not a probe this script can run.
 */
export const PAIRS = {
  INDEX_READ_TOKEN_LIBRARY2: {
    item: 'library2.INDEX_READ_TOKEN',
    what: "padhard's free-details rung 2 — the index resolves the calling APP from the value presented",
    holders: [
      {
        role: 'verifier',
        label: 'catalog-index',
        repo: 'catalog-platform',
        config: join(root, 'apps', 'index-worker', 'wrangler.toml'),
        env: null,
        secret: 'INDEX_READ_TOKEN_LIBRARY2',
      },
      {
        role: 'presenter',
        label: 'library-catalog-friend (padhard)',
        repo: 'library_catalog',
        config: ['apps', 'worker', 'wrangler.toml'],
        env: 'friend',
        secret: 'INDEX_READ_TOKEN',
      },
    ],
    probe: async (value) => {
      const url =
        'https://index.heygabi.ai/api/machine/lookup?title=' + encodeURIComponent('The Way of Kings');
      const res = await fetch(url, { headers: { Authorization: `Bearer ${value}` } });
      let rows = null;
      try {
        rows = (await res.json())?.matches?.length ?? null;
      } catch {
        /* a non-JSON body is itself the detail */
      }
      return {
        ok: res.status === 200,
        status: res.status,
        detail: res.status === 200 ? `200, ${rows} matching rows` : `${res.status}`,
      };
    },
    probeName: 'GET index.heygabi.ai/api/machine/lookup (read-only)',
  },

  ESTATE_APP_TOKEN_LIBRARY2: {
    item: 'ESTATE_APP_TOKEN_LIBRARY2',
    what: "padhard's estate /seen bearer",
    holders: [
      { role: 'verifier', label: 'estate-auth', repo: 'catalog-platform', config: join(root, 'apps', 'auth-worker', 'wrangler.toml'), env: null, secret: 'ESTATE_APP_TOKEN_LIBRARY2' },
      { role: 'presenter', label: 'library-catalog-friend', repo: 'library_catalog', config: ['apps', 'worker', 'wrangler.toml'], env: 'friend', secret: 'ESTATE_APP_TOKEN_LIBRARY2' },
    ],
    // ✅ PROBE BUILT 2026-09-02 — apps/auth-worker/src/app-check.ts. What used
    // to be written here: "POST /api/estate/seen needs the app token AND a real
    // signed-in identity, and it WRITES a seen record; GET /api/estate/health
    // exercises no app token at all. A probe would need a read-only 'does this
    // app token authenticate?' route on estate-auth." That route now exists.
    probe: (value) => appCheckProbe(APP_CHECK_ESTATE, value, 'library2'),
    probeName: 'GET auth.heygabi.ai/api/estate/app-check → app: library2 (read-only, no D1, no identity, no write)',
  },

  ESTATE_APP_TOKEN_AUDIOBOOK: {
    item: 'ESTATE_APP_TOKEN_AUDIOBOOK',
    what: "audiobook-worker's estate /seen bearer",
    holders: [
      { role: 'verifier', label: 'estate-auth', repo: 'catalog-platform', config: join(root, 'apps', 'auth-worker', 'wrangler.toml'), env: null, secret: 'ESTATE_APP_TOKEN_AUDIOBOOK' },
      { role: 'presenter', label: 'audiobook-worker', repo: 'catalog-platform', config: join(root, 'apps', 'audiobook-worker', 'wrangler.toml'), env: null, secret: 'ESTATE_APP_TOKEN_AUDIOBOOK' },
    ],
    // ✅ PROBE BUILT 2026-09-02 — the SAME route as library2's above, because
    // both pairs are verified by the same Worker. One route unblocked two
    // pairs, which is why option 1 of the TODO's two ways forward was taken.
    // ⚠️ The `app` assertion is what makes them different probes: presenting
    // audiobook's value must answer `audiobook` and not merely `ok`, or a
    // rotation that set the WRONG app's secret would pass.
    probe: (value) => appCheckProbe(APP_CHECK_ESTATE, value, 'audiobook'),
    probeName: 'GET auth.heygabi.ai/api/estate/app-check → app: audiobook (read-only, no D1, no identity, no write)',
  },

  ESTATE_APP_TOKEN_BOOKS: {
    item: 'ESTATE_APP_TOKEN_BOOKS',
    what: "GABI's book-knowledge bearer, on a linked asker's behalf",
    holders: [
      { role: 'verifier', label: 'audiobook-worker', repo: 'catalog-platform', config: join(root, 'apps', 'audiobook-worker', 'wrangler.toml'), env: null, secret: 'ESTATE_APP_TOKEN_BOOKS' },
      { role: 'presenter', label: 'estate-discord', repo: 'catalog-platform', config: join(root, 'apps', 'discord-worker', 'wrangler.toml'), env: null, secret: 'ESTATE_APP_TOKEN_BOOKS' },
    ],
    // ✅ PROBE BUILT 2026-09-02 — apps/audiobook-worker/src/app-check.ts, and
    // the OLD objection here is the reason it is a separate route rather than a
    // flag on /api/books/*: "sending a fabricated on-behalf identity to prove a
    // token works would be asserting an identity to a live gate, which is not a
    // probe." So this route reaches NO book — no bucket, no pack, no email
    // resolved. Door B's contract stays token AND asker.
    probe: (value) => appCheckProbe(APP_CHECK_BOOKS, value, 'books'),
    probeName: 'GET audiobook-api.heygabi.ai/api/books/app-check → app: books (read-only, reaches no book)',
  },
};

// ── The handshake, one shape for all three ──────────────────────────────────

export const APP_CHECK_ESTATE = 'https://auth.heygabi.ai/api/estate/app-check';
export const APP_CHECK_BOOKS = 'https://audiobook-api.heygabi.ai/api/books/app-check';

/**
 * Present `value` to a read-only app-check route and require it to name
 * `expectedApp`.
 *
 * ⚠️ **`ok` is 200 AND the right app name, never 200 alone.** A rotation that
 * pushed a value to the wrong `ESTATE_APP_TOKEN_*` secret would still get a 200
 * — from the app it was wrongly filed under — and a probe that only checked the
 * status would call that a success and move on to set the presenter. The app
 * name is the assertion that tells the two apart.
 *
 * ⚠️ It sends the value in an `Authorization` header and NEVER in a URL: a query
 * string lands in access logs, and this repo is public.
 */
async function appCheckProbe(url, value, expectedApp) {
  let res;
  try {
    res = await fetch(url, { headers: { Authorization: `Bearer ${value}` } });
  } catch (e) {
    // ⚠️ A NETWORK failure is not a refusal, and must never be reported as one
    // — that is how an outage gets read as "the token is wrong" and a working
    // value gets re-minted. Named distinctly.
    return { ok: false, status: 0, detail: `unreachable (${e?.message ?? e})` };
  }
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* a non-JSON body is itself the detail */
  }
  const app = body?.app ?? null;
  if (res.status !== 200) {
    return { ok: false, status: res.status, detail: `${res.status} ${body?.error ?? ''}`.trim() };
  }
  if (app !== expectedApp) {
    return {
      ok: false,
      status: 200,
      detail: `200 but the route named app "${app}", not "${expectedApp}" — the value is set on the WRONG secret`,
    };
  }
  return { ok: true, status: 200, detail: `200, app: ${app}` };
}

// ── Plumbing ────────────────────────────────────────────────────────────────

function run(bin, args, { stdin = null, cwd = root } = {}) {
  return new Promise((res) => {
    const child = spawn(bin, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => (stdout += c));
    child.stderr.on('data', (c) => (stderr += c));
    child.on('error', (e) => res({ code: -1, stdout, stderr: String(e) }));
    child.on('close', (code) => res({ code, stdout, stderr }));
    if (stdin !== null) child.stdin.end(stdin);
    else child.stdin.end();
  });
}

/** `wrangler secret bulk`, values over STDIN — never argv. Same as push-secrets. */
async function putSecret(holder, name, value, libDir) {
  const repoRoot = holder.repo === 'catalog-platform' ? root : libDir;
  if (!repoRoot) throw new Error(`no checkout for ${holder.repo}`);
  const config = Array.isArray(holder.config) ? join(repoRoot, ...holder.config) : holder.config;
  const wrangler = join(repoRoot, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
  if (!existsSync(wrangler)) {
    return { code: -1, stderr: `no wrangler in ${repoRoot} — run npm install there first`, stdout: '' };
  }
  return run(
    process.execPath,
    [wrangler, 'secret', 'bulk', '--config', config, ...(holder.env ? ['--env', holder.env] : [])],
    { stdin: JSON.stringify({ [name]: value }), cwd: repoRoot },
  );
}

function say(step, text) {
  console.log(`  ${String(step).padEnd(3)} ${text}`);
}

// ── Entry point ─────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const flag = (n) => {
  const i = argv.findIndex((a) => a === n || a.startsWith(`${n}=`));
  if (i === -1) return null;
  return argv[i].includes('=') ? argv[i].split('=').slice(1).join('=') : (argv[i + 1] ?? null);
};
const dry = argv.includes('--dry-run');

if (argv.includes('--list') || !flag('--pair')) {
  console.log('Master-less estate pairs (secrets review §5 step 3):\n');
  for (const [name, p] of Object.entries(PAIRS)) {
    console.log(`  ${name}`);
    console.log(`      item    ${p.item}`);
    console.log(`      what    ${p.what}`);
    console.log(`      holders ${p.holders.map((h) => `${h.label} (${h.role})`).join('  →  ')}`);
    console.log(`      probe   ${p.probe ? `✅ ${p.probeName}` : '🔴 NONE — REFUSED'}`);
    if (!p.probe) console.log(`              ↳ ${p.whyNoProbe}`);
    console.log('');
  }
  console.log('Rotate one:  node scripts/op-rotate-pair.mjs --pair <NAME> [--dry-run]');
  process.exit(0);
}

const name = flag('--pair');
const pair = PAIRS[name];
if (!pair) {
  console.error(`--pair ${name}: not a known pair. Run --list to see the four.`);
  process.exit(1);
}

// ⚠️ THE GUARD. Before anything is minted.
if (!pair.probe) {
  console.error(`🔴 ${name} has no live handshake this script can run, so it is REFUSED.`);
  console.error('');
  console.error(`   ${pair.whyNoProbe}`);
  console.error('');
  console.error('Nothing was minted and nothing was set. A half-applied pair does not raise');
  console.error('an error anywhere — it goes silently 401/403/404 on a route nobody watches.');
  console.error('Rotating without a way to see the new pair agree is shipping that state and');
  console.error('hoping. Give the pair a read-only probe first, or do it by hand with the');
  console.error('owner watching the surface it feeds.');
  process.exit(1);
}

const libDir = libraryDir();
const needsLib = pair.holders.some((h) => h.repo === 'library_catalog');
if (needsLib && !libDir) {
  console.error('Cannot find the library_catalog checkout, and this pair has a holder in it.');
  console.error('Set LIBRARY_CATALOG_DIR to its root and run again. Nothing was minted.');
  process.exit(1);
}

console.log(`pair    ${name}`);
console.log(`item    op item "${pair.item}" in vault ${VAULT}`);
for (const h of pair.holders) console.log(`holder  ${h.role.padEnd(9)} ${h.label} → ${h.secret}`);
console.log(`probe   ${pair.probeName}`);
console.log('');

if (dry) {
  console.log('Dry run — nothing minted, nothing set, no probe sent.');
  console.log('The real run does: mint → probe (expect 401) → vault → VERIFIER → probe');
  console.log('(expect 200) → PRESENTER → probe again. It stops at the first failure.');
  process.exit(0);
}

const { runOp, opFailureMessage } = await import(
  pathToFileURL(join(libDir ?? root, 'scripts', 'op-cli.mjs')).href
);

// 1 ── mint, OR recover the one a previous run already minted.
//
// ⚠️ `--resume` exists because the FIRST real run of this script needed it.
// Step 5's probe 401'd — a Cloudflare secret change makes a new Worker version
// and it is not live at every edge the instant `wrangler` returns — so the run
// stopped correctly with the verifier set and the presenter not. But "re-run
// this command" would then have minted a SECOND value and created a DUPLICATE
// vault item under the same title, turning a recoverable half-applied pair into
// two masters for one secret. Resuming from the vault is the only safe retry.
const resume = argv.includes('--resume');
let value;
if (resume) {
  const got = await runOp(['read', `op://${VAULT}/${pair.item}/password`]);
  if (got.code !== 0) {
    console.error(opFailureMessage('read', pair.item, got));
    console.error('Nothing was changed. --resume needs the item a previous run created.');
    process.exit(1);
  }
  // ⚠️ `op read` adds a trailing newline; a stored value that kept one would be
  // pushed to a Worker and silently fail to match. Trim the ends, nothing else.
  value = got.stdout.trim();
  if (!value) {
    console.error(`The vault item "${pair.item}" is empty. Nothing was changed.`);
    process.exit(1);
  }
  say(1, `resumed the value from vault item "${pair.item}" (never printed)`);
} else {
  value = randomBytes(32).toString('hex');
  say(1, 'minted a fresh 32-byte value (never printed, never written to disk)');
}

// 2 ── pre-flight: the route is reachable AND does not already know this value.
//      ⚠️ On a resume the opposite is expected — a previous run set the verifier
//      — so acceptance there is progress, not the alarm it is on a fresh mint.
const pre = await pair.probe(value);
if (resume) {
  say(2, `pre-flight (resume): verifier ${pre.ok ? 'ALREADY accepts' : 'does not yet accept'} the value (${pre.detail})`);
} else if (pre.ok) {
  console.error('');
  console.error('🔴 The probe ACCEPTED a value that has not been set anywhere yet.');
  console.error('   That means the route is not actually checking the token, and a rotation');
  console.error('   would prove nothing. Nothing was set. Investigate before retrying.');
  process.exit(1);
} else {
  say(2, `pre-flight: probe refuses the new value (${pre.detail}) — the route is live and checking`);
}

// 3 ── the vault first, so a value that reaches a Worker always has a master.
const template = JSON.stringify({
  title: pair.item,
  category: 'PASSWORD',
  tags: ['estate', 'catalog-platform', 'credential'],
  fields: [
    { id: 'password', type: 'CONCEALED', purpose: 'PASSWORD', value },
    {
      id: 'notesPlain',
      type: 'STRING',
      purpose: 'NOTES',
      value:
        `${pair.what}. Holders: ` +
        pair.holders.map((h) => `${h.label} as ${h.secret} (${h.role})`).join(' + ') +
        `. Minted ${new Date().toISOString().slice(0, 10)} by scripts/op-rotate-pair.mjs — ` +
        'this pair had NO readable master before that (secrets review §3.1).',
    },
  ],
});
const created = resume
  ? { code: 0, stdout: '', stderr: '' }
  : await runOp(['item', 'create', '--vault', VAULT], { stdin: template });
if (created.code !== 0) {
  console.error('');
  console.error(opFailureMessage('create', pair.item, created));
  console.error('Nothing was set on any Worker — the vault comes first on purpose, so a value');
  console.error('that reaches a holder always has a master.');
  process.exit(1);
}
say(3, resume ? `vault item "${pair.item}" reused (not re-created)` : `vault item "${pair.item}" created`);

// 4 ── VERIFIER first. From here the presenter's OLD token is already refused.
const [verifier, presenter] = pair.holders;
const v = await putSecret(verifier, verifier.secret, value, libDir);
if (v.code !== 0) {
  console.error('');
  console.error(`🔴 Could not set ${verifier.secret} on ${verifier.label}.`);
  console.error((v.stderr || '').trim().split('\n').slice(0, 4).join('\n'));
  console.error('');
  console.error('The vault item exists but no holder changed, so the LIVE pair is untouched');
  console.error('and still working. Delete the item or re-run once the cause is fixed.');
  process.exit(1);
}
say(4, `VERIFIER set: ${verifier.label} ← ${verifier.secret}`);

// 5 ── the handshake. This is the whole point of the run.
//
// ⚠️ RETRIED WITH BACKOFF, because the first real run failed here and the cause
// was TIME, not disagreement: a secret change rolls a new Worker version, and
// `wrangler` returning is not the same as every edge serving it. A single
// immediate probe reports a working rotation as a broken one — and this script's
// response to "broken" is to stop with the pair half-applied, so a false
// negative here is itself an outage.
let mid = await pair.probe(value);
for (const waitMs of [2000, 4000, 8000, 15000]) {
  if (mid.ok) break;
  say('5…', `probe ${mid.detail} — waiting ${waitMs / 1000}s for the new Worker version to reach the edge`);
  await new Promise((r) => setTimeout(r, waitMs));
  mid = await pair.probe(value);
}
if (!mid.ok) {
  console.error('');
  console.error(`🔴 The verifier does NOT recognise the new value (${mid.detail}).`);
  console.error(`   STOPPING before ${presenter.label} is touched — a half-applied pair is`);
  console.error('   worse than a failed one. The presenter still holds its old value, which');
  console.error('   the verifier no longer accepts, so this route is DOWN until it is fixed:');
  console.error(`   re-run this command, or set ${verifier.secret} back by hand.`);
  process.exit(1);
}
say(5, `HANDSHAKE: verifier accepts the new value (${mid.detail})`);

// 6 ── presenter.
const p = await putSecret(presenter, presenter.secret, value, libDir);
if (p.code !== 0) {
  console.error('');
  console.error(`🔴 Could not set ${presenter.secret} on ${presenter.label}.`);
  console.error((p.stderr || '').trim().split('\n').slice(0, 4).join('\n'));
  console.error('');
  console.error(`⚠️ THE PAIR IS HALF-APPLIED. ${verifier.label} holds the new value and`);
  console.error(`   ${presenter.label} does not, so this route is DOWN. The value is in the`);
  console.error(`   vault as "${pair.item}" — re-run this step, or set it by hand from there.`);
  process.exit(1);
}
say(6, `PRESENTER set: ${presenter.label} ← ${presenter.secret}`);

const post = await pair.probe(value);
say(7, `re-probe after both sides: ${post.detail}`);

console.log('');
console.log(`✅ ${name} rotated. Both holders set, the vault is its master, handshake proved.`);
console.log('');
console.log('⚠️ What this does NOT prove: that the PRESENTER is sending the new value on its');
console.log('   own traffic. Worker secrets are write-only, so the only evidence available is');
console.log(`   that wrangler accepted the write and the NAME is still listed on ${presenter.label}.`);
console.log('   The verifier half is proved directly, by the probe above.');
