/**
 * The MEMBER SLUG contract — the one place this Worker states what a club
 * member slug is, because two independent surfaces have to agree on it
 * exactly or a linked person's votes land on a doc nobody reads.
 *
 * ⚠️ MEASURED, not assumed (2026-08-17, against the audiobook catalog):
 *
 *   audiobook_catalog/site/identity.js:765
 *     export function slugifyName(displayName) { return displayName.toLowerCase(); }
 *
 *   audiobook_catalog/site/identity.js:78 (mirrorUser)
 *     localStorage 'ab_identity_name' = user.displayName || user.email
 *     → getSession().displayName is exactly that string
 *
 *   audiobook_catalog/site/club-reads.js:1530 (castVote)
 *     setDoc(doc(db, 'clubs', clubId, 'polls', pollId, 'votes',
 *                slugifyName(session.displayName)),
 *            { displayName: session.displayName, optionIndex, updatedAt })
 *
 * So the slug is a LOWERCASED GOOGLE DISPLAY NAME — nothing is stripped,
 * nothing is dashed, nothing is transliterated. "Sam Vimes" becomes
 * "sam vimes", spaces and apostrophes and accents intact.
 *
 * ⚠️ THIS IS WHY THE OLD `SAFE_ID` COULD NOT GUARD SLUGS. poll-vote.ts
 * originally validated the link doc's slug with /^[A-Za-z0-9_-]{1,64}$/ —
 * a Firestore-auto-id shape, correct for clubId/pollId and WRONG for a slug:
 * it rejects every display name containing a space, which is very nearly all
 * of them. Left alone, phase 2 would have written links that phase 1 then
 * refused to read, and every such voter would have been told they were
 * "not linked" while the link doc sat right there. The contract test in
 * test/link.test.ts pins the two halves together so they cannot drift again.
 *
 * What IS still refused here is what Firestore itself refuses in a document
 * id, plus anything that could escape a REST path segment. Everything that
 * reaches a URL is percent-encoded by `slugPathSegment()` on top of that —
 * validation is the contract, encoding is the mechanical guard, and both run.
 */

/** Firestore's own document-id ceiling (1500 bytes, UTF-8). */
const MAX_SLUG_BYTES = 1500;

const utf8 = new TextEncoder();

/**
 * `slugifyName()` from identity.js, restated. Kept as a named function
 * rather than an inline `.toLowerCase()` so that the day the audiobook site
 * changes its slug rule, exactly one line here changes with it.
 */
export function slugifyName(displayName: string): string {
  return displayName.toLowerCase();
}

/**
 * The estate display name for a verified identity — `user.displayName ||
 * user.email`, the same fallback mirrorUser() writes into the browser
 * session. A Google account with no name set still gets a stable slug
 * instead of an empty one.
 */
export function estateDisplayName(identity: {
  name: string | null;
  email: string;
}): string {
  const name = (identity.name ?? '').trim();
  return name.length > 0 ? name : identity.email.trim();
}

/**
 * Is this string usable as a Firestore document id AND as one REST path
 * segment? Refuses exactly what Firestore refuses, and nothing a real
 * display name would produce.
 */
export function isSafeSlug(slug: unknown): slug is string {
  if (typeof slug !== 'string') return false;
  if (slug.length === 0) return false;
  if (utf8.encode(slug).length > MAX_SLUG_BYTES) return false;
  if (slug.includes('/')) return false; //           path separator
  if (slug === '.' || slug === '..') return false; // Firestore's reserved ids
  if (/^__.*__$/.test(slug)) return false; //        Firestore's reserved namespace
  // C0/C1 control characters and the Unicode line separators: never in a
  // name, always trouble in a header, a URL or a log line.
  if (/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(slug)) return false;
  // A slug is a LOWERCASED name by construction; an uppercase letter means
  // whoever produced it did not run it through slugifyName(), and the doc it
  // would address is not the doc the browser writes.
  if (slug !== slug.toLowerCase()) return false;
  return true;
}

/** The slug, percent-encoded for a Firestore REST path segment. */
export function slugPathSegment(slug: string): string {
  return encodeURIComponent(slug);
}
