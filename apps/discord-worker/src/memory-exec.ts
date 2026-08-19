/**
 * ⚠️ **THE FOURTH — AND ONLY OTHER — MODULE IN GABI'S CONVERSATIONAL PATH THAT
 * TOUCHES A CREDENTIAL.** That is this file's whole reason for existing as a
 * file, exactly as it is `delegated-exec.ts`'s, `estate-docs-exec.ts`'s and
 * `book-knowledge-exec.ts`'s.
 *
 * The property those three established, widened once more **on purpose** and
 * with the test widened alongside it rather than deleted:
 *
 * > **Credentials appear ONLY in `delegated-exec.ts`, `estate-docs-exec.ts`,
 * > `book-knowledge-exec.ts` and `memory-exec.ts`.** Everything else in the chat
 * > path reaches every gated store through INJECTED ports it cannot construct.
 *
 * ⚠️ Widening a mechanical guard is a decision somebody makes on purpose and
 * writes down. Four modules, each one trust edge, each named in a test — never
 * "credentials are allowed in the chat path now".
 *
 * ## ⚠️ WHY THIS ONE NEEDS NO NEW SECRET, AND THAT IS THE POINT
 *
 * It uses `FIREBASE_SERVICE_ACCOUNT`, which this Worker **already holds** for
 * reading `discord_links/{id}`, at the same `datastore` scope. Design §4.1: the
 * decisive argument for Firestore over D1 was that it is the only store BOTH
 * GABI surfaces already reach, and the second was that **no new trust edge, no
 * new secret and no new holder** is created. A profile store that needed a
 * fourth app token would have been a materially more expensive feature.
 *
 * ## What it stores, and what it must never store
 *
 * `gabi_profiles/{personKey}` — a ≤2 KB note about ONE person, built only from
 * that person's own conversations. ⚠️ It holds no retrieved book text (book
 * design §8 forbids writing passages even to the ephemeral window; a profile is
 * a more durable version of that window) and no claim about what GABI has read.
 */

import {
  firestoreRequest,
  mintAccessToken,
  parseServiceAccount,
  type ServiceAccount,
} from './firebase-sa.js';
import {
  archiveDocId,
  archiveRand,
  ARCHIVE_DELETE_BATCH,
  ARCHIVE_DELETE_PAGES,
  ARCHIVE_READ_MS,
  ARCHIVE_SHAPE_VERSION,
  ARCHIVE_TURN_CHARS,
  ARCHIVE_WRITE_MS,
  expiresAtFor,
  rankRecall,
  RECALL_HITS,
  RECALL_MSG,
  RECALL_SCAN_ROWS,
  type ArchivePort,
  type ArchiveTurn,
} from './archive.js';
import type { Env } from './env.js';
import {
  capProfile,
  parseProfile,
  PROFILE_SHAPE_VERSION,
  type MemoryPort,
  type MemoryProfile,
} from './memory.js';

/** ⚠️ Its own collection. Not a field on `discord_links` — that document is the
 *  identity join and is read on the hot path of every gated call; growing it
 *  with prose would make every book question pay for a profile it did not ask
 *  for. Separate concerns, separate documents. */
export const PROFILE_COLLECTION = 'gabi_profiles';

/** Firestore rejects `/` and a few others in a document id; a person key is
 *  `estate:<email>` or `discord:<snowflake>`, so the colon is fine and the email
 *  is the only thing that could carry a slash. Encoded rather than trusted. */
function docPath(person: string): string {
  return `${PROFILE_COLLECTION}/${encodeURIComponent(person)}`;
}

type FsValue = { stringValue?: unknown; integerValue?: unknown };
type FsDoc = { fields?: Record<string, FsValue> };

