# GABI T2/T3 — the confirm grammar

> **Audience:** Claude sessions and the owner. **Status:** TRACKED (public repo
> — no secrets, no household names). Last verified: **2026-08-18** (design);
> **2026-08-24** (build status below).
>
> ⚠️ **BUILD STATUS — T2 phase 1 BUILT DARK, pending review (2026-08-24).**
> Phase 1 (§10) — **the grammar with the one verb `fix-field`, compare-and-set
> and the 409** — is built on branches `feature/gabi-t2-confirm`
> (catalog-platform: the surface-neutral core in `packages/gabi-conversation/
> src/confirm.ts` + the discord-worker wiring) and `feature/gabi-t2-panel`
> (library_catalog: the `fix-field` worker verb + the panel card). **Owner scope:
> T2 only (catalog-fix), Discord + library panel, audiobook surface EXCLUDED.**
> It ships **DARK** behind `GABI_CONFIRM_T2` (affirmative-only, off) on both
> surfaces; nothing changes for users until the owner flips it. ⚠️ **One
> deliberate departure from §3.3:** the confirm nonce **IS MAC'd** (like
> `moderation.ts`), per the owner's T2 brief — access-reducing belt-and-braces on
> top of the stateful per-presser check. T3, `add-photo`, and phases 2/4/6 remain
> DESIGN ONLY. The rest of this document is the design as written; where the
> build diverged, the code comments say so.
>
> ⚠️ **PROPOSE-TRIGGER BUILT DARK, pending review (2026-08-24).** The press half
> above was merged to `main`; the **propose trigger** — turning a chat message
> into a proposal + confirm card — is built on `feature/gabi-t2-propose-trigger`
> (catalog-platform, **Discord surface + the surface-neutral parse map**). Flow:
> `fix_request` + `GABI_CONFIRM_T2` on → `confirm-propose.ts` parses the message
> (Haiku) into `{book, field, value}` (`confirmableFieldFromLabel` default-denies
> `title`/`author`/anything unmapped), routes by the asker's own `whoami` to the
> ONE shelf they can edit, resolves the title to exactly one held work via
> `browse-works`, dry-runs `fix-field` for `before`, and renders the confirm card
> through the EXISTING press path. ⚠️ **Phase-1 boundaries, all deferring to the
> panel-link answer (design §4.3):** a message that isn't a single confirmable-
> field change; the asker editable on BOTH shelves or neither (no nested "which
> shelf?"); a title matching zero or >1 held works (no disambiguation nested in a
> confirm); and the **modal typed-follow-up door** (its `ResumeOutcome` can't
> carry buttons yet). ⚠️ **Still DARK** — `GABI_CONFIRM_T2` unflipped; the panel's
> OWN propose trigger (library_catalog `feature/gabi-t2-panel`) is separate. The
> subject-resolution note in §12 (no title→id search existed) is answered by the
> `browse-works` local match, since the whole physical shelf (~341 works) fits
> under that verb's 500 ceiling.
>
> Companions: [`gabi-application-map.md`](gabi-application-map.md) §2a (T1's
> delegation contract, which this extends **unchanged**) and §2d (photo intake,
> which becomes a T2 citizen here);
> [`gabi-conversation-continuity.md`](gabi-conversation-continuity.md) §5 (the
> components machinery this reuses); [`edit-audit-design.md`](edit-audit-design.md)
> §4 (the audit contract every write answers);
> [`role-capability-map.md`](role-capability-map.md) (the capability names).
>
> The application map's build order item 6 says a T2 confirm is the T1 instance
> menu *"with one option and a restatement"*. That is right about the
> **machinery** and wrong about the **hard part**, which is the restatement
> being still true at the moment somebody presses. §4 is that problem.

---

## 0. What this is, in one paragraph

T2 (mutating existing data) and T3 (people and club operations) share one
grammar: **propose → restate exactly what will change → a confirm button →
apply with the asker's borrowed authority → report what happened.** Everything
below is that sentence made concrete against machinery that already exists.
Nothing here invents a new credential, a new identity system, or a second copy
of a role matrix. **GABI still owns no permissions** — the destination site
checks the asker's real stored role, exactly as it does for T1, and the confirm
lane changes only *when* that check happens relative to a human eyeball.

---

## 1. ⚠️ The spine, which does not move

T1's delegation contract (application map §2a) extends to T2 and T3 **with no
structural change**. Restated here so this doc can be read alone:

```
POST  https://<instance>/api/gabi/delegated/<verb>
Authorization: Bearer <ESTATE_APP_TOKEN_DISCORD>
{ "onBehalfOf": "<firebaseUid>", …verb payload… }
```

| Layer | What it proves |
|---|---|
| `ESTATE_APP_TOKEN_DISCORD` | the caller is the estate's Discord Worker — **nothing about what may be written** |
| `onBehalfOf` uid | the `discord_links/{id}` doc the person created with their own Discord OAuth **and** their own Firebase sign-in |
| `app_user` lookup + `can(role, capability)` **on the destination** | the asker's real stored role there |

