/**
 * ⚠️ **THE FIFTH MODULE IN GABI'S CONVERSATIONAL PATH THAT TOUCHES A
 * CREDENTIAL** — `delegated-exec.ts`, `estate-docs-exec.ts`,
 * `book-knowledge-exec.ts`, `memory-exec.ts`, and now this.
 *
 * ⚠️ Widening a mechanical guard is a decision somebody makes on purpose and
 * writes down. Five modules, each one trust edge, each named in a test — never
 * "credentials are allowed in the chat path now".
 *
 * ## ⚠️ WHY THIS READS FIRESTORE DIRECTLY, WHERE THE DESIGN SAID "ROUTES"
 *
 * As-built deviation from `gabi-personal-shelf-design.md` §5, taken deliberately:
 *
 * The design assumed the shelf would be reached through gated routes on the
 * estate Workers, copying the book-text pattern. But **both audiobook stores are
 * Firestore collections this Worker already reaches** with the service account
 * it already holds for `discord_links`. Building routes would have meant a new
 * app token, a new trust edge, a new holder and a second copy of the identity
 * join — all to reach data one `firestoreRequest` away.
 *
 * What makes that safe is not the transport, it is **who the query is built for**:
 * every query below is constructed from the asker's OWN uid or display name,
 * read server-side from the link document. There is no parameter a model could
 * supply that would widen it. The gate is the query, and the query is here.
 *
 * ⚠️ The one thing this does NOT reach is the LIBRARY's D1 TBR and read state —
 * that lives in another Worker in another repo and genuinely does need a route.
 * It is not built; `myTbr` returns the audiobook shelf and labels it, which is
 * why every row carries `shelf`.
 */

import { firestoreRequest, mintAccessToken, parseServiceAccount } from './firebase-sa.js';
import type { Env } from './env.js';
import {
  SHELF_MSG,
  SHELF_REVIEW_ROWS,
  SHELF_TBR_ROWS,
  type ShelfAsker,
  type ShelfCallResult,
  type ShelfIdentityFailure,
  type ShelfPort,
  type ReviewRow,
  type TbrRow,
} from './shelf.js';

/** ⚠️ Lane-suffixed on the sites (`reviews_dev`). This Worker is the production
 *  surface only; a dev lane would need its own binding and does not have one. */
export const REVIEWS_COLLECTION = 'reviews';
export const READING_LISTS_COLLECTION = 'readingLists';

type FsValue = {
  stringValue?: unknown;
  integerValue?: unknown;
  doubleValue?: unknown;
  timestampValue?: unknown;
};
type FsFields = Record<string, FsValue>;
type FsDoc = { name?: string; fields?: FsFields };

const str = (v: FsValue | undefined): string =>
  typeof v?.stringValue === 'string' ? v.stringValue : '';
const num = (v: FsValue | undefined): number | undefined => {
  if (typeof v?.doubleValue === 'number') return v.doubleValue;
  if (typeof v?.integerValue === 'string') return Number(v.integerValue);
  if (typeof v?.integerValue === 'number') return v.integerValue;
  return undefined;
};
const ts = (v: FsValue | undefined): string | undefined =>
  typeof v?.timestampValue === 'string' ? v.timestampValue : undefined;

