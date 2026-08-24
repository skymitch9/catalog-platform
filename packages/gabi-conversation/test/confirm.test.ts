/**
 * The T2 confirm lane's surface-neutral half — `src/confirm.ts`.
 *
 * These pin the invariants that do NOT need a surface: the field allowlist
 * (default-deny), the propose arithmetic (no-op drop, refusals), the
 * compare-and-set 409 (design §4, the HARD part), the TTL/nonce/presser press
 * check (design §3), and the pure MAC material + custom_id format. The MAC's
 * crypto — "a forged nonce is rejected" — is exercised where the crypto lives,
 * in `apps/discord-worker/test/confirm.test.ts`.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  T2_CONFIRM_TTL_MS,
  T2_CONFIRMABLE_FIELDS,
  buildConfirmProposal,
  buildRestatement,
  checkConfirmPress,
  compareAndSet,
  confirmableFieldFromLabel,
  confirmSignedMaterial,
  fieldLabel,
  formatConfirmCustomId,
  isConfirmableField,
  parseConfirmCustomId,
  type ConfirmChangePending,
  type FieldChange,
} from '../src/index.js';

const NOW = 1_700_000_000_000;

const subject = { entity: 'work' as const, id: '4711', label: 'The Way of Kings by Brandon Sanderson' };

const propose = (fields: { field: string; before: string; after: string }[], over = {}) =>
  buildConfirmProposal({
    askerId: 'asker-1',
    instance: 'library',
    subject,
    fields,
    nonce: 'abc123',
    now: NOW,
    ...over,
  });

// ── the field allowlist ─────────────────────────────────────────────────────

describe('⚠️ the field allowlist is default-deny', () => {
  it('accepts only the explicit free-tier fields', () => {
    for (const f of T2_CONFIRMABLE_FIELDS) assert.ok(isConfirmableField(f), f);
    assert.ok(fieldLabel('seriesIndexDisplay') === 'volume');
  });

  it('refuses the key-movers and prototype-pollution holes', () => {
    // title/authors move work_key — they are the ceremony's subject, never a chat confirm's.
    assert.equal(isConfirmableField('title'), false);
    assert.equal(isConfirmableField('authors'), false);
    // The classic allowlist hole an array (not a Record) closes.
    assert.equal(isConfirmableField('__proto__'), false);
    assert.equal(isConfirmableField('toString'), false);
    assert.equal(fieldLabel('title'), null);
  });
});

// ── the propose-trigger's human-word → field map ────────────────────────────

describe('⚠️ confirmableFieldFromLabel — maps chat words, default-denies key-moves', () => {
  it('maps every human synonym onto a member of the allowlist', () => {
    assert.equal(confirmableFieldFromLabel('series'), 'series');
    assert.equal(confirmableFieldFromLabel('volume'), 'seriesIndexDisplay');
    assert.equal(confirmableFieldFromLabel('series number'), 'seriesIndexDisplay');
    assert.equal(confirmableFieldFromLabel('cover'), 'coverUrl');
    assert.equal(confirmableFieldFromLabel('blurb'), 'description');
    assert.equal(confirmableFieldFromLabel('artist'), 'illustrator');
    assert.equal(confirmableFieldFromLabel('SubTitle '), 'subtitle');
  });

  it('accepts an API field name verbatim (the model may emit it)', () => {
    assert.equal(confirmableFieldFromLabel('seriesIndexDisplay'), 'seriesIndexDisplay');
    assert.equal(confirmableFieldFromLabel('coverUrl'), 'coverUrl');
  });

  it('⚠️ default-denies the key-movers, non-work fields, and rubbish → null', () => {
    for (const w of ['title', 'author', 'authors', 'narrator', 'genre', 'none', '', 'toString', '__proto__', 42])
      assert.equal(confirmableFieldFromLabel(w as unknown), null, `${String(w)} must not map`);
  });

  it('every non-null result is in the allowlist — it can never widen it', () => {
    for (const w of ['series', 'volume', 'cover', 'blurb', 'artist', 'subtitle', 'summary']) {
      const f = confirmableFieldFromLabel(w);
      assert.ok(f && (T2_CONFIRMABLE_FIELDS as readonly string[]).includes(f), w);
    }
  });
});

// ── propose ─────────────────────────────────────────────────────────────────

describe('buildConfirmProposal — a correct restatement, or a worded refusal', () => {
  it('builds a proposal with structured before→after and an absolute expiry', () => {
    const r = propose([{ field: 'series', before: 'Stormlight', after: 'The Stormlight Archive' }]);
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.equal(r.pending.kind, 'confirm_change');
    assert.equal(r.pending.tier, 2);
    assert.equal(r.pending.verb, 'fix-field');
    assert.equal(r.pending.instance, 'library');
    assert.equal(r.pending.askerId, 'asker-1');
    assert.equal(r.pending.expiresAt, NOW + T2_CONFIRM_TTL_MS);
    assert.deepEqual(r.pending.changes, [
      { field: 'series', label: 'series', before: 'Stormlight', after: 'The Stormlight Archive' },
    ]);
    // Zero new storage: it is a pending slot, options empty.
    assert.deepEqual(r.pending.options, []);
  });

  it('refuses a field outside the allowlist — the WHOLE proposal, never a silent strip', () => {
    const r = propose([{ field: 'authors', before: 'B. Sanderson', after: 'Brandon Sanderson' }]);
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.reason, 'field_not_allowed');
    assert.equal(r.field, 'authors');
  });

  it('drops a no-op field, and refuses when nothing is left to change', () => {
    const r = propose([{ field: 'series', before: 'Stormlight', after: 'Stormlight' }]);
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.reason, 'no_change');
  });

  it('refuses with no fields at all', () => {
    const r = propose([]);
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.reason, 'no_fields');
  });
});

// ── the restatement structure ───────────────────────────────────────────────

describe('buildRestatement — the four mandatory elements, as structure', () => {
  it('carries subject+instance, before→after, and the borrowed authority', () => {
    const r = propose([
      { field: 'series', before: 'Stormlight', after: 'The Stormlight Archive' },
      { field: 'seriesIndexDisplay', before: '1', after: 'Book 1' },
    ]);
    assert.ok(r.ok);
    if (!r.ok) return;
    const rest = buildRestatement(r.pending, {
      capability: 'editCatalog',
      instanceLabel: 'the main library',
    });
    assert.equal(rest.subject.label, subject.label);
    assert.equal(rest.subject.instance, 'the main library');
    assert.equal(rest.changes.length, 2);
    assert.equal(rest.authority.capability, 'editCatalog');
    assert.equal(rest.authority.instanceLabel, 'the main library');
    assert.equal(rest.tier, 2);
  });
});

// ── compare-and-set: the HARD part (design §4) ──────────────────────────────

describe('⚠️ compareAndSet — the restatement must still be true at press time', () => {
  const changes: FieldChange[] = [
    { field: 'series', label: 'series', before: 'Stormlight', after: 'The Stormlight Archive' },
    { field: 'description', label: 'description', before: 'A book.', after: 'An epic.' },
  ];

  it('applies when every before still matches', () => {
    assert.deepEqual(compareAndSet(changes, { series: 'Stormlight', description: 'A book.' }), {
      ok: true,
    });
  });

  it('409s the WHOLE apply when one field changed underneath — never a partial', () => {
    const r = compareAndSet(changes, { series: 'Stormlight Archive', description: 'A book.' });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.field, 'series');
    assert.equal(r.nowIs, 'Stormlight Archive');
  });

  it('treats a now-cleared field as changed (absent = empty, not a match)', () => {
    const one: FieldChange[] = [
      { field: 'series', label: 'series', before: 'Stormlight', after: 'x' },
    ];
    const r = compareAndSet(one, {});
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.nowIs, '');
  });
});

// ── the press check: TTL, nonce, presser (design §3) ────────────────────────

const pendingOf = (over: Partial<ConfirmChangePending> = {}): ConfirmChangePending => {
  const r = propose([{ field: 'series', before: 'Stormlight', after: 'The Stormlight Archive' }]);
  assert.ok(r.ok);
  if (!r.ok) throw new Error('unreachable');
  return { ...r.pending, ...over };
};

describe('⚠️ checkConfirmPress — only the asker, only in time, only this nonce', () => {
  it('passes the asker with the right nonce inside the TTL', () => {
    const r = checkConfirmPress(pendingOf(), 'abc123', 'asker-1', NOW + 1000);
    assert.equal(r.ok, true);
  });

  it('a wrong nonce is STALE, never expired (never confirm a forger their nonce was fine)', () => {
    const r = checkConfirmPress(pendingOf(), 'wrongnonce', 'asker-1', NOW + 1000);
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.reason, 'stale');
  });

  it('⚠️ a different presser is STALE — the redundant askerId check earns its keep', () => {
    // The belt-and-braces check design §3.4 says not to "clean up": even with a
    // matching nonce, a presser who is not the asker is refused.
    const r = checkConfirmPress(pendingOf(), 'abc123', 'someone-else', NOW + 1000);
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.reason, 'stale');
  });

  it('an aged-out proposal is EXPIRED, and expiry is checked AFTER identity', () => {
    const past = checkConfirmPress(pendingOf(), 'abc123', 'asker-1', NOW + T2_CONFIRM_TTL_MS + 1);
    assert.equal(past.ok, false);
    if (past.ok) return;
    assert.equal(past.reason, 'expired');
    // A forger past the TTL still gets stale, not expired.
    const forged = checkConfirmPress(pendingOf(), 'abc123', 'nope', NOW + T2_CONFIRM_TTL_MS + 1);
    assert.equal(forged.ok, false);
    if (forged.ok) return;
    assert.equal(forged.reason, 'stale');
  });

  it('a non-confirm or absent pending is stale', () => {
    assert.equal(checkConfirmPress(null, 'abc123', 'asker-1', NOW).ok, false);
  });
});

// ── the MAC material + custom_id format (pure; crypto tested on the surface) ──

describe('the MAC material and custom_id are canonical and round-trip', () => {
  it('signs the nonce, presser, instance and expiry as associated data', () => {
    const material = confirmSignedMaterial({
      nonce: 'abc123',
      askerId: 'asker-1',
      instance: 'library',
      expSeconds: 1700,
    });
    assert.equal(material, 'abc123|asker-1|library|1700');
  });

  it('formats and parses a gc2 custom_id, and rejects the continuity gc prefix', () => {
    const id = formatConfirmCustomId('ok', 'abc123', 1700, 'deadbeef');
    assert.equal(id, 'gc2|ok|abc123|1b8|deadbeef');
    const parsed = parseConfirmCustomId(id);
    assert.ok(parsed);
    assert.deepEqual(parsed, { action: 'ok', nonce: 'abc123', expSeconds: 1700, sig: 'deadbeef' });
    // The clarifying-question vocabulary must not parse as a confirm.
    assert.equal(parseConfirmCustomId('gc|pick|abc123'), null);
    assert.equal(parseConfirmCustomId('gc2|maybe|abc123|1c8|sig'), null);
    assert.equal(parseConfirmCustomId('gc2|ok|abc123|1c8|'), null);
  });
});