⚠️ **The authority check is the DESTINATION'S, and only the destination's.** The
bot performs no role check of its own, for T2 and T3 as for T1: *a check the
caller performs is a check the caller can skip, and a second copy of a role
matrix is the copy that goes stale.* GABI relays the destination's own worded
refusal verbatim.

### 1.1 ⚠️ The one thing that IS new: the check runs TWICE

T1 calls the destination once. A confirm lane has two moments — the propose and
the press — and **the capability is checked at BOTH**, because a role can be
revoked in between and the estate's standing rule is that *revocation beats
everything*.

| Moment | Call | Why it cannot be skipped |
|---|---|---|
| **propose** | a `dry-run` on the destination | It is how the **before** values are read. Proposing a change to somebody who may not make it is a restatement that ends in a refusal — worse than refusing first |
| **press** | the real verb | The propose-time answer is a **measurement with an age**. Between the two, a role can be revoked, an estate status can flip to `revoked`, or the row can be edited by somebody else |

⚠️ **The press-time check is the one that authorises.** The propose-time check is
a courtesy that produces the restatement. If they ever disagree, the press-time
answer wins and is relayed in words — never a silent no-op, never a bare status.

---

## 2. Where a proposal lives

**Decision: the `pending.*` slot on the existing conversation record, as a third
`PendingChoice` kind.** Not its own document, not a new key namespace, not a new
Durable Object.

