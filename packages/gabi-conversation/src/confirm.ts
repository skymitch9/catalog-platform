/**
 * `@platform/gabi-conversation` — **the T2 confirm lane's surface-neutral half.**
 *
 * Design of record: `catalog-platform/docs/info/gabi-confirm-lanes-design.md`.
 * This file is §5.3's *"core — surface-neutral, pure, testable with no Discord
 * and no DOM"*: the `confirm_change` proposal shape, the propose/validate/
 * compare-and-set arithmetic, the structured `Restatement` each surface renders,
 * the field allowlist, and the canonical bytes the confirm nonce's MAC covers.
 *
 * ⚠️ **What is NOT here, deliberately:**
 *
 *  - **The crypto.** The MAC's *material* (what bytes are signed, under which
 *    domain-separation label) is canonical and lives here so both surfaces sign
 *    the same thing; the `crypto.subtle` call and the surface's own key material
 *    stay in the surface, exactly as `moderation.ts`'s MAC does. The package's
 *    `tsconfig` is `lib: ["es2022"]` with `types: []` — it has no `crypto`
 *    global and must not grow one, because that purity is the portability.
 *  - **The words.** Every refusal here is a decision *key* (`ConfirmRefusal`),
 *    never a sentence. Discord's `CONFIRM_MSG` and the panel's own copy word
 *    them, because *"a core that emits markdown has already picked a surface"*
 *    (design §5). The four causes stay distinct because the fixes differ.
 *  - **The capability check and the apply.** Both are injected per surface: the
 *    Discord side borrows via the estate token and the panel borrows the
 *    signed-in user, so the *actual* `can(role, cap)` and the write are the
 *    surface's, checked at the DESTINATION (design §1).
 *
 * ## ⚠️ The MAC — a deliberate departure from design §3.3
 *
 * Design §3.3 argues the confirm nonce need NOT be signed, because the lane is
 * STATEFUL (the proposal lives in the per-person `pending` slot, so a lifted
 * nonce resolves a different record). The owner's T2 build brief overrides that
 * one point: **the confirm nonce IS MAC'd, like `moderation.ts`.** It is strictly
 * access-*reducing* belt-and-braces — a forged button is refused by the MAC
 * before the stateful lookup is even reached — and the global rule is to adopt
 * access-reducing changes without hesitation. The stateful per-presser check
 * (`checkConfirmPress`) still runs; the MAC is a second lock, not a replacement.
 */

// ---------------------------------------------------------------------------
// The shape — added to `PendingChoice` in index.ts as a third kind
// ---------------------------------------------------------------------------

/**
 * ⚠️ Pinned to the delegated allowlist's names (design §2). Phase 1 is exactly
 * one verb — `fix-field` — because *"the grammar is the risky part and
 * `fix-field` is the smallest thing that exercises all of it"* (design §10).
 */
export type ConfirmVerb = 'fix-field';

/** T2 (data mutations) today; T3 (people/club ops) is the reserved sibling and
 * is EXCLUDED from this build. Kept in the type so the shape does not move when
 * T3 lands. */
export type ConfirmTier = 2 | 3;

/**
 * One field that will change, structured — never rendered (design §2's
 * `FieldChange`). `before` is the compare-and-set material.
 */
export interface FieldChange {
  /** As the destination's API spells it (edit-audit §4.1 "what") — e.g. `series`. */
  field: string;
  /** As a human says it — e.g. "series", "volume". Never the raw column name. */
  label: string;
  /** ⚠️ The compare-and-set material (§4). Read from the propose-time dry-run,
   *  NEVER from the model and NEVER from the conversation. */
  before: string;
  /** What the person literally typed, echoed back verbatim in the restatement. */
  after: string;
}

/**
 * What is being changed, named the way a human names it (design §5.1 element 1).
 * The id travels in the payload; the `label` is what a person confirms.
 */
