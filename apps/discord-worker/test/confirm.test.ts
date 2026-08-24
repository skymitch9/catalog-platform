/**
 * THE T2 CONFIRM LANE — Discord's half. The invariants that need a surface: the
 * MAC crypto (a forged nonce is rejected), the flag, and the propose/press
 * orchestration end to end with an injected port and pending slot — capability
 * refused at propose AND at press, the compare-and-set 409, the TTL, the
 * consume-before-call double-press safety, and the honest-uncertainty path.
 *
 * The pure grammar (allowlist, propose arithmetic, compareAndSet, checkConfirmPress)
 * is pinned in the package's own `test/confirm.test.ts`; this file does not
 * re-test it — it exercises the wiring around it.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildConfirmButtonId,
  confirmT2On,
  renderConfirm,
  verifyConfirmPress,
} from '../src/confirm.js';
import { proposeConfirm, pressConfirm, type ConfirmMemory } from '../src/confirm-flow.js';
import {
  buildConfirmProposal,
  buildRestatement,
  parseConfirmCustomId,
  type ConfirmChangePending,
} from '../src/conversation.js';
import type {
  DelegatePort,
  FixFieldRequest,
  FixFieldResult,
  LibraryInstance,
} from '../src/delegated.js';

const KEY = 'estate-app-token-secret';
const NOW = 1_700_000_000_000;

const MAIN: LibraryInstance = {
  app: 'library',
  label: 'the main library',
  baseUrl: 'https://library.heygabi.ai',
};

const subject = { entity: 'work' as const, id: '4711', label: 'The Way of Kings by Brandon Sanderson' };

// ── the flag ────────────────────────────────────────────────────────────────

describe('⚠️ confirmT2On — affirmative-only, ships OFF', () => {
  it('only exactly "on" (trimmed, case-insensitive) enables it', () => {
    assert.equal(confirmT2On({ GABI_CONFIRM_T2: 'on' }), true);
    assert.equal(confirmT2On({ GABI_CONFIRM_T2: 'ON ' }), true);
    for (const v of [undefined, '', 'true', '1', 'yes', 'off', 'Onn'])
      assert.equal(confirmT2On({ GABI_CONFIRM_T2: v }), false, `${v} must be OFF`);
  });
});

// ── the MAC: a forged nonce is rejected (invariant 3, the crypto) ────────────

describe('⚠️ the confirm MAC — a forged or hand-typed button cannot fire', () => {
  it('a button GABI built verifies for the presser who was bound into it', async () => {
    const exp = Math.floor((NOW + 600_000) / 1000);
    const id = await buildConfirmButtonId(KEY, 'ok', 'abc123', 'asker-1', exp);
    assert.ok(id.startsWith('gc2|ok|abc123|'));
    const v = await verifyConfirmPress(KEY, id, 'asker-1', NOW);
    assert.equal(v.ok, true);
    if (!v.ok) return;
    assert.equal(v.action, 'ok');
    assert.equal(v.nonce, 'abc123');
  });

  it('a hand-typed id with a made-up signature is INVALID', async () => {
    const exp = Math.floor((NOW + 600_000) / 1000);
    const forged = `gc2|ok|abc123|${exp.toString(36)}|deadbeefdeadbeef`;
    const v = await verifyConfirmPress(KEY, forged, 'asker-1', NOW);
    assert.equal(v.ok, false);
    if (v.ok) return;
    assert.equal(v.reason, 'invalid');
  });

  it('⚠️ a real button verified for a DIFFERENT presser is INVALID (the binding)', async () => {
    const exp = Math.floor((NOW + 600_000) / 1000);
    const id = await buildConfirmButtonId(KEY, 'ok', 'abc123', 'asker-1', exp);
    const v = await verifyConfirmPress(KEY, id, 'somebody-else', NOW);
    assert.equal(v.ok, false);
    if (v.ok) return;
    assert.equal(v.reason, 'invalid');
  });

  it('a button signed with a different key is INVALID (no cross-secret reuse)', async () => {
    const exp = Math.floor((NOW + 600_000) / 1000);
    const id = await buildConfirmButtonId('other-key', 'ok', 'abc123', 'asker-1', exp);
    const v = await verifyConfirmPress(KEY, id, 'asker-1', NOW);
    assert.equal(v.ok, false);
    if (v.ok) return;
    assert.equal(v.reason, 'invalid');
  });

  it('an authentic button past its expiry is EXPIRED (checked AFTER the MAC)', async () => {
    const exp = Math.floor((NOW - 1000) / 1000);
    const id = await buildConfirmButtonId(KEY, 'ok', 'abc123', 'asker-1', exp);
    const v = await verifyConfirmPress(KEY, id, 'asker-1', NOW);
    assert.equal(v.ok, false);
    if (v.ok) return;
    assert.equal(v.reason, 'expired');
  });
});

// ── rendering ───────────────────────────────────────────────────────────────

describe('renderConfirm — the embed, the two buttons, both values shown', () => {
  it('carries before→after per field and a mandatory Cancel button', async () => {
    const built = buildConfirmProposal({
      askerId: 'asker-1',
      instance: 'library',
      subject,
      fields: [{ field: 'series', before: 'Stormlight', after: 'The Stormlight Archive' }],
      nonce: 'abc123',
      now: NOW,
    });
    assert.ok(built.ok);
    if (!built.ok) return;
    const rest = buildRestatement(built.pending, {
      capability: 'editCatalog',
      instanceLabel: 'the main library',
    });
    const msg = await renderConfirm(KEY, built.pending, rest);
    const embed = (msg.embeds as { title: string; fields: { name: string; value: string }[] }[])[0]!;
    assert.equal(embed.title, subject.label);
    assert.match(embed.fields[0]!.value, /Stormlight → \*\*The Stormlight Archive\*\*/);
    const row = (msg.components as { components: { custom_id: string; style: number }[] }[])[0]!;
    assert.equal(row.components.length, 2);
    assert.ok(parseConfirmCustomId(row.components[0]!.custom_id)?.action === 'ok');
    assert.ok(parseConfirmCustomId(row.components[1]!.custom_id)?.action === 'no');
  });
});