export function makeShelfPort(env: Env): ShelfPort | null {
  const rawSa = env.FIREBASE_SERVICE_ACCOUNT;
  if (!rawSa) return null;

  /** ⚠️ Memoised for the life of this port, which is one message — the same
   *  reasoning `book-knowledge-exec.ts` gives. A turn asking for a TBR and then
   *  reviews reads the link document once. */
  let cached: { ok: true; asker: ShelfAsker } | { ok: false; reason: ShelfIdentityFailure } | null =
    null;

  async function auth() {
    const sa = parseServiceAccount(rawSa);
    if (!sa) {
      console.error('GABI shelf: FIREBASE_SERVICE_ACCOUNT is not parseable JSON.');
      return null;
    }
    return { sa, token: await mintAccessToken(sa) };
  }

  /**
   * ⚠️ **`runQuery` is issued HERE rather than through `firestoreRequest`**,
   * because that helper joins its path with a `/` and Firestore's method syntax
   * is `documents:runQuery` with no separator. Rather than loosen a shared
   * helper every other caller depends on, the one call that needs a different
   * URL shape builds it — in the module that already holds the credential.
   */
  async function runQuery(
    sa: NonNullable<ReturnType<typeof parseServiceAccount>>,
    token: string,
    structuredQuery: unknown,
  ): Promise<FsDoc[] | null> {
    const url =
      `https://firestore.googleapis.com/v1/projects/${sa.project_id}` +
      '/databases/(default)/documents:runQuery';
    const res = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ structuredQuery }),
    });
    if (!res.ok) {
      console.error(`GABI shelf: query failed (HTTP ${res.status}).`);
      return null;
    }
    const body = (await res.json()) as { document?: FsDoc }[];
    return Array.isArray(body) ? body.map((r) => r.document).filter((d): d is FsDoc => !!d) : [];
  }

  const fail = <T>(message: string): ShelfCallResult<T> => ({ ok: false, rows: [], total: 0, message });

  return {
    async asker(discordUserId) {
      if (cached) return cached;
      try {
        const a = await auth();
        if (!a?.sa) {
          cached = { ok: false, reason: 'outage' };
          return cached;
        }
        const res = await firestoreRequest(
          a.sa,
          a.token,
          'GET',
          `discord_links/${encodeURIComponent(discordUserId)}`,
        );
        // 404 is the ORDINARY answer for somebody who has never linked.
        if (res.status === 404) {
          cached = { ok: false, reason: 'unlinked' };
          return cached;
        }
        if (!res.ok) {
          console.error(`GABI shelf: link read failed (HTTP ${res.status}).`);
          cached = { ok: false, reason: 'outage' };
          return cached;
        }
        const doc = (await res.json()) as FsDoc;
        const uid = str(doc.fields?.firebaseUid);
        const displayName = str(doc.fields?.displayName);
        const email = str(doc.fields?.email);
        // ⚠️ Two different pre-upgrade states, kept apart: a link with no uid
        // cannot reach the TBR, and one with no displayName cannot reach the
        // reviews. Both are fixed by the same re-link, but conflating them would
        // hide which half is broken from anybody debugging it.
        if (!uid) {
          cached = { ok: false, reason: 'no_uid' };
          return cached;
        }
        if (!displayName) {
          cached = { ok: false, reason: 'no_name' };
          return cached;
        }
        cached = { ok: true, asker: { uid, displayName, ...(email ? { email } : {}) } };
        return cached;
      } catch (err) {
        console.error('GABI shelf: link read threw:', err instanceof Error ? err.message : err);
        cached = { ok: false, reason: 'outage' };
        return cached;
      }
    },

    async myTbr(asker) {
      try {
        const a = await auth();
        if (!a?.sa) return fail(SHELF_MSG.estateUnreachable);
        // ⚠️ BY UID — the post-migration key. The legacy display-name rows are
        // fetched by the same query because the migration copied `uid` onto
        // every row it could; a row it could NOT (a retired passphrase account)
        // has no uid and is unreachable by any query, which is a fact about the
        // migration rather than something to paper over.
        const docs = await runQuery(a.sa, a.token, {
          from: [{ collectionId: READING_LISTS_COLLECTION }],
          where: {
            fieldFilter: {
              field: { fieldPath: 'uid' },
              op: 'EQUAL',
              value: { stringValue: asker.uid },
            },
          },
          limit: SHELF_TBR_ROWS + 1,
        });
        if (docs === null) return fail(SHELF_MSG.estateUnreachable);
        const rows: TbrRow[] = docs.map((d) => ({
          bookId: str(d.fields?.bookId),
          title: str(d.fields?.bookTitle) || str(d.fields?.bookId),
          shelf: 'audiobooks' as const,
          ...(ts(d.fields?.addedAt) ? { addedAt: ts(d.fields?.addedAt) as string } : {}),
          matchedBy: 'uid' as const,
        }));
        return { ok: true, rows: rows.slice(0, SHELF_TBR_ROWS), total: rows.length };
      } catch (err) {
        console.error('GABI shelf: TBR read threw:', err instanceof Error ? err.message : err);
        return fail(SHELF_MSG.estateUnreachable);
      }
    },

    async myReviews(asker) {
      try {
        const a = await auth();
        if (!a?.sa) return fail(SHELF_MSG.estateUnreachable);
        // ⚠️ BY DISPLAY NAME, because that is all the store has — measured from
        // `submitReview`, which writes no uid and no email. The shared
        // `isMyReview` predicate prefers email and would suggest otherwise; on
        // THIS store that branch is permanently dead.
        const docs = await runQuery(a.sa, a.token, {
          from: [{ collectionId: REVIEWS_COLLECTION }],
          where: {
            fieldFilter: {
              field: { fieldPath: 'displayName' },
              op: 'EQUAL',
              value: { stringValue: asker.displayName },
            },
          },
          limit: 200,
        });
        if (docs === null) return fail(SHELF_MSG.estateUnreachable);
        return shapeReviews(docs, SHELF_REVIEW_ROWS);
      } catch (err) {
        console.error('GABI shelf: reviews read threw:', err instanceof Error ? err.message : err);
        return fail(SHELF_MSG.estateUnreachable);
      }
    },

    async bookReviews(bookId) {
      try {
        const a = await auth();
        if (!a?.sa) return fail(SHELF_MSG.estateUnreachable);
        // ⚠️ PUBLIC content — the sites show these to anybody. No asker filter,
        // and that absence is deliberate rather than forgotten.
        const docs = await runQuery(a.sa, a.token, {
          from: [{ collectionId: REVIEWS_COLLECTION }],
          where: {
            fieldFilter: {
              field: { fieldPath: 'bookId' },
              op: 'EQUAL',
              value: { stringValue: bookId },
            },
          },
          limit: 50,
        });
        if (docs === null) return fail(SHELF_MSG.estateUnreachable);
        return shapeReviews(docs, SHELF_REVIEW_ROWS);
      } catch (err) {
        console.error('GABI shelf: book reviews threw:', err instanceof Error ? err.message : err);
        return fail(SHELF_MSG.estateUnreachable);
      }
    },
  };
}