export interface ConfirmSubject {
  /** `work` in phase 1. The set will grow (`edition`, `copy`); no enum lock. */
  entity: 'work' | 'edition' | 'copy';
  /** The row id, as the destination addresses it. A string so an opaque id from
   *  a future surface is representable — it is never parsed here. */
  id: string;
  /** Title + author, or the like. ⚠️ Never a bare id (design §5.1). */
  label: string;
}

/**
 * The `confirm_change` proposal, as it sits in the per-person `pending` slot.
 * ⚠️ Zero new Durable Object writes: this replaces whatever pending question the
 * conversation held (design §2 / §2.1 cost 1).
 */
export interface ConfirmChangePending {
  kind: 'confirm_change';
  /** ⚠️ MAC'd on the wire (see the header). Still resolved against the PRESSER's
   *  own conversation record, so the MAC is a second lock, not the only one. */
  nonce: string;
  /** What she asked, so a resumed answer can restate it rather than assume. */
  question: string;
  /** The confirm lane carries no menu; kept `[]` so the `PendingBase` shape and
   *  `pruneConversation`'s reader are unchanged. */
  options: never[];
  /** Epoch ms of the propose — `pruneConversation` reads this. */
  at: number;

  tier: ConfirmTier;
  verb: ConfirmVerb;
  /** Resolved at PROPOSE time, never re-resolved (design §2). */
  instance: string;
  /** ⚠️ Redundant on purpose (design §3.4): the record was found BY this
   *  person's key, so this is belt-and-braces against a future key-derivation
   *  refactor. A test constructs the broken derivation to prove it earns its
   *  keep. Do not "clean up the duplicate check". */
  askerId: string;
  subject: ConfirmSubject;
  /** ⚠️ STRUCTURED, not rendered (design §5). At least one, each an actual change. */
  changes: FieldChange[];
  /** ⚠️ ABSOLUTE, not derived from `at` + a constant (design §3.1) — this record
   *  is read by a SECOND implementation (the panel) whose constant could differ. */
  expiresAt: number;
}

// ---------------------------------------------------------------------------
// TTL
// ---------------------------------------------------------------------------

/**
 * ⚠️ **Ten minutes** (design §3.1). A book's fields decay slowly, but a button
 * describing an edit nobody remembers requesting is its own defect. It is about
 * human MEMORY, not correctness — `compareAndSet` below is the safety, so this
 * can be chosen for readability. It is deliberately SHORTER than
 * `PENDING_TTL_MS` (15) and the 30-minute window, so the proposal always dies
 * before its conversation does (design §2.1 cost 2).
 */
export const T2_CONFIRM_TTL_MS = 10 * 60 * 1000;

// ---------------------------------------------------------------------------
// The field allowlist — default-deny, an explicit array (design §4.2 / §6.5)
// ---------------------------------------------------------------------------

/**
 * ⚠️ **THE CONFIRMABLE FIELDS, as an explicit array.** A book's OWN, free-tier
 * fields — the ones the edit-audit design's "Free" tier names, which move no
 * `work_key` and join nothing. `title` and `authors` are ABSENT and must stay
 * absent: they move the review-bridge key and are the key-move ceremony's
 * subject, never a chat confirm's (design §4.3, edit-audit §5).
 *
 * The estate's default-deny rule, pointed at writes: *"allowed fields as an
 * explicit array, never SELECT-*-minus-exclusions — the exclusion form leaks
 * when a column is added."* An ARRAY, not a `Record`, so `__proto__`/`toString`
 * are not quietly truthy — the classic allowlist hole (`isGabiToolName`'s rule).
 * The DESTINATION re-checks this; it is not a check the caller can skip.
 */
export const T2_CONFIRMABLE_FIELDS = [
  'subtitle',
  'series',
  'seriesIndexDisplay',
  'description',
  'coverUrl',
  'illustrator',
] as const;

export type T2ConfirmableField = (typeof T2_CONFIRMABLE_FIELDS)[number];

