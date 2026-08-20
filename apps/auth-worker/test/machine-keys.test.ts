/**
 * machine-keys.test.ts — the estate's credential registry (src/machine-keys.ts).
 *
 * ⚠️ THE REGISTRY'S OWN FAILURE MODE IS DIFFERENT FROM A KEY'S. A key can be
 * wrong about one credential; the registry can be wrong about WHICH
 * credentials exist and which of them a button may touch. Both are silent:
 *
 *   1. A `paired` or `manual` entry that acquires a mint path would put a
 *      button on a credential whose rotation breaks something the estate
 *      cannot see — the pipeline watcher's .env, a sibling Worker, every
 *      issued token. The route refuses those by mode, and the tests below
 *      assert the refusal rather than trusting the UI to omit the button,
 *      because the UI is not the security boundary.
 *   2. An entry that silently loses its `manualWhy` becomes a dead row: a
 *      credential listed with no button and no reason, which reads as an
 *      oversight and invites someone to "fix" it.
 *
 * The mode assignments are load-bearing and are asserted individually. They
 * were not obvious: the pipeline trigger LOOKS like every other bearer here
 * and is the one that must never have a button, because this Worker SENDS it
 * rather than checking it.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  KEY_REGISTRY,
  checkRegistryAuth,
  keyById,
  type KeyDef,
} from '../src/machine-keys.js';
import { fingerprint, mintToken, sha256Hex, type TokenRecord } from '../src/shelf-token.js';

const NOW = Date.parse('2026-08-20T12:00:00.000Z');

/** Minimal in-memory KV — enough for the two methods the module calls. */
function fakeKV(seed: Record<string, string> = {}) {
  const store = new Map(Object.entries(seed));
  return {
    get: async (k: string) => (store.has(k) ? store.get(k)! : null),
    put: async (k: string, v: string) => void store.set(k, v),
    _store: store,
  } as unknown as KVNamespace & { _store: Map<string, string> };
}

async function recordFor(token: string, prefix: string): Promise<TokenRecord> {
  return {
    current: {
      hash: await sha256Hex(token),
      fp: fingerprint(token, prefix),
      created_at: new Date(NOW).toISOString(),
      created_by: 'someone@example.com',
      last_used_at: null,
    },
    previous: null,
  };
}

// ── the registry's shape ────────────────────────────────────────────────────