// ── a fake port + pending slot for the flow ─────────────────────────────────

type PortStub = Pick<DelegatePort, 'fixField' | 'linkedUid'>;

function makePort(over: {
  uid?: { ok: true; uid: string } | { ok: false; reason: 'unlinked' | 'outage' };
  fixField?: (req: FixFieldRequest) => FixFieldResult;
}): { port: PortStub; calls: FixFieldRequest[] } {
  const calls: FixFieldRequest[] = [];
  return {
    calls,
    port: {
      async linkedUid() {
        return over.uid ?? { ok: true, uid: 'firebase-uid-123' };
      },
      async fixField(_i, _u, req) {
        calls.push(req);
        return over.fixField ? over.fixField(req) : { kind: 'dryrun', before: {} };
      },
    },
  };
}

function makeMemory(initial: ConfirmChangePending | null = null): ConfirmMemory & {
  peek(): ConfirmChangePending | null;
} {
  let slot: ConfirmChangePending | null = initial;
  return {
    async loadPending() {
      return slot;
    },
    async savePending(p) {
      slot = p;
    },
    async clearPending() {
      slot = null;
    },
    peek: () => slot,
  };
}

const intent = { subject, instance: MAIN, fields: [{ field: 'series', after: 'The Stormlight Archive' }] };

// ── propose ─────────────────────────────────────────────────────────────────