/** The human label for a confirmable field. A `switch` rather than a `Record`
 * for the same default-deny reason the array is an array. */
export function fieldLabel(field: string): string | null {
  switch (field) {
    case 'subtitle':
      return 'subtitle';
    case 'series':
      return 'series';
    case 'seriesIndexDisplay':
      return 'volume';
    case 'description':
      return 'description';
    case 'coverUrl':
      return 'cover';
    case 'illustrator':
      return 'illustrator';
    default:
      return null;
  }
}

export function isConfirmableField(field: unknown): field is T2ConfirmableField {
  return typeof field === 'string' && (T2_CONFIRMABLE_FIELDS as readonly string[]).includes(field);
}

// ---------------------------------------------------------------------------
// Propose — build the proposal, validating the fields (pure)
// ---------------------------------------------------------------------------

/** One field the caller wants changed, with `before` read from the dry-run and
 * `after` from what the person typed. */
export interface ProposeFieldInput {
  field: string;
  before: string;
  after: string;
}

export interface ProposeInput {
  askerId: string;
  instance: string;
  subject: ConfirmSubject;
  fields: readonly ProposeFieldInput[];
  nonce: string;
  now: number;
  /** Override the 10-minute default only in a test. */
  ttlMs?: number;
}

export type ProposeResult =
  | { ok: true; pending: ConfirmChangePending }
  | { ok: false; reason: 'no_fields' | 'field_not_allowed' | 'no_change'; field?: string };

/**
 * Build a `confirm_change` proposal, or refuse in a way the surface can word.
 *
 * ⚠️ **Default-deny on the field name, and no-op fields are dropped.** A field
 * outside the allowlist refuses the WHOLE proposal (`field_not_allowed`) rather
 * than silently filtering — a stripped field is the silent-failure bug the
 * estate has already paid for. A field whose `before === after` changes nothing
 * and is removed; if nothing is left to change, the proposal is refused
 * (`no_change`) rather than offering a button that does nothing.
 */
export function buildConfirmProposal(input: ProposeInput): ProposeResult {
  if (input.fields.length === 0) return { ok: false, reason: 'no_fields' };

  const changes: FieldChange[] = [];
  for (const f of input.fields) {
    const label = fieldLabel(f.field);
    if (!isConfirmableField(f.field) || label === null) {
      return { ok: false, reason: 'field_not_allowed', field: f.field };
    }
    // ⚠️ No-op dropped, not logged — a PATCH re-sending the same value is noise
    // (edit-audit §4.2). Compared on the trimmed strings the person will see.
    if (f.before === f.after) continue;
    changes.push({ field: f.field, label, before: f.before, after: f.after });
  }

  if (changes.length === 0) return { ok: false, reason: 'no_change' };

  const ttl = input.ttlMs ?? T2_CONFIRM_TTL_MS;
  return {
    ok: true,
    pending: {
      kind: 'confirm_change',
      nonce: input.nonce,
      question: `Confirm changes to ${input.subject.label}`,
      options: [],
      at: input.now,
      tier: 2,
      verb: 'fix-field',
      instance: input.instance,
      askerId: input.askerId,
      subject: input.subject,
      changes,
      expiresAt: input.now + ttl,
    },
  };
}

// ---------------------------------------------------------------------------
// The Restatement — structure; each surface renders it (design §5.3)
// ---------------------------------------------------------------------------

/** A §5.2 per-verb-class note, structured. Phase 1 (`fix-field`) needs none,
 * but the shape exists so `swap-cover`/`merge-series` slot in without a
 * signature change. */
export interface RestatementNote {
  kind: string;
  text: string;
}

/**
 * Everything a surface needs to render the confirm, and NOTHING about how
 * (design §5.3). Discord bolds with `**`; the panel uses the DOM; both read
 * this.
 */