/**
 * ⚠️ **THE WHOLE PROFILE IS ONE JSON STRING FIELD, DELIBERATELY.**
 *
 * Firestore's typed-value encoding for nested arrays of maps is verbose and
 * fiddly, and every field we mapped individually would be a second place the
 * schema lives — one that could drift from `memory.ts`'s caps without failing
 * anything. One `json` string field means `parseProfile` is the ONLY validator,
 * on read and on write, and a shape change is one function.
 *
 * ⚠️ The cost of that choice, stated: Firestore cannot query INSIDE the profile.
 * Nothing needs to — profiles are fetched by person key and never searched.
 */
function toFirestore(profile: MemoryProfile): unknown {
  return {
    fields: {
      json: { stringValue: JSON.stringify(profile) },
      v: { integerValue: String(PROFILE_SHAPE_VERSION) },
      updatedAt: { integerValue: String(profile.updatedAt) },
    },
  };
}

function fromFirestore(doc: FsDoc, person: string): MemoryProfile | null {
  const raw = doc.fields?.json?.stringValue;
  if (typeof raw !== 'string') return null;
  return parseProfile(raw, person);
}

/**
 * Build the port the conversational path is handed.
 *
 * ⚠️ Returns `null` when the service account is absent — the ships-dark state,
 * expressed the same way the other three ports express it. A null port means no
 * profile is loaded, no prompt block is added, and nothing is written; every
 * other answer is untouched.
 */
export function makeMemoryPort(env: Env): MemoryPort | null {
  const rawSa = env.FIREBASE_SERVICE_ACCOUNT;
  if (!rawSa) return null;

  /** ⚠️ Minted per operation rather than held. A port outlives a single turn
   *  here (the cron's sweep uses one across several conversations), and a cached
   *  OAuth token that outlived a secret rotation would fail every write with no
   *  obvious cause. */
  async function auth(): Promise<{ sa: ReturnType<typeof parseServiceAccount>; token: string } | null> {
    const sa = parseServiceAccount(rawSa);
    if (!sa) {
      // ⚠️ Unparseable JSON is a CONFIGURATION fault, and it must be loud: every
      // profile read and write fails silently otherwise, which looks exactly
      // like "she just doesn't remember".
      console.error('GABI memory: FIREBASE_SERVICE_ACCOUNT is not parseable JSON.');
      return null;
    }
    return { sa, token: await mintAccessToken(sa) };
  }

  return {
    async load(person) {
      try {
        const a = await auth();
        if (!a?.sa) return null;
        const res = await firestoreRequest(a.sa, a.token, 'GET', docPath(person));
        // 404 is the ORDINARY answer for somebody she has never noted anything
        // about. Not an outage, and never logged as one.
        if (res.status === 404) return null;
        if (!res.ok) {
          console.error(`GABI memory: profile read failed (HTTP ${res.status}).`);
          return null;
        }
        return fromFirestore((await res.json()) as FsDoc, person);
      } catch (err) {
        console.error('GABI memory: profile read threw:', err instanceof Error ? err.message : err);
        return null;
      }
    },

    async save(profile) {
      try {
        const a = await auth();
        if (!a?.sa) return false;
        // ⚠️ Capped again HERE, on the way out. `memory.ts` caps at the point of
        // distillation, and this is the last gate before something durable — a
        // second application costs nothing and closes the path where a future
        // caller writes an uncapped profile it built itself.
        const safe = capProfile(profile);
        const res = await firestoreRequest(
          a.sa,
          a.token,
          'PATCH',
          docPath(safe.person),
          toFirestore(safe),
        );
        if (!res.ok) console.error(`GABI memory: profile write failed (HTTP ${res.status}).`);
        return res.ok;
      } catch (err) {
        console.error('GABI memory: profile write threw:', err instanceof Error ? err.message : err);
        return false;
      }
    },

    async clear(person) {
      try {
        const a = await auth();
        if (!a?.sa) return false;
        // ⚠️ A REAL DELETE. "Forget it" that leaves a tombstone is not forgetting,
        // and a person who asked to be forgotten is owed the row being gone.
        const res = await firestoreRequest(a.sa, a.token, 'DELETE', docPath(person));
        // 404 means there was nothing there — which is the state they asked for.
        const ok = res.ok || res.status === 404;
        if (!ok) console.error(`GABI memory: profile delete failed (HTTP ${res.status}).`);
        return ok;
      } catch (err) {
        console.error('GABI memory: profile delete threw:', err instanceof Error ? err.message : err);
        return false;
      }
    },
  };
}