⚠️ **`PendingChoice` MOVED while this design was being written, in a way that
helps — measured, not assumed.** Commit `98e5991` (2026-08-18, *"The
conversation substrate leaves Discord: one shape, two surfaces"*) extracted the
surface-neutral half into **`packages/gabi-conversation/`**
(`@platform/gabi-conversation`), consumed in-repo by the Discord Worker and
cross-repo by `library_catalog`. `conversation.ts` re-exports it, so no importer
changed.

**So `confirm_change` is added to `packages/gabi-conversation/src/index.ts`, not
to the Discord Worker** — and §5's surface-neutral claim stops being an
aspiration and becomes structural: the panel imports the same type rather than
reimplementing it. The extraction's own comment on `PendingChoice` anticipates
this lane in as many words:

> *"The field stays neutral rather than Discord-only because **a T2 confirm on
> the panel is the same shape**."*

⚠️ Note what stayed behind in the Worker, because §5.3 depends on the split:
**the `gc|…` custom_id vocabulary, the select menu, the modal and `CONV_MSG`'s
sentences are Discord-only.** That is exactly the seam this design needs — the
*structure* is shared, the *rendering* is not.

```ts
// packages/gabi-conversation/src/index.ts — the third kind
export type PendingChoice =
  | ({ kind: 'book_pick' }     & PendingBase)
  | ({ kind: 'instance_pick' } & PendingBase & { verb: …; isbn?: string })
  | ({ kind: 'confirm_change' } & PendingBase & {
      tier:     2 | 3;
      verb:     ConfirmVerb;        // pinned to the delegated allowlist
      instance: string;             // resolved at PROPOSE time, never re-resolved
      askerId:  string;             // §3.2 — redundant on purpose
      subject:  ConfirmSubject;     // what is being changed, named for a human
      changes:  FieldChange[];      // ⚠️ STRUCTURED, not rendered — §5
      expiresAt: number;            // ⚠️ absolute, not derived — §3.1
    });

interface FieldChange {
  field:  string;   // as the destination's API spells it (edit-audit §4.1 "what")
  label:  string;   // as a human says it ("narrator", not "narrator_name")
  before: string;   // ⚠️ the compare-and-set material — §4
  after:  string;
}
```

### 2.1 Why the pending slot, stated as the costs it accepts

| Property inherited free | Consequence |
|---|---|
| the record is keyed `(surface, space, person)` | **only the asker can hold a proposal**, and §3 gets its answer for nothing |
| aged-out state is **DELETED, not archived** (continuity §2.1) | a proposal nobody pressed leaves no trace — the same privacy posture, unchanged |
| `v` is checked on every read; an unknown version is **absent** | a bad write can never become a permanent wrong proposal |
| the store is the gateway Durable Object | ⚠️ **no new binding, no new write-budget paragraph** — §2.3 |
| the panel adopts the shape, not the storage (continuity §1.3) | the confirm lane is portable on day one, not retrofitted |

**Three costs, each accepted deliberately:**

1. ⚠️ **One pending at a time, per person per space.** A second proposal
   **replaces** the first. This is a *feature*: two half-answered mutations
   sitting in one conversation is a state in which "yes" is ambiguous, and the
   replaced proposal's button correctly answers `stale`. She says so when it
   happens — *"that replaces the change I offered a moment ago, which I've
   dropped"* — because a silently dropped proposal is indistinguishable from a
   bug.
2. **A proposal dies with its conversation.** `pruneConversation()` returning
   `null` deletes the key and the pending with it. Harmless: every confirm TTL
   in §3.1 is **shorter than the 30-minute window**, so the conversation always
   outlives the button. ⚠️ If any TTL is ever raised past 30 minutes, this
   sentence is what breaks first.
3. **Size.** A full record is ~12 KB against a 128 KiB per-value ceiling. A
   `changes[]` of a handful of fields is noise against that. ⚠️ The one shape
   that could threaten it — a series merge naming hundreds of books — is capped
   in §6.2 for a *different* reason (a restatement nobody can read), and the cap
   holds this too.

### 2.2 Why NOT its own doc with a TTL

| Candidate | Why not |
|---|---|
| A Firestore doc | A service-account round trip on the propose path, and it would put a described-but-unmade change in the estate's primary datastore. `mention-flow.ts` is pinned by a test that greps it for `firestoreRequest` — a proposal store there would either fail that test or force it to be weakened |
| A **new** Durable Object | Named BLOCKING in `wrangler.toml` for exactly the reason continuity §3 gives; one always-on socket already accrues ~83% of the free daily allowance |
| A new `prop:` namespace in the same object | Defensible, and rejected only because it buys nothing: a proposal is *conversation state*, it expires with the conversation, and a second key means a second thing to garbage-collect |
| A **cron**-swept table | Free cron slots are exhausted; a prior deploy FAILED on exactly this |

### 2.3 The write-budget arithmetic, which does not change

`convSave()` writes **exactly 1**, and only on an **answered** turn. A proposal
is produced on an answered turn (she said something). A confirm press **is** an
answered turn and is already fused. So:

```
proposals + presses ⊂ answered turns ≤ GLOBAL_TURNS_PER_DAY (200)
new Durable Object rows attributable to the confirm lane   = 0
```

⚠️ **This is the whole reason the pending slot wins.** Any other store adds a
row per proposal against a ceiling that continuity §3.1 already proved out to
~2.5%. Reusing the slot means that paragraph needs no recomputation.

---

## 3. Expiry, and who may press

### 3.1 ⚠️ Recommended TTLs — and the honest note that they are not the safety

| Lane | TTL | Precedent / reasoning |
|---|---|---|
| `book_pick`, `instance_pick` | **15 min** (`PENDING_TTL_MS`) | unchanged, shipped |
| **T2 — data mutations** | **10 minutes** | A book's fields decay slowly, but a button describing an edit nobody remembers requesting is its own defect |
| **T3 — people and club ops** | **5 minutes** | A roster is people: somebody leaves, a manager changes, a claim lands. The shorter number is also the *ceremony being visible* — T3 should feel less patient than T2 |
| `moderation.ts` cleanup | **2 min** (`CONFIRM_TTL_MS`) | unchanged; a channel preview decays fastest of all |

⚠️ **The TTL is about human memory, not correctness — §4's compare-and-set is
the safety.** This matters because it is the trap the moderation lane could not
escape: a cleanup confirm *has* to be short, because the custom_id carries a
`count` and nothing can re-check what those 50 messages were. A T2 confirm
carries `before` values that **are** re-checkable, so a stale press is *refused*
rather than *obeyed*, and the TTL can be chosen for readability instead of fear.
Anybody later tempted to "just raise it to an hour" should raise it — and be
told by §4 that they did not thereby create a hazard, only an unreadable button.

**Expiry is stored ABSOLUTE (`expiresAt`), not derived from `at` + a constant.**
A constant that changes between the write and the read silently re-dates every
live proposal, and this record is explicitly designed to be read by a *second
implementation* (the panel) whose constant could differ.

### 3.2 ⚠️ Only the asker may press — how the binding actually works

**The binding is the conversation key, and it is not forgeable.** Discord's
Ed25519 signature on the interaction proves the payload came from Discord;
`member.user.id` (in a guild) or `user.id` (in a DM) is therefore a proven
identity; the key `(surface, space, person)` is **recomputed from it** rather
than read out of the `custom_id`. So:

> A stranger who lifts the nonce off a public menu resolves a **different**
> conversation record, which has no pending question with that nonce, and is
> answered `stale`.

This is continuity §5.2's argument, unchanged, and it survives the promotion
from "makes her say a sentence" to "makes her change a club" — because **the
destination still checks the presser's own role before anything happens.** A
successful forgery of the nonce buys the forger the right to make a change *they
were already allowed to make*.

### 3.3 ⚠️ So why is `moderation.ts`'s id MAC'd and this one not?

State this explicitly, because the asymmetry will otherwise read as an oversight
— and because the answer is a genuinely useful rule:

> **`moderation.ts` MACs its `custom_id` because it is STATELESS.** The confirm
> button lives in an ephemeral message with **no server-side record at all**; the
> `custom_id` *is* the state, so it must carry an expiry and a signature or
> anybody could type one. **The confirm lane is STATEFUL** — the proposal is on
> the server, keyed by the presser — so the nonce carries no authority and needs
> none. *A MAC is what you use when you have nowhere to put the state.*

⚠️ **The corollary is the rule for anybody adding a fourth lane:** if your button
carries its parameters in the `custom_id`, MAC it (with its own domain-separation
label — `moderation.ts` says *"a third use gets a third label"*). If your button
carries a nonce that indexes a per-person server record, do not.

### 3.4 The redundant check T3 adds anyway

`confirm_change` stores `askerId` and the press asserts it equals the resolved
presser. Under §3.2 this is **provably redundant** — the record was found *by*
that person's key. It is specified anyway, for T2 and T3 both:

- It costs one string comparison.
- It is the check that survives a refactor of key derivation. The key is built
  from `(surface, space, person)`; a future surface that keys by *space* alone
  (a shared panel session, say) would silently make every proposal
  press-able by anyone in the room, and **nothing else in the design would
  notice**.
- ⚠️ It is belt-and-braces, and is documented as such so nobody later "cleans up
  the duplicate check". A test asserts it by constructing exactly that broken
  key derivation.

### 3.5 Double-press, and why it is safe here

Two presses of the same button must not make two changes. **The Durable Object
serialises execution per object**, so a read-modify-write on the pending slot is
genuinely atomic — no lock, no transaction, no compare-and-swap loop needed.

⚠️ **Consume the nonce BEFORE calling the destination, not after.** The ordering
matters and it is the unsafe-looking choice that is correct: consume-then-call
can lose the outcome of an in-flight call (reported honestly as "I'm not sure
whether that landed — check the Changes panel"), while call-then-consume can
apply the change **twice**. *An uncertain report is recoverable; a double
mutation is not.* The same ordering is what makes the compare-and-set in §4 a
sufficient backstop: a second attempt finds `before` no longer matching and is
refused by the destination anyway.

---

## 4. ⚠️ THE HARD PART: the restatement must still be true

This section is the reason the confirm lane is not just "the instance menu with
one option".

### 4.1 The lesson, borrowed from a rule that reads correct and is not

The estate has already paid for this lesson once, in `firestore.rules`
(`audiobook_catalog`, 2026-08-17, caught by a **live smoke test** —
`scripts/smoke_audio_request_rules.py`):

> ⚠️ **EXACT LIST EQUALITY, not `hasAll([uid])`.** … the weaker form let A open a
> pile that already contained "somebody-else" — enrolling a person who never
> asked, and, worse, poisoning the pile so the real second requester's
> legitimate join was then REFUSED. **Written here as the incident that produced
> the rule, because "requesters must contain you" reads correct and is not.**

And its sibling, `audioRequestJoinsPile()`, whose two clauses are *a pair and
neither is redundant*: `hasAll(old)` forbids removing an existing requester,
`hasOnly(old + me)` forbids adding anyone but yourself. **Only one of them and
the other abuse walks straight through.**

**The generalisation, which is the T2 apply contract:**

> **Validate the WHOLE resulting state against the whole proposed state. Never
> validate that the change you meant is *among* the changes being made.**

### 4.2 The apply contract — compare-and-set on `before`

Every T2/T3 verb takes the proposal's `before` values **and the destination
refuses if they no longer match.**

```
POST /api/gabi/delegated/fix-field
{ "onBehalfOf": "<uid>",
  "subject": { "entity": "edition", "id": 4711 },
  "changes": [ { "field": "narrator", "before": "…", "after": "…" } ] }

→ 200  applied
→ 409  { "reason": "changed_underneath", "field": "narrator", "nowIs": "…" }
```

⚠️ **Three properties this buys, none of which a TTL can buy:**

1. **Somebody else's edit is never silently overwritten.** Between propose and
   press, a person on the website may have fixed the same field. Applying the
   proposal anyway would clobber a change the confirmer never saw and would
   write a `change_log` row whose `before` is a **lie** — the audit contract
   says `before/after` are `NOT NULL` and *"not recorded" is unrepresentable, on
   purpose*, so writing a wrong `before` is worse than writing none.
2. **The restatement is retroactively made honest.** She showed a human
   "narrator: X → Y". The compare-and-set is the only mechanism that makes that
   sentence *true at apply time* rather than *true when it was typed*.
3. **It is the exact-equality form, not the contains form.** The destination
   applies **precisely** `changes[]` — no field outside the list is touched, and
   the list is not a filter over a wider update. ⚠️ This is the default-deny
   posture the estate already applies to export surfaces (*allowed fields as an
   explicit array, never SELECT-*-minus-exclusions*), pointed at writes.

**The 409 is worded, never bare** (the no-bare-status rule): *"Someone changed
the narrator while we were talking — it now says «…», not what I showed you. I
haven't touched it. Want me to look again?"* ⚠️ **She re-proposes rather than
auto-retrying.** An auto-retry against fresh `before` values is a change nobody
read.

### 4.3 What `before` must be read from

⚠️ **The propose-time `dry-run`, not the model, and not the conversation.** The
application map §2c's rule holds without amendment: *the model chooses nothing.*
The model may parse "fix the narrator on Way of Kings, it's spelled wrong" into
a **candidate subject and field**; it never supplies the `before` value and never
supplies the `after` value as fact. `before` comes off the destination. `after`
comes from what the person literally typed, echoed back to them verbatim in the
restatement.

⚠️ **And the subject resolution must be settled BEFORE the confirm, not inside
it.** If the title matches more than one book, that is a `book_pick` — the
machinery that already exists — and the confirm is offered only once exactly one
book is on the table. **Never nest a disambiguation inside a confirm.** This is
§2d's finding in another costume: a title+author match has scored 1.0 on the
wrong book twice in this estate, so "which book" is a question that gets its own
turn.

---

## 5. The restatement — what it MUST contain, per verb class

**The core produces STRUCTURE; each surface renders it.** This is continuity
§1.1's surface-neutral/surface-specific split, extended to the confirm lane, and
it is the whole of the panel-v2 story: Discord bolds with `**`, a panel uses the
DOM, and a core that emits markdown has already picked a surface.

### 5.1 The four things every restatement carries, no exceptions

| # | Element | Why it is mandatory |
|---|---|---|
| 1 | **The subject, named the way a human names it** — title + author, or the club's name. Never a bare id | An id is not something anyone can check. The id travels in the payload; the *name* is what is being confirmed |
| 2 | **before → after, per field, both values shown** | Mirrors the audit contract's `before/after` exactly. A restatement showing only `after` asks somebody to approve a diff they cannot see |
| 3 | **The instance** — "on the main library" / "on your shelf" | T1 learned this the expensive way: *"a book on the wrong shelf is a tidy-up somebody has to notice first"* |
| 4 | ⚠️ **The authority being borrowed, in words** — *"I'll do this as you, using your contributor access on the main library"* | This is the sentence that makes the borrowed-authority model **visible to the person it belongs to**. GABI owning no permissions is the estate's central security claim, and a claim nobody is ever told is a claim nobody can catch being violated |

### 5.2 Per verb class, what else must appear

| Verb class | Additionally MUST state |
|---|---|
| **single-field fix** | nothing beyond §5.1 |
| **series / universe merge** | ⚠️ **the COUNT of affected books and the names of up to 5**, plus "and N others" — never a bare count, never an unbounded list. And **which name survives**, stated as the surviving one, because a merge is not symmetric |
| **cover swap** | the *source* of the new cover (which lookup, which URL host) and ⚠️ **that the old cover is replaced, and whether it is recoverable** — if it is not, that sentence is the whole confirm |
| **content-warning edit** | **whose note it is.** Editing your own and editing somebody else's are different acts with different capabilities (role map: others' notes are moderator+), and the restatement must not blur them |
| **photo intake (§2d)** | the **N books read off the photo**, each with title + author as read, and ⚠️ **that this creates a review queue, not catalogue rows** — the proposal-only property is the entire reason it is safe, so it is stated, not assumed |
| **T3 — club admin change** | the club, the **outgoing** admin and the **incoming** one, ⚠️ **both named**, and *"they'll be able to do X; you will no longer be able to Y"* if the asker is handing away their own standing |
| **T3 — club reset** | ⚠️ **exactly what is destroyed and what survives**, itemised. "Reset" is a word that means different things to the person saying it and the system doing it |
| **T3 — remove a member** | who, from which club, and **what happens to what they contributed** (their votes, their RSVPs, their notes) — the second half is the part people do not think to ask |

### 5.3 ⚠️ The rendering rule

```ts
// core — surface-neutral, pure, testable with no Discord and no DOM
interface Restatement {
  subject:   { label: string; instance: string };
  changes:   FieldChange[];
  authority: { capability: string; instanceLabel: string };
  extra:     RestatementNote[];   // the §5.2 rows, as structured notes
  tier:      2 | 3;
}
```

| Surface | Confirm | Cancel | Rendering |
|---|---|---|---|
| **Discord** | button, `custom_id` `gc\|ok\|<nonce>` (14 chars) | `gc\|no\|<nonce>` | an embed; before→after as fields; **T3 uses `style: 4` (danger)**, T2 `style: 1` (primary) |
| **Panel v2** | an authenticated `POST` carrying the nonce; identity from the Firebase session | same | an inline card in the transcript; the same four §5.1 elements, laid out |

The `gc|` prefix and its parser are **already built** (continuity §5.1) and gain
two verbs. ⚠️ **`ok`/`no`, not `confirm`/`cancel`** — nothing needs the extra
characters and the existing vocabulary is two-letter (`pick`, `more`).

⚠️ **A Cancel button is mandatory, on both surfaces.** Without it the only way to
decline is to say nothing, which is indistinguishable from not having seen it —
and it leaves the pending slot occupied until the TTL. Cancel clears the slot and
she says so.

⚠️ **The panel's press is NOT ephemeral and NOT a message edit** — continuity
§5.3's reasoning carries: *a conversation is a sequence of messages; type 5 adds
one*, and replacing the proposal with its outcome erases the restatement a reader
may want to check afterwards. On Discord the confirm is answered
`DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE` (type 5), public, then edited — ⚠️ with
the buttons on the **original** message disabled by a follow-up edit so it cannot
be pressed again by eye. (The nonce already refuses it; the disabled button is so
nobody tries.)

---

## 6. The verb list

### 6.1 T2 — mutating existing data

| Verb | Destination capability | Borrowed from which button | Notes |
|---|---|---|---|
| `fix-field` | `editCatalog` | the edit form's **Save** | one entity, one or more fields, compare-and-set |
| `merge-series` | `editCatalog` | the series registry's merge | ⚠️ §6.2 cap |
| `merge-universe` | `editCatalog` | same | universe tier is the cross-format join (index-worker design) — a bad merge is visible in three catalogs |
| `swap-cover` | `editCatalog` | the cover picker | ⚠️ recoverability stated in the restatement |
| `edit-warning` (own) | any live signed-in session | the note's own edit control | role map: your own notes are rung-irrelevant |
| `edit-warning` (others') | `moderator` floor | the moderation control | ⚠️ a **different verb-instance with a different restatement**, never the same one with a flag |
| `add-photo` | `scanPhoto` (moderator+, **bills the vision API**) | the scan review screen | ⚠️ **proposal-only** — §2d. Produces a scan job in `review`. It is a T2 citizen *because* the confirm is the thing that makes it honest |

### 6.2 ⚠️ The merge cap

A series merge naming 300 books produces a restatement nobody reads, and a
restatement nobody reads is a confirm button that means nothing. **Cap the
confirmable merge at a size a person can check — recommend 25 books — and refuse
above it in words**, pointing at the site's own merge screen. This is
`CLEANUP_MAX`'s reasoning transplanted: *fifty is deliberately well under
Discord's ceiling … nothing about tidying is urgent enough to justify the bigger
number.*

### 6.3 T3 — people and club operations

The club island (role map ⁴): a club's bound managers hold these for **their own
club** at any rung; site moderator+ overrides everywhere; **the island never
out-ranks the ladder.**

| Verb | Destination capability | Notes |
|---|---|---|
| `club-admin-change` | club-manage on that club, or site `moderator`+ | ⚠️ §6.4 |
| `club-reset` | same | itemised restatement (§5.2) |
| `club-remove-member` | same | |
| `club-webhook-set/clear` | same | ⚠️ **recommend NOT in phase 1** — a webhook URL is a secret-shaped string and pasting one into a channel is a leak the confirm lane cannot undo |

### 6.4 ⚠️ Two things that look like T3 and are NOT

1. **Deleting a club is not a T3 verb.** The role map's footnote ⁷ is explicit:
   *"Never island-held, never lowered … destruction stays high"* — admin/owner
   only. A verb whose ceremony is "restate it carefully" cannot be the front door
   to the estate's designated never-lowered operation. **It is T4 from chat.**
2. **Handing somebody your own club admin is an access-INCREASING act.** The
   global rule — *act on access-reducing orders immediately; confirm
   access-increasing ones* — means `club-admin-change` gets the full ceremony
   even when the asker is giving something away, and ⚠️ **the incoming admin is
   told**, by ping, that they now hold it. Granting quietly is how somebody ends
   up holding something nobody meant them to have.

### 6.5 ⚠️ T2/T3 are LIBRARY-INSTANCES-ONLY in phase 1 — an audit finding

`edit-audit-design.md` §4.2/§4.3: the library catalogs have `change_log`
(migration 0120, in production since 2026-08-13). **The audiobook surface has no
audit table at all** — its audit log is *git history over the overrides file*,
written by a validating CLI on one machine that *demands a per-field reason*.

⚠️ **There is no way for a delegated Worker verb to write that audit log.** A
mutation on the audiobook surface driven from Discord would be a change with no
`who`, no `before`, and no commit — a hole in a contract that says *"an audit log
something can edit is not an audit log"*. So: **T2/T3 verbs target the library
instances only until the audiobook surface has a real audit seam.** §4.4's answer
is already written down (apply the 0120 DDL as its own migration), and that is a
prerequisite, not a side effect.

### 6.6 The T4 wall, restated because T3 sits against it

Estate grants and revokes, deploys and promotes, secrets, moderation config,
anything money, **and club deletion** (§6.4). ⚠️ **The refusal is worded and
names the real door** — never "I can't do that". A T4 refusal that does not say
*where the thing is actually done* is a bare status in a full sentence.

---

## 7. The audit trail

### 7.1 The `change_log` idiom, per destination

| Destination | Row shape |
|---|---|
| **library instances** | one row **per field** (edit-audit §4.1 *"what"*), `changed_by = <the asker's app_user id>`, `batch_id` = one press = one event, `before`/`after` both JSON-encoded and NOT NULL, `note = 'gabi-discord-confirm'` |
| **audiobook surface** | ⚠️ nothing — see §6.5. This is why it is out of scope |

`note LIKE 'gabi-discord%'` therefore answers *"what has GABI changed"* across
T1 and T2 in one query, and the `-confirm` suffix separates the two lanes without
a new column — the same trick T1 used.

### 7.2 ⚠️ `changed_how` is `'human'`, and this is a decision worth arguing

T1's writes are stamped `'auto'`. **T2/T3 confirms should be stamped `'human'`.**

The `how` axis exists so that *"a machine write is distinguishable from a
person's forever"*, and the question it really answers is **"did anybody look at
this?"**:

- T1's `add-isbn` is `'auto'` **correctly** — nobody reviewed the ISBN→edition
  resolution; a checksum did.
- A T2 confirm is a person who read a before→after restatement and pressed a
  button. That is the most reviewed write in the estate. Calling it `'auto'`
  would make the review invisible in the one column built to record it.

⚠️ **Stated as a decision, not a fact, because it is reversible and the owner may
disagree** — the counter-argument is that `'auto'` should mean "a machine's
hands", in which case every GABI write is `'auto'` and the `note` carries the
distinction. Recommend `'human'`; ⚠️ **whichever is chosen, a test must pin it**,
because a stamp that drifts makes every historical row ambiguous and there is no
migration that can recover the answer.

### 7.3 The report, after the fact

She reports **what the destination said happened**, not what she asked for. ⚠️
The difference is the whole lesson of the silent-partial incident already in the
repo's record: a verb that applied 3 of 4 fields must say *"3 of the 4 — the
fourth came back «…»"*. **A success sentence that is a paraphrase of the request
is not a report.** The report carries the deep link to the entity's own **Changes**
panel — the estate's review-link rule, and the undo path in one.

---

## 8. Refusal wording set

Extending `DELEGATE_MSG`. ⚠️ Every one names *what happened, what it needs, and
how to get it*, and every one says **whether anything was changed** — because
after a confirm press, "did that land?" is the only question the person has.

| Key | When | Must say |
|---|---|---|
| `confirmStale` | the nonce resolves nothing | ⚠️ **both causes in one sentence** ("that button was for whoever asked, or it has aged out") — the presser cannot distinguish them either, and picking one is a guess presented as a fact. **Nothing was changed** |
| `confirmExpired` | found, past `expiresAt` | it aged out, nothing changed, ask again and she'll offer it fresh |
| `changedUnderneath` | the 409 (§4.2) | ⚠️ **what it says now**, that she has not touched it, and an offer to look again. Never an auto-retry |
| `alreadyApplied` | the slot was consumed | *"that one's already done"* + the Changes link. ⚠️ Never silence, which reads as a broken button |
| `capabilityRefused` | destination's press-time refusal | ⚠️ **relayed verbatim** — the four causes stay distinct (no account here · estate-revoked · awaiting approval · role too low) |
| `capabilityLost` | ⚠️ propose said yes, press said no | said **as a change**, not as a flat refusal: *"you could do this when I offered it and can't now — nothing was changed. That usually means your access was updated in the last few minutes"* |
| `t4Wall` | a T4 verb | ⚠️ **names where it IS done** |
| `mergeTooLarge` | §6.2 | the count, the cap, and the link to the site's merge screen |
| `writeCapped` | the write fuse | existing wording; ⚠️ **must fire at PROPOSE**, not at press — offering a button that will refuse is worse than refusing early |
| `confirmReplaced` | a second proposal displaces the first | ⚠️ she says the first was dropped (§2.1 cost 1) |
| `applyUncertain` | consume-then-call lost the outcome (§3.5) | ⚠️ **honest uncertainty**: *"I'm not certain that landed"* + the Changes link. Never guessed either way |
| `cancelled` | Cancel pressed | nothing was changed, and she is still available |

⚠️ **`applyUncertain` is the one to resist deleting.** It will fire rarely, it
looks like a failure of the design, and it is the sentence that keeps an
uncertain outcome from being reported as a certain one. *Silent failure must be
distinguishable from success.*

---

## 9. Caps

| Fuse | Value | Change |
|---|---|---|
| turn fuse | 20/person/rolling hour, 200/day estate-wide | **unchanged**; presses count, as they already do |
| write fuse (`wcap:`) | 20/person/UTC day | ⚠️ **a T2/T3 apply counts as a write; a PROPOSE does not.** A proposal writes nothing anywhere |
| `scanPhoto` spend | destination's own | unchanged — the spending capability is the line to move |

⚠️ **Check the write fuse at PROPOSE and again at PRESS.** At propose so she does
not offer a button that will refuse (§8 `writeCapped`); at press because the fuse
is what it is *for*, and a proposal held for nine minutes can outlive the budget
that allowed it. **Only the press decrements.**

---

## 10. Build phases

Effort classes use the estate's measured calibration (research ≈100 k, focused
build ≈150 k, single subsystem ≈280 k, multi-layer ≈470 k). ⚠️ **Every phase ends
at a committable boundary**, so a killed agent costs nothing beyond the phase in
flight.

| Phase | What | Layers | Effort | Depends on |
|---|---|---|---|---|
| **1** | **The grammar, with ONE verb.** `confirm_change` kind + `expiresAt` + the `gc\|ok\|no` vocabulary + `Restatement` structure + Discord rendering + the refusal set + `fix-field` end-to-end with **compare-and-set and the 409** | bot + 1 library worker | **medium** (~200 k) | nothing |
| **2** | **The rest of T2 on the library instances**: `merge-series`, `merge-universe`, `swap-cover`, `edit-warning` ×2, the §6.2 cap | bot + library worker | **medium** (~200 k) | 1 |
| **3** | **`add-photo` as a T2 citizen** — §2d's recommended shape, proposal-only, `scanPhoto`-gated | bot + library worker | **small–medium** (~150 k) | 1; ⚠️ §11 Q4's two unverified Discord facts |
| **4** | **T3.** The three club verbs, the 5-minute TTL, danger styling, the §6.4 exclusions, the incoming-admin ping | bot + library worker | **medium** (~200 k) | 1 |
| **5** | **Panel-v2 rendering.** The panel adopts `PendingChoice` and renders `Restatement`; the press is an authenticated POST | 1 site | **medium** (~200 k) | 1; the panel-v2 store adoption |
| **6** *(prerequisite, not optional, if audiobook T2 is ever wanted)* | **The audiobook audit seam** — apply the 0120 DDL as its own migration | 1 worker + migration | **medium** | §6.5 |

⚠️ **Phase 1 is deliberately one verb.** The grammar is the risky part and
`fix-field` is the smallest thing that exercises all of it — a subject, a
before→after, a borrowed capability, a compare-and-set, an audit row and a
report. Building three verbs before the grammar is proven means fixing the
grammar in three places.

---

## 11. Open questions for the owner

1. **`changed_how`: `'human'` or `'auto'` for confirmed writes?** (§7.2 —
   recommend `'human'`; whichever, it must be test-pinned, and it cannot be
   recovered later by migration.)
2. **Are the recommended TTLs right — T2 10 min, T3 5 min?** (§3.1. Safety does
   not depend on them; readability does.)
3. **Is the 25-book merge cap the right number?** (§6.2.)
4. **Should `club-webhook-set/clear` be a T3 verb at all?** (§6.3 — recommend
   no: a webhook URL is secret-shaped and a channel is not a safe place to
   paste one.)
5. **Does T2 on the audiobook surface matter enough to fund its audit seam?**
   (§6.5 / phase 6.)

---

## 12. ⚠️ NOT VERIFIED

- **Nothing in this document is built.** Every claim about how it will behave is
  a design, not an observation.
- **The T1 machinery it extends has itself never met a real Discord message.**
  The application map and continuity §8 both record this: no real mention, DM,
  reply or button press has ever been handled; `GABI_MENTIONS` has shipped off.
  ⚠️ **The confirm lane inherits every one of those unverified claims** and adds
  no measurement of its own.
- **No destination `dry-run` endpoint exists.** §1.1 assumes one can be added to
  each delegated verb; the library workers' route shape was **not** read for
  this design.
- **The 409 / compare-and-set contract is not implemented anywhere.** Whether
  the library's edit path can cheaply compare pre-values was **not** checked
  against `library_catalog`'s source.
- **The claim that a Durable Object serialises execution per object** (§3.5) is
  read from the platform's documented model, not measured here.
- **`change_log` row counts and shapes** are read from `edit-audit-design.md`,
  not from a live database.
- **Whether the panel's store can hold `PendingChoice`** is asserted from
  continuity §1.3's table, not from panel-v2's (in-flight) code.
- ✅ **`packages/gabi-conversation/` IS landed** — re-checked after it committed
  as `98e5991`, and `PendingChoice` was read at
  `packages/gabi-conversation/src/index.ts:181`. §2 states this as measured
  rather than assumed. ⚠️ What was **not** read: the package's tests, and
  whether `library_catalog`'s cross-repo sync
  (`scripts/sync-gabi-conversation.mjs`, named in the package description) has
  actually run — so *"the panel imports the same type"* is a claim about the
  package's intent, not an observed import.
- **The role/capability names** are taken from `role-capability-map.md`
  (compiled 2026-08-17 from source). The exact capability constant for club
  operations was **not** re-read from `capabilities.ts` for this doc.