export interface Restatement {
  /** §5.1 element 1 + 3: the subject, and the instance it lives on. */
  subject: { label: string; instance: string };
  /** §5.1 element 2: before → after, per field, both values shown. */
  changes: FieldChange[];
  /** §5.1 element 4: the borrowed authority, in words the person owns. */
  authority: { capability: string; instanceLabel: string };
  extra: RestatementNote[];
  tier: ConfirmTier;
}

export interface RestatementContext {
  /** The destination capability the verb borrows — for the "as you, using your
   *  … access" sentence. Named, never checked here. */
  capability: string;
  /** What the instance is called in a sentence — "the main library". */
  instanceLabel: string;
}

/** Turn a stored proposal into the structure a surface renders. Pure. */
export function buildRestatement(
  pending: ConfirmChangePending,
  ctx: RestatementContext,
): Restatement {
  return {
    subject: { label: pending.subject.label, instance: ctx.instanceLabel },
    changes: pending.changes,
    authority: { capability: ctx.capability, instanceLabel: ctx.instanceLabel },
    extra: [],
    tier: pending.tier,
  };
}

// ---------------------------------------------------------------------------
// Compare-and-set — the restatement must still be true (design §4)
// ---------------------------------------------------------------------------

export type CompareResult =
  | { ok: true }
  /** design §4.2's 409: a field's `before` no longer matches what the row says
   *  now. `nowIs` is what it says now — worded, never a bare status. */
  | { ok: false; field: string; nowIs: string };

/**
 * ⚠️ **THE HARD PART (design §4).** Validate the WHOLE proposed state against
 * the whole fresh state: every proposed `before` must still equal what the row
 * holds now, re-read at press time. This is the exact-equality form, never the
 * contains form (§4.1's borrowed lesson) — a field that changed underneath
 * refuses the entire apply rather than clobbering somebody else's edit and
 * writing an audit row whose `before` is a lie.
 *
 * `fresh` maps field → current value; a field absent from `fresh` is treated as
 * the empty string, the same normalisation the proposal used, so "it was set
 * and is now cleared" is caught rather than read as a match.
 */