/** Re-exported for the composition roots, so neither has to import two files. */
export type { MemoryPort };

// ---------------------------------------------------------------------------
// ⚠️ TIER 3 + 4 — THE ARCHIVE AND RECALL, IN THIS FILE ON PURPOSE
// ---------------------------------------------------------------------------

/**
 * ⚠️ **WHY THIS IS NOT A SIXTH `*-exec.ts` MODULE — a decision, not laziness.**
 *
 * The estate's mechanical guard says credentials appear in exactly FIVE modules,
 * each named in a test, each widened on purpose and in writing. Tier 3 needs
 * **no new credential, no new scope and no new store** — the same
 * `FIREBASE_SERVICE_ACCOUNT`, the same `datastore` scope and the same Firestore
 * project as the profile above, differing only in collection name.
 *
 * A sixth file would widen a guard whose whole value is being narrow, to hold
 * code that adds no trust edge. So the archive lives beside the profile: **five
 * modules, unchanged**, and `test/archive.test.ts` re-asserts the count.
 */
export const ARCHIVE_COLLECTION = 'gabi_conversations';

type FsWriteValue = { stringValue: string } | { integerValue: string } | { timestampValue: string };

/**
 * ⚠️ **`expiresAt` IS A REAL `timestampValue`, NOT A NUMBER**, and that is the
 * whole reason retention can be server-side. A Firestore TTL policy only accepts
 * a timestamp field; an integer of the same instant is invisible to it, and the
 * documents would accumulate for ever while this file claimed they expired.
 * `at` stays an integer beside it because that is what recall sorts and filters
 * on.
 */
function turnToFirestore(turn: ArchiveTurn): { fields: Record<string, FsWriteValue> } {
  return {
    fields: {
      v: { integerValue: String(ARCHIVE_SHAPE_VERSION) },
      person: { stringValue: turn.person },
      surface: { stringValue: turn.surface },
      space: { stringValue: turn.space },
      role: { stringValue: turn.role },
      text: { stringValue: turn.text.slice(0, ARCHIVE_TURN_CHARS) },
      at: { integerValue: String(turn.at) },
      expiresAt: { timestampValue: new Date(expiresAtFor(turn.at)).toISOString() },
    },
  };
}

function turnFromFirestore(doc: FsDoc): ArchiveTurn | null {
  const f = doc.fields ?? {};
  const s = (k: string): string =>
    typeof f[k]?.stringValue === 'string' ? (f[k]?.stringValue as string) : '';
  const at = Number(f['at']?.integerValue ?? 0);
  const role = s('role');
  const text = s('text');
  const person = s('person');
  if (!person || !text || (role !== 'user' && role !== 'assistant') || !Number.isFinite(at)) {
    return null;
  }
  return { person, surface: s('surface'), space: s('space'), role, text, at };
}

/**
 * The archive port. ⚠️ `null` with no service account — the ships-dark state,
 * expressed exactly as the other five ports express it.
 */