describe('proposeConfirm — the dry-run is capability check #1 and reads before', () => {
  it('dry-runs, stores the proposal, and returns the restatement to render', async () => {
    const { port, calls } = makePort({
      fixField: () => ({ kind: 'dryrun', before: { series: 'Stormlight' } }),
    });
    const mem = makeMemory();
    const out = await proposeConfirm(intent, { discordUserId: 'asker-1' }, { port, memory: mem, keyMaterial: KEY }, NOW);
    // The dry-run ran, and it was a dry-run (nothing applied).
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.dryRun, true);
    // The proposal is stored with before read from the dry-run.
    const stored = mem.peek();
    assert.ok(stored);
    assert.equal(stored!.changes[0]!.before, 'Stormlight');
    assert.equal(stored!.changes[0]!.after, 'The Stormlight Archive');
    assert.ok(Array.isArray(out.components));
  });

  it('⚠️ capability refused AT PROPOSE relays the destination refusal, offers nothing', async () => {
    const { port } = makePort({
      fixField: () => ({ kind: 'refused', message: 'Your account on library is reader, and editing needs editCatalog.' }),
    });
    const mem = makeMemory();
    const out = await proposeConfirm(intent, { discordUserId: 'asker-1' }, { port, memory: mem, keyMaterial: KEY }, NOW);
    assert.match(out.content, /needs editCatalog/);
    assert.equal(out.components, undefined);
    assert.equal(mem.peek(), null); // nothing stored
  });

  it('says the prior proposal was dropped when a second displaces it', async () => {
    const { port } = makePort({ fixField: () => ({ kind: 'dryrun', before: { series: 'Old' } }) });
    const prior = buildConfirmProposal({
      askerId: 'asker-1', instance: 'library', subject, nonce: 'zzz999', now: NOW,
      fields: [{ field: 'description', before: 'a', after: 'b' }],
    });
    assert.ok(prior.ok);
    if (!prior.ok) return;
    const mem = makeMemory(prior.pending);
    const out = await proposeConfirm(intent, { discordUserId: 'asker-1' }, { port, memory: mem, keyMaterial: KEY }, NOW);
    assert.match(out.content, /replaces the change I offered/);
  });
});

// ── press ───────────────────────────────────────────────────────────────────

async function propose(memOver?: ConfirmMemory) {
  const { port } = makePort({ fixField: () => ({ kind: 'dryrun', before: { series: 'Stormlight' } }) });
  const mem = memOver ?? makeMemory();
  await proposeConfirm(intent, { discordUserId: 'asker-1' }, { port, memory: mem, keyMaterial: KEY }, NOW);
  return mem as ConfirmMemory & { peek(): ConfirmChangePending | null };
}