test('every entry has a unique id', () => {
  const ids = KEY_REGISTRY.map((k) => k.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('every entry says what a leak costs and where the value lives', () => {
  for (const k of KEY_REGISTRY) {
    assert.ok(k.blast && k.blast.length > 20, `${k.id} has no usable blast radius`);
    assert.ok(k.livesAt && k.livesAt.length > 5, `${k.id} does not say where it lives`);
  }
});

test('⚠️ every non-self-service entry explains WHY it has no button, and what to run instead', () => {
  // A row with no button and no reason reads as an oversight and invites
  // somebody to "fix" it by adding one.
  for (const k of KEY_REGISTRY.filter((x) => x.mode !== 'self-service')) {
    assert.ok(k.manualWhy && k.manualWhy.length > 40, `${k.id} has no manualWhy`);
    assert.ok(k.manualFix, `${k.id} has no manualFix`);
  }
});

test('only self-service entries carry storage; the others carry none', () => {
  for (const k of KEY_REGISTRY) {
    if (k.mode === 'self-service') {
      assert.ok(k.kvKey, `${k.id} is self-service with no kvKey`);
      assert.ok(k.prefix, `${k.id} is self-service with no prefix`);
    } else {
      // ⚠️ A kvKey on a paired/manual entry is the shape a mint path would
      // need. Its absence is what makes "no button" structural.
      assert.equal(k.kvKey, undefined, `${k.id} must not have a kvKey`);
      assert.equal(k.prefix, undefined, `${k.id} must not have a prefix`);
    }
  }
});

test('prefixes are unique, so a leaked value names exactly one credential', () => {
  const ps = KEY_REGISTRY.filter((k) => k.prefix).map((k) => k.prefix!);
  assert.equal(new Set(ps).size, ps.length);
});

// ── the mode assignments, individually, because they are the design ─────────

test('⚠️ the pipeline trigger is PAIRED — this Worker sends it, so it must not have a button', () => {
  const k = keyById('pipeline-trigger')!;
  assert.equal(k.mode, 'paired');
  assert.equal(k.kvKey, undefined);
  assert.match(k.manualWhy!, /OUTBOUND/);
});

test('⚠️ the token signer and the Firebase service account are MANUAL and are LISTED', () => {
  // Omitting them would make the page a liar by silence: a reader who sees
  // only the rotatable keys concludes those are all of them.
  for (const id of ['token-signer', 'firebase-sa']) {
    const k = keyById(id);
    assert.ok(k, `${id} missing from the registry`);
    assert.equal(k!.mode, 'manual');
    assert.equal(k!.kvKey, undefined);
  }
});

test('the three self-service keys are exactly the ones this Worker verifies', () => {
  const ss = KEY_REGISTRY.filter((k) => k.mode === 'self-service').map((k) => k.id).sort();
  assert.deepEqual(ss, ['conductor', 'shelf-parity', 'worker-events']);
});

test('the shelf key keeps its original KV name, or the live record is orphaned', () => {
  assert.equal(keyById('shelf-parity')!.kvKey, 'shelf:parity:token');
});

// ── checkRegistryAuth ───────────────────────────────────────────────────────

const def: KeyDef = { ...keyById('conductor')! };

test('a minted key authenticates, and reports which key it was', async () => {
  const t = mintToken(def.prefix);
  const kv = fakeKV({ [def.kvKey!]: JSON.stringify(await recordFor(t, def.prefix!)) });
  const r = await checkRegistryAuth(kv, def, `Bearer ${t}`, undefined, NOW);
  assert.deepEqual(r, { ok: true, via: 'current' });
});

test('the legacy env value still authenticates while it is installed', async () => {
  const kv = fakeKV();
  const r = await checkRegistryAuth(kv, def, 'Bearer legacy-value', 'legacy-value', NOW);
  assert.deepEqual(r, { ok: true, via: 'legacy' });
});

test('a minted key works even after the legacy secret is removed', async () => {
  const t = mintToken(def.prefix);
  const kv = fakeKV({ [def.kvKey!]: JSON.stringify(await recordFor(t, def.prefix!)) });
  const r = await checkRegistryAuth(kv, def, `Bearer ${t}`, undefined, NOW);
  assert.equal(r.ok, true);
});

test('no credential configured at all is secret_unset — a config fault, not a caller fault', async () => {
  const r = await checkRegistryAuth(fakeKV(), def, 'Bearer anything', undefined, NOW);
  assert.deepEqual(r, { ok: false, cause: 'secret_unset' });
});

test('⚠️ a wrong bearer is bad_token even once the legacy secret is GONE', async () => {
  // The bug this pins: with the env secret removed, the old code path reported
  // secret_unset and told the caller to run `wrangler secret put` — pointing at
  // a credential that is deliberately gone. Confidently wrong directions.
  const t = mintToken(def.prefix);
  const kv = fakeKV({ [def.kvKey!]: JSON.stringify(await recordFor(t, def.prefix!)) });
  const r = await checkRegistryAuth(kv, def, 'Bearer wrong', undefined, NOW);
  assert.deepEqual(r, { ok: false, cause: 'bad_token' });
});

test('a missing or malformed Authorization line is no_header, not bad_token', async () => {
  const kv = fakeKV({ [def.kvKey!]: JSON.stringify(await recordFor(mintToken(def.prefix), def.prefix!)) });
  assert.deepEqual(await checkRegistryAuth(kv, def, null, undefined, NOW), { ok: false, cause: 'no_header' });
  assert.deepEqual(await checkRegistryAuth(kv, def, 'Basic zzz', undefined, NOW), { ok: false, cause: 'no_header' });
});

test('a corrupt stored record throws rather than falling through to legacy', async () => {
  // Falling through would look like a working system while rotation is broken.
  const kv = fakeKV({ [def.kvKey!]: 'not json' });
  await assert.rejects(() => checkRegistryAuth(kv, def, 'Bearer x', 'legacy', NOW));
});

test('a key rotated with a grace window still authenticates on the previous value, and says so', async () => {
  const oldT = mintToken(def.prefix);
  const newT = mintToken(def.prefix);
  const rec = await recordFor(newT, def.prefix!);
  rec.previous = {
    hash: await sha256Hex(oldT),
    fp: fingerprint(oldT, def.prefix!),
    grace_until: new Date(NOW + 3600_000).toISOString(),
  };
  const kv = fakeKV({ [def.kvKey!]: JSON.stringify(rec) });
  // ⚠️ 'previous' must be distinguishable: it is the only signal that somebody
  // started a rotation and never finished installing it.
  assert.deepEqual(await checkRegistryAuth(kv, def, `Bearer ${oldT}`, undefined, NOW), { ok: true, via: 'previous' });
  assert.deepEqual(await checkRegistryAuth(kv, def, `Bearer ${newT}`, undefined, NOW), { ok: true, via: 'current' });
});