export function compareAndSet(
  changes: readonly FieldChange[],
  fresh: Readonly<Record<string, string>>,
): CompareResult {
  for (const c of changes) {
    const now = Object.prototype.hasOwnProperty.call(fresh, c.field) ? fresh[c.field] ?? '' : '';
    if (now !== c.before) return { ok: false, field: c.field, nowIs: now };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// The press check — TTL, the nonce, and who may press (design §3)
// ---------------------------------------------------------------------------

export type PressCheck =
  | { ok: true; pending: ConfirmChangePending }
  /** `stale` = no such live proposal for this presser; `expired` = found, aged
   *  out. Different words on purpose (design §8), because the fixes differ. */
  | { ok: false; reason: 'stale' | 'expired' };

/**
 * Decide whether a press may proceed, from the loaded pending slot alone.
 *
 * ⚠️ The order matters. A wrong nonce or a wrong presser is `stale` (there is no
 * proposal for THIS press) and never `expired` — telling a forger "it just aged
 * out" would confirm their nonce was otherwise fine. Expiry is checked LAST,
 * only once the proposal is confirmed to be this presser's.
 *
 * ⚠️ **`askerId` is re-checked even though the record was found by the presser's
 * key** (design §3.4) — the redundant check that survives a key-derivation
 * refactor. It costs one string comparison.
 */
export function checkConfirmPress(
  pending: ConfirmChangePending | null | undefined,
  nonce: string,
  presserId: string,
  now: number,
): PressCheck {
  if (!pending || pending.kind !== 'confirm_change') return { ok: false, reason: 'stale' };
  if (pending.nonce !== nonce) return { ok: false, reason: 'stale' };
  if (pending.askerId !== presserId) return { ok: false, reason: 'stale' };
  if (pending.expiresAt <= now) return { ok: false, reason: 'expired' };
  return { ok: true, pending };
}

// ---------------------------------------------------------------------------
// The refusal decision set — keys, not words (design §8)
// ---------------------------------------------------------------------------

/**
 * ⚠️ The decision each refusal names, so both surfaces answer the same set of
 * causes with their own copy. Every one says whether anything was changed —
 * after a press, *"did that land?"* is the only question the person has.
 */
export type ConfirmRefusal =
  | 'confirmStale'
  | 'confirmExpired'
  | 'changedUnderneath'
  | 'alreadyApplied'
  | 'capabilityRefused'
  | 'capabilityLost'
  | 'writeCapped'
  | 'confirmReplaced'
  | 'applyUncertain'
  | 'cancelled'
  | 't4Wall';

// ---------------------------------------------------------------------------
// The MAC — canonical material only; the crypto is the surface's (see header)
// ---------------------------------------------------------------------------

/** Domain separation — a fourth MAC use in this estate gets a fourth label,
 * never one of `moderation.ts`'s or `link-token.ts`'s. */
export const CONFIRM_MAC_LABEL = 'gabi-confirm-t2-v1';

/** The two component actions a confirm carries. Two letters, matching the
 * `gc|pick|more` vocabulary the continuity layer already uses. */
export const CONFIRM_ACTIONS = ['ok', 'no'] as const;
export type ConfirmAction = (typeof CONFIRM_ACTIONS)[number];

/** The Discord component prefix — `gc2`, distinct from continuity's `gc` so the
 * router never reads a clarifying-question nonce as a confirm (design §5.3 uses
 * `gc|ok`; this build MACs it and namespaces it separately). */
export const CONFIRM_PREFIX = 'gc2';

/**
 * ⚠️ **THE BYTES BOTH SURFACES SIGN.** The nonce, the presser (`askerId`), the
 * instance and the absolute expiry — joined canonically, so a signature made on
 * Discord and one made on the panel cover the same associated data even though
 * each surface verifies only its own. `askerId` and `instance` are ASSOCIATED
 * DATA: they are folded into the MAC but not transmitted in the `custom_id`,
 * recomputed at verify time from the pressing interaction (moderation.ts's
 * trick), so the signature binds "this proposal, this person, this shelf" for
 * free and inside Discord's 100-character ceiling.
 */
export function confirmSignedMaterial(parts: {
  nonce: string;
  askerId: string;
  instance: string;
  expSeconds: number;
}): string {
  return [parts.nonce, parts.askerId, parts.instance, String(parts.expSeconds)].join('|');
}

/**
 * `gc2|<action>|<nonce>|<expBase36>|<sig>` — the pure format. The surface
 * computes `sig` from `confirmSignedMaterial` with its own key and assembles.
 */
export function formatConfirmCustomId(
  action: ConfirmAction,
  nonce: string,
  expSeconds: number,
  sig: string,
): string {
  return [CONFIRM_PREFIX, action, nonce, expSeconds.toString(36), sig].join('|');
}

export type ParsedConfirmCustomId = {
  action: ConfirmAction;
  nonce: string;
  expSeconds: number;
  sig: string;
};

const CONFIRM_NONCE = /^[a-z0-9]{1,16}$/;

/** Parse and shape-check; the MAC is verified by the surface with its key.
 * Returns `null` on any shape the builder never produced. */
export function parseConfirmCustomId(customId: string): ParsedConfirmCustomId | null {
  const parts = customId.split('|');
  if (parts.length !== 5 || parts[0] !== CONFIRM_PREFIX) return null;
  const [, action, nonce, expRaw, sig] = parts as [string, string, string, string, string];
  if (!(CONFIRM_ACTIONS as readonly string[]).includes(action)) return null;
  if (!CONFIRM_NONCE.test(nonce)) return null;
  const expSeconds = parseInt(expRaw, 36);
  if (!Number.isFinite(expSeconds) || expSeconds <= 0) return null;
  if (sig.length === 0) return null;
  return { action: action as ConfirmAction, nonce, expSeconds, sig };
}