describe('pressConfirm — capability check #2, compare-and-set, and safe consumption', () => {
  it('applies on OK and reports the destination message + a Changes link', async () => {
    const mem = await propose();
    const nonce = (mem as ReturnType<typeof makeMemory>).peek()!.nonce;
    const { port, calls } = makePort({ fixField: () => ({ kind: 'applied', message: 'Updated the series.' }) });
    const out = await pressConfirm(
      { action: 'ok', nonce },
      { discordUserId: 'asker-1' },
      { port, memory: mem, keyMaterial: KEY },
      [MAIN],
      NOW + 1000,
    );
    assert.match(out.content, /Updated the series/);
    assert.match(out.content, /library\.heygabi\.ai\/work\/4711/);
    // ⚠️ Applied with before as the compare-and-set material, and NOT a dry-run.
    assert.equal(calls[0]!.dryRun, false);
    assert.equal(calls[0]!.changes[0]!.before, 'Stormlight');
    // ⚠️ Nonce consumed — a second press finds nothing.
    assert.equal((mem as ReturnType<typeof makeMemory>).peek(), null);
  });

  it('⚠️ capability refused AT PRESS (revoked between) is worded as a CHANGE, nothing applied', async () => {
    const mem = await propose();
    const nonce = (mem as ReturnType<typeof makeMemory>).peek()!.nonce;
    const { port } = makePort({ fixField: () => ({ kind: 'refused', message: 'no' }) });
    const out = await pressConfirm(
      { action: 'ok', nonce }, { discordUserId: 'asker-1' },
      { port, memory: mem, keyMaterial: KEY }, [MAIN], NOW + 1000,
    );
    assert.match(out.content, /could do this when I offered it and can't now/);
  });

  it('⚠️ the 409 compare-and-set refuses the WHOLE apply and says what it is now', async () => {
    const mem = await propose();
    const nonce = (mem as ReturnType<typeof makeMemory>).peek()!.nonce;
    const { port } = makePort({ fixField: () => ({ kind: 'changed', field: 'series', nowIs: 'Stormlight Archive' }) });
    const out = await pressConfirm(
      { action: 'ok', nonce }, { discordUserId: 'asker-1' },
      { port, memory: mem, keyMaterial: KEY }, [MAIN], NOW + 1000,
    );
    assert.match(out.content, /Someone changed the series/);
    assert.match(out.content, /Stormlight Archive/);
    assert.match(out.content, /haven't touched it/);
  });

  it('an unreachable destination after the nonce is spent is HONEST uncertainty', async () => {
    const mem = await propose();
    const nonce = (mem as ReturnType<typeof makeMemory>).peek()!.nonce;
    const { port } = makePort({ fixField: () => ({ kind: 'unreachable' }) });
    const out = await pressConfirm(
      { action: 'ok', nonce }, { discordUserId: 'asker-1' },
      { port, memory: mem, keyMaterial: KEY }, [MAIN], NOW + 1000,
    );
    assert.match(out.content, /not certain that landed/);
  });

  it('an expired proposal changes nothing', async () => {
    const mem = await propose();
    const nonce = (mem as ReturnType<typeof makeMemory>).peek()!.nonce;
    const { port, calls } = makePort({ fixField: () => ({ kind: 'applied', message: 'x' }) });
    const out = await pressConfirm(
      { action: 'ok', nonce }, { discordUserId: 'asker-1' },
      { port, memory: mem, keyMaterial: KEY }, [MAIN], NOW + 10 * 60 * 1000 + 1,
    );
    assert.match(out.content, /aged out/);
    assert.equal(calls.length, 0); // never called the destination
  });

  it('a different presser gets stale and never reaches the destination', async () => {
    const mem = await propose();
    const nonce = (mem as ReturnType<typeof makeMemory>).peek()!.nonce;
    const { port, calls } = makePort({ fixField: () => ({ kind: 'applied', message: 'x' }) });
    const out = await pressConfirm(
      { action: 'ok', nonce }, { discordUserId: 'not-the-asker' },
      { port, memory: mem, keyMaterial: KEY }, [MAIN], NOW + 1000,
    );
    assert.match(out.content, /either that button was for whoever asked/);
    assert.equal(calls.length, 0);
    // ⚠️ The real asker's proposal is untouched by a stranger's press.
    assert.ok((mem as ReturnType<typeof makeMemory>).peek());
  });

  it('Cancel clears the slot and writes nothing', async () => {
    const mem = await propose();
    const nonce = (mem as ReturnType<typeof makeMemory>).peek()!.nonce;
    const { port, calls } = makePort({ fixField: () => ({ kind: 'applied', message: 'x' }) });
    const out = await pressConfirm(
      { action: 'no', nonce }, { discordUserId: 'asker-1' },
      { port, memory: mem, keyMaterial: KEY }, [MAIN], NOW + 1000,
    );
    assert.match(out.content, /dropped that/);
    assert.equal(calls.length, 0);
    assert.equal((mem as ReturnType<typeof makeMemory>).peek(), null);
  });

  it('⚠️ double-press: the second press finds nothing (nonce consumed before the call)', async () => {
    const mem = await propose();
    const nonce = (mem as ReturnType<typeof makeMemory>).peek()!.nonce;
    let applied = 0;
    const { port } = makePort({ fixField: () => { applied += 1; return { kind: 'applied', message: 'ok' }; } });
    const deps = { port, memory: mem, keyMaterial: KEY };
    await pressConfirm({ action: 'ok', nonce }, { discordUserId: 'asker-1' }, deps, [MAIN], NOW + 1000);
    const second = await pressConfirm({ action: 'ok', nonce }, { discordUserId: 'asker-1' }, deps, [MAIN], NOW + 2000);
    assert.equal(applied, 1); // applied exactly once
    assert.match(second.content, /button was for whoever asked/); // stale
  });
});