export function makeArchivePort(env: Env): ArchivePort | null {
  const rawSa = env.FIREBASE_SERVICE_ACCOUNT;
  if (!rawSa) return null;

  async function auth(): Promise<{ sa: ServiceAccount; token: string } | null> {
    const sa = parseServiceAccount(rawSa);
    if (!sa) {
      console.error('GABI archive: FIREBASE_SERVICE_ACCOUNT is not parseable JSON.');
      return null;
    }
    return { sa, token: await mintAccessToken(sa) };
  }

  const base = (sa: ServiceAccount): string =>
    `https://firestore.googleapis.com/v1/projects/${sa.project_id}/databases/(default)`;

  return {
    /**
     * ⚠️ **ONE `:commit` FOR THE WHOLE TURN, NOT A REQUEST PER DOCUMENT.**
     *
     * A turn is two documents (theirs and hers). Two writes would be two
     * subrequests on the bookkeeping path of every answered turn and — worse —
     * could half-succeed, leaving a question in the archive with no answer beside
     * it. A commit is atomic, so recall can never surface half a conversation.
     *
     * ⚠️ **NEVER THROWS.** A failed archive write must not turn a delivered
     * answer into an error message: the caller is inside the bookkeeping block
     * that the 2026-08-18 rule says must not speak.
     */
    async write(turns) {
      if (turns.length === 0) return true;
      try {
        const a = await auth();
        if (!a?.sa) return false;
        const writes = turns.map((t) => ({
          update: {
            name:
              `projects/${a.sa.project_id}/databases/(default)/documents/` +
              `${ARCHIVE_COLLECTION}/${archiveDocId(t.at, archiveRand())}`,
            ...turnToFirestore(t),
          },
        }));
        const res = await fetch(`${base(a.sa)}/documents:commit`, {
          method: 'POST',
          headers: { authorization: `Bearer ${a.token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ writes }),
          signal: AbortSignal.timeout(ARCHIVE_WRITE_MS),
        });
        if (!res.ok) console.error(`GABI archive: write failed (HTTP ${res.status}).`);
        return res.ok;
      } catch (err) {
        console.error('GABI archive: write threw:', err instanceof Error ? err.message : err);
        return false;
      }
    },

    /**
     * ⚠️ **THE PRIVACY IS THIS `where` CLAUSE AND NOTHING ELSE** (design §4.4).
     * `person` is built by the CALLER from the asker's own identity, server-side.
     * No tool parameter could carry somebody else's, so *"search Sam's
     * conversations"* is not refused — it is unrepresentable.
     *
     * ⚠️ **`orderBy __name__` RATHER THAN `orderBy at`, and that is what avoids a
     * composite index.** The document id carries a descending timestamp prefix
     * (`archive.ts`), so name-ascending IS newest-first, and equality +
     * `__name__` is served by Firestore's automatic single-field index.
     * `orderBy at` would need an index somebody creates in a console — and until
     * they did, every recall would 400 while the feature looked built.
     */
    async recall(input) {
      const scan = Math.min(input.scan ?? RECALL_SCAN_ROWS, RECALL_SCAN_ROWS);
      try {
        const a = await auth();
        if (!a?.sa) return { ok: false, message: RECALL_MSG.notConfigured };
        const res = await fetch(`${base(a.sa)}/documents:runQuery`, {
          method: 'POST',
          headers: { authorization: `Bearer ${a.token}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            structuredQuery: {
              from: [{ collectionId: ARCHIVE_COLLECTION }],
              where: {
                fieldFilter: {
                  field: { fieldPath: 'person' },
                  op: 'EQUAL',
                  value: { stringValue: input.person },
                },
              },
              orderBy: [{ field: { fieldPath: '__name__' }, direction: 'ASCENDING' }],
              limit: scan,
            },
          }),
          signal: AbortSignal.timeout(ARCHIVE_READ_MS),
        });
        if (!res.ok) {
          console.error(`GABI archive: recall failed (HTTP ${res.status}).`);
          return { ok: false, message: RECALL_MSG.unreachable };
        }
        const body = (await res.json()) as { document?: FsDoc }[];
        const rows = (Array.isArray(body) ? body : [])
          .map((r) => (r.document ? turnFromFirestore(r.document) : null))
          .filter((t): t is ArchiveTurn => t !== null);

        // ⚠️ `since` is applied HERE rather than as a Firestore range filter,
        // because a range on `at` beside the equality on `person` is exactly the
        // composite index this design refuses to need. `reachedBack` keeps that
        // honest: the answer says how far the scan actually got.
        const windowed = input.since ? rows.filter((r) => r.at >= (input.since as number)) : rows;
        const reachedBack = rows.length > 0 ? Math.min(...rows.map((r) => r.at)) : null;
        return {
          ok: true,
          hits: rankRecall(windowed, input.terms, input.limit ?? RECALL_HITS),
          scanned: rows.length,
          reachedBack,
          // ⚠️ A FULL PAGE MEANS OLDER TURNS EXIST UNEXAMINED. Without this an
          // empty result reads as "nothing was ever said about that" when it
          // means "nothing in the most recent 200 turns" — a false negative
          // wearing a fact's clothes.
          truncated: rows.length >= scan,
        };
      } catch (err) {
        console.error('GABI archive: recall threw:', err instanceof Error ? err.message : err);
        return { ok: false, message: RECALL_MSG.unreachable };
      }
    },

    /**
     * ⚠️ **A REAL DELETE, BOUNDED PER CALL.**
     *
     * Firestore has no delete-by-query: ids are read, then deleted. So this pages
     * — scan a batch of the person's own rows, commit the deletes, repeat — and
     * **reports how many went and whether more remain**, because a privacy
     * control that silently stops halfway is the worst lie this feature could
     * tell. The caller says so in words.
     */
    async forget(person) {
      let deleted = 0;
      try {
        const a = await auth();
        if (!a?.sa) return { ok: false, deleted: 0, more: true };
        for (let page = 0; page < ARCHIVE_DELETE_PAGES; page += 1) {
          const res = await fetch(`${base(a.sa)}/documents:runQuery`, {
            method: 'POST',
            headers: { authorization: `Bearer ${a.token}`, 'content-type': 'application/json' },
            body: JSON.stringify({
              structuredQuery: {
                from: [{ collectionId: ARCHIVE_COLLECTION }],
                where: {
                  fieldFilter: {
                    field: { fieldPath: 'person' },
                    op: 'EQUAL',
                    value: { stringValue: person },
                  },
                },
                // ⚠️ Ids only. Reading the TEXT back in order to delete it would
                // pull a person's whole history through this Worker for no reason.
                select: { fields: [{ fieldPath: '__name__' }] },
                limit: ARCHIVE_DELETE_BATCH,
              },
            }),
            signal: AbortSignal.timeout(ARCHIVE_READ_MS),
          });
          if (!res.ok) {
            console.error(`GABI archive: delete-scan failed (HTTP ${res.status}).`);
            return { ok: false, deleted, more: true };
          }
          const body = (await res.json()) as { document?: { name?: unknown } }[];
          const names = (Array.isArray(body) ? body : [])
            .map((r) => r.document?.name)
            .filter((n): n is string => typeof n === 'string');
          if (names.length === 0) return { ok: true, deleted, more: false };

          const del = await fetch(`${base(a.sa)}/documents:commit`, {
            method: 'POST',
            headers: { authorization: `Bearer ${a.token}`, 'content-type': 'application/json' },
            body: JSON.stringify({ writes: names.map((name) => ({ delete: name })) }),
            signal: AbortSignal.timeout(ARCHIVE_WRITE_MS),
          });
          if (!del.ok) {
            console.error(`GABI archive: delete failed (HTTP ${del.status}).`);
            return { ok: false, deleted, more: true };
          }
          deleted += names.length;
          if (names.length < ARCHIVE_DELETE_BATCH) return { ok: true, deleted, more: false };
        }
        // ⚠️ Out of pages with rows still there. SAID, never rounded up to
        // "done" — somebody who asked to be forgotten is owed the truth about
        // how much of them is actually gone.
        return { ok: true, deleted, more: true };
      } catch (err) {
        console.error('GABI archive: delete threw:', err instanceof Error ? err.message : err);
        return { ok: false, deleted, more: true };
      }
    },
  };
}

export type { ArchivePort };