/**
 * ⚠️ **`rating` IS A STRING ON SOME REVIEW DOCUMENTS AND A NUMBER ON OTHERS** —
 * measured 2026-09-03 against the live collection: `"5"` on two of three
 * documents and `4.5` on the third, because the site's review form has written
 * both shapes over its life.
 *
 * `num()` reads `integerValue` and `doubleValue` only, so a `stringValue` rating
 * came back as **no rating at all** — which is how the owner's own five-star
 * review of Dungeon Crawler Carl 1 read as "unrated", and why GABI asked him how
 * far he had got into a book he had finished and rated. A shape difference in a
 * store became a wrong sentence to a person.
 */
function ratingOf(v: FsValue | undefined): number | undefined {
  const n = num(v);
  if (n !== undefined) return n;
  const raw = str(v).trim();
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** ⚠️ Newest first, and the TRUE total is kept even when the rows are capped. */
function shapeReviews(docs: FsDoc[], cap: number): ShelfCallResult<ReviewRow> {
  const rows: ReviewRow[] = docs.map((d) => ({
    bookId: str(d.fields?.bookId),
    displayName: str(d.fields?.displayName),
    ...(ratingOf(d.fields?.rating) !== undefined ? { rating: ratingOf(d.fields?.rating) as number } : {}),
    ...(str(d.fields?.text) ? { text: str(d.fields?.text) } : {}),
    ...(ts(d.fields?.updatedAt) ? { updatedAt: ts(d.fields?.updatedAt) as string } : {}),
  }));
  rows.sort((x, y) => (y.updatedAt ?? '').localeCompare(x.updatedAt ?? ''));
  // ⚠️ `allBookIds` is the FULL set — computed BEFORE the display slice — so an
  // exclusion set never inherits the 15-row cap (audit F7).
  const allBookIds = rows.map((r) => r.bookId).filter(Boolean);
  return { ok: true, rows: rows.slice(0, cap), total: rows.length, allBookIds };
}

export type { ShelfPort };
