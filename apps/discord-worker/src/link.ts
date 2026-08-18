/**
 * THE IDENTITY-LINK CEREMONY (design doc §1.6, phase 2).
 *
 * One ceremony, reused by every write-capable Discord feature there will ever
 * be — built once here rather than per-command, exactly as §1.6 instructs.
 *
 * ## The identity rules this implements, unchanged
 *
 *   1. **Votes are NEVER guessed from usernames.** A Discord display name is
 *      not evidence of anything. The only thing that attributes a Discord
 *      click to a club member is a `discord_links/{discordUserId}` doc that
 *      the person deliberately created.
 *   2. **Opt-in and explicit.** Nothing here happens as a side effect. The
 *      person starts it (`/link`), consents on Discord's own screen, and
 *      presses a button on a page that says in words what will be stored.
 *   3. **Revocable.** `POST /link/unlink` deletes the doc. Revocation is part
 *      of the design, not an afterthought, and it is on the same page as the
 *      link button so nobody has to hunt for it.
 *
 * ## The two proofs
 *
 * A link binds two identities, so BOTH have to be proven in the same request:
 *
 *   Discord side — an OAuth2 `identify` code exchange the browser cannot
 *     forge, carried forward in an HttpOnly HMAC'd cookie (link-token.ts).
 *   Estate side  — a Firebase ID token, verified server-side by the canonical
 *     `@platform/estate-auth` verifier (project-pinned issuer AND audience;
 *     unverified emails refused).
 *
 * Neither alone writes anything. That is the whole security of the ceremony:
 * possessing a Discord session lets you bind YOUR Discord account and no
 * other; possessing an estate session lets you bind to YOUR member entry and
 * no other.
 *
 * ## What gets written, and why exactly this shape
 *
 *   discord_links/{discordUserId} = {
 *     slug         string  — the club member slug, = displayName.toLowerCase()
 *     displayName  string  — the estate display name, original case
 *     linkedAt     timestamp
 *     firebaseUid  string  — who proved the estate side
 *     email        string  — the VERIFIED estate email (added 2026-08-18)
 *   }
 *
 * `slug` and `displayName` are the two fields poll-vote.ts's `linkFromDoc()`
 * reads, and they feed straight into `votes/{slug}` `{optionIndex,
 * displayName}` — the exact doc id and field shape a browser writes via
 * `castVote()`. The derivation is stated once, in slug.ts, and pinned by a
 * contract test so the writer and the reader cannot drift apart.
 *
 * ## ⚠️ `email` — added 2026-08-18 for the GABI docs assistant (design §4.3)
 *
 * The estate directory is keyed by EMAIL (`seenBodySchema` in auth-worker's
 * `estate.ts` requires one; `firebase_uid` is nullish and is stored, not looked
 * up by). Before this field the chain was broken in the middle: GABI could
 * prove *which Discord account* asked and *which estate member* it was, and
 * still could not ask the directory about them — this Worker cannot mint a
 * Firebase ID token, and `firebase-sa.ts` is scoped to `datastore` only, which
 * `have.ts`'s header records as a deliberate credential decision rather than an
 * oversight.
 *
 * ⚠️ **The email was ALREADY IN HAND and simply was not persisted.**
 * `proveBothIdentities()` below verifies a Firebase ID token through the
 * canonical `@platform/estate-auth` verifier — project-pinned issuer AND
 * audience, unverified emails refused — at exactly the moment this document is
 * written. Storing it makes the email as strong a claim as `firebaseUid`
 * already was: proven once, server-side, by the same verifier. It is NOT a
 * self-reported string and must never become one.
 *
 * ⚠️ **LINKS WRITTEN BEFORE THIS CHANGE HAVE NO EMAIL AND CANNOT BE UPGRADED
 * FROM THE OUTSIDE.** The owner's decision (design §9.1, 2026-08-18, verbatim:
 * *"1.a i think its just me"*) is **RELINK, NOT BACKFILL** — those people run
 * `/link` once more, which is self-verifying because a post-change link carries
 * the email by construction. ⚠️ An un-upgraded link must produce the WORDED
 * "re-link to use this" refusal, never a bare "not authorised" — that is what
 * `docs.ts`'s `DOCS_MSG.linkHasNoEmail` is for, and `docs-exec.ts` tells the two
 * apart by reading this field rather than by guessing.
 *
 * ⚠️ Nothing else reads it. The vote path still reads `slug`/`displayName`; the
 * Tier-1 delegated writes still read `firebaseUid`. Adding a field to this
 * document does not widen any of them.
 *
 * ## Ships dark
 *
 * `DISCORD_CLIENT_SECRET` is a NEW secret and is not set yet. Every route
 * here answers a worded "linking is not configured yet" page while it is
 * missing — the estate's ships-dark idiom, the same one `MODERATION_ENABLED`
 * uses. No route crashes, no route 500s, and no route pretends a missing
 * secret is the visitor's fault.
 */

import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { resolveIdentity } from '@platform/estate-auth';
import type { AppBindings, Env } from './env.js';
import {
  authorizeUrl,
  callbackUrl,
  exchangeCode,
  fetchDiscordUser,
} from './discord-oauth.js';
import {
  newNonce,
  PENDING_TTL_SECONDS,
  signPending,
  timingSafeEqual,
  verifyPending,
} from './link-token.js';
import { confirmPage, notConfiguredPage, problemPage } from './link-pages.js';
import { estateDisplayName, isSafeSlug, slugifyName } from './slug.js';
import { firestoreRequest, mintAccessToken, parseServiceAccount } from './firebase-sa.js';

/** The CSRF nonce cookie — one authorize round trip, ten minutes. */
export const STATE_COOKIE = 'gabi_link_state';
/** The proven-Discord-identity cookie — HttpOnly, HMAC'd, fifteen minutes. */
export const PENDING_COOKIE = 'gabi_link_pending';
const STATE_TTL_SECONDS = 10 * 60;

/** Both cookies are scoped to /link so nothing rides along to /interactions. */
const cookieOptions = (maxAge: number) =>
  ({
    path: '/link',
    httpOnly: true,
    secure: true,
    sameSite: 'Lax' as const,
    maxAge,
  }) as const;

/**
 * Every worded answer this ceremony can give, in one place — so the copy is
 * reviewable as copy, and testable as contract. The estate's rule, applied
 * without exception: say what happened, say what it needs, say how to get it,
 * and never dress a service failure as a permissions failure.
 */
export const LINK_MSG = {
  linked: (displayName: string) =>
    `Linked. GABI now knows this Discord account is ${displayName}, and a vote you click ` +
    `in Discord will land on your club member entry. You can unlink at any time from this page.`,
  unlinked:
    'Unlinked. GABI has forgotten which estate member this Discord account belongs to, and a ' +
    'vote clicked in Discord will be refused in words again until you link it back.',
  nothingToUnlink:
    'There was nothing to unlink — this Discord account was not connected to an estate member. ' +
    'Nothing was changed.',
  notSignedIn:
    'You are not signed in to the estate, so nothing was linked. Sign in with the same Google ' +
    'account you use on the club pages and press the button again.',
  noPending:
    'This page has forgotten which Discord account you are — the link attempt expired (it lasts ' +
    'fifteen minutes) or the page was reopened later. Nothing was changed. Run /link in Discord ' +
    'again to start over.',
  badState:
    'This link attempt could not be verified as the one you started, so nothing was linked. ' +
    'That usually means the page sat open too long or was opened from an old tab — it is not a ' +
    'sign that anything is wrong with your account.',
  declined:
    'You declined the request on Discord, so nothing was linked and nothing was stored. That is ' +
    'a perfectly fine answer.',
  discordRefused:
    'Discord would not confirm who you are, so nothing was linked. This is a problem between the ' +
    'estate and Discord, NOT a permissions problem with your account.',
  unusableName:
    'Your estate display name cannot be used as a club member entry, so nothing was linked. Set a ' +
    'display name on your Google account (or sign in with an account that has one) and try again.',
  misconfigured:
    'Linking is not fully set up on the estate side (a configuration gap, NOT a permissions ' +
    'problem). Nothing was changed. The owner has been given the exact step in the runbook.',
  outage:
    'Something went wrong on the estate’s side (a service problem, NOT a permissions one) ' +
    'and nothing was changed. Try again in a minute.',
} as const;

/** Is the ceremony configured at all? Both halves are needed to start it. */
export function linkConfigured(env: Pick<Env, 'DISCORD_APPLICATION_ID' | 'DISCORD_CLIENT_SECRET'>): boolean {
  return Boolean(env.DISCORD_APPLICATION_ID) && Boolean(env.DISCORD_CLIENT_SECRET);
}

/** The Firestore fields for a link doc — the shape linkFromDoc() reads back. */
export function linkDocFields(input: {
  slug: string;
  displayName: string;
  firebaseUid: string;
  /** ⚠️ The VERIFIED estate email, lowercased. Proven by the canonical Firebase
   *  verifier in `proveBothIdentities()` — never a value anybody typed. */
  email: string;
  linkedAt: Date;
}) {
  return {
    slug: { stringValue: input.slug },
    displayName: { stringValue: input.displayName },
    linkedAt: { timestampValue: input.linkedAt.toISOString() },
    firebaseUid: { stringValue: input.firebaseUid },
    email: { stringValue: input.email },
  };
}

/**
 * The update mask that writes exactly those five fields and nothing else.
 *
 * ⚠️ A field missing from this mask is a field the PATCH silently does not
 * write — the document would come back looking correct in code and be missing
 * the column in Firestore. `email` joined the list 2026-08-18 with the field
 * itself; the two must be edited together, always.
 */
const LINK_UPDATE_MASK = ['slug', 'displayName', 'linkedAt', 'firebaseUid', 'email']
  .map((f) => `updateMask.fieldPaths=${f}`)
  .join('&');

export const linkRoutes = new Hono<AppBindings>();

// ---------------------------------------------------------------------------
// GET /link — start. Sets the CSRF nonce, redirects to Discord.
// ---------------------------------------------------------------------------
linkRoutes.get('/link', (c) => {
  if (!linkConfigured(c.env)) {
    // 503 with a WORDED page: honest about being a server-side gap, and
    // readable by a human who arrived from a Discord message.
    return c.html(notConfiguredPage(), 503);
  }

  const state = newNonce();
  setCookie(c, STATE_COOKIE, state, cookieOptions(STATE_TTL_SECONDS));
  const redirectUri = callbackUrl(new URL(c.req.url).origin);
  return c.redirect(authorizeUrl(c.env.DISCORD_APPLICATION_ID!, redirectUri, state), 302);
});

// ---------------------------------------------------------------------------
// GET /link/callback — Discord comes back. Validate state, exchange the code,
// learn who they are, and hand the browser a page that proves the OTHER half.
// ---------------------------------------------------------------------------
linkRoutes.get('/link/callback', async (c) => {
  if (!linkConfigured(c.env)) return c.html(notConfiguredPage(), 503);

  const url = new URL(c.req.url);
  const cookieState = getCookie(c, STATE_COOKIE) ?? '';
  // Clear the nonce on every outcome — it is single-use by construction.
  deleteCookie(c, STATE_COOKIE, { path: '/link' });

  // Discord's own refusal path (the person pressed Cancel).
  const oauthError = url.searchParams.get('error');
  if (oauthError) {
    const declined = oauthError === 'access_denied';
    return c.html(
      problemPage(
        declined ? 'Nothing was linked' : 'Discord could not complete the request',
        declined ? LINK_MSG.declined : LINK_MSG.discordRefused,
        declined
          ? 'You can run /link in Discord again whenever you want to. Voting on the club page never needed this.'
          : 'Try again in a minute. If it keeps happening, say so — it is a problem on the estate’s side to fix, not yours.',
      ),
      200,
    );
  }

  const state = url.searchParams.get('state') ?? '';
  if (!cookieState || !state || !timingSafeEqual(cookieState, state)) {
    return c.html(
      problemPage('This link attempt could not be verified', LINK_MSG.badState, 'Run /link in Discord again to start a fresh attempt.'),
      400,
    );
  }

  const code = url.searchParams.get('code') ?? '';
  if (!code) {
    return c.html(
      problemPage('Discord sent no authorization code', LINK_MSG.discordRefused, 'Run /link in Discord again to start over.'),
      400,
    );
  }

  const redirectUri = callbackUrl(url.origin);
  const token = await exchangeCode(
    c.env.DISCORD_APPLICATION_ID!,
    c.env.DISCORD_CLIENT_SECRET!,
    code,
    redirectUri,
  );
  if (!token.ok) {
    console.error('discord code exchange failed:', token.reason, token.detail);
    return c.html(
      problemPage('Discord would not confirm who you are', LINK_MSG.discordRefused, 'Try /link again in a minute.'),
      502,
    );
  }

  const who = await fetchDiscordUser(token.value);
  if (!who.ok) {
    console.error('discord users/@me failed:', who.reason, who.detail);
    return c.html(
      problemPage('Discord would not confirm who you are', LINK_MSG.discordRefused, 'Try /link again in a minute.'),
      502,
    );
  }

  const pending = await signPending(c.env.DISCORD_CLIENT_SECRET!, {
    discordUserId: who.value.id,
    discordUsername: who.value.username,
    exp: Math.floor(Date.now() / 1000) + PENDING_TTL_SECONDS,
  });
  setCookie(c, PENDING_COOKIE, pending, cookieOptions(PENDING_TTL_SECONDS));

  return c.html(confirmPage(who.value.username));
});

// ---------------------------------------------------------------------------
// The two write routes. Both demand BOTH proofs; both answer JSON carrying a
// `message` the page renders verbatim, so there is exactly one wording of
// each outcome and no chance of the page inventing its own.
// ---------------------------------------------------------------------------

interface Proven {
  discordUserId: string;
  discordUsername: string;
  uid: string;
  /** ⚠️ The verified estate email, lowercased — the estate directory's KEY.
   *  Comes from `resolveIdentity()`, which refuses unverified emails, so this
   *  is a proof and not a claim. Persisted since 2026-08-18 (design §4.3). */
  email: string;
  displayName: string;
  slug: string;
}

type ProveResult =
  | { ok: true; value: Proven }
  | { ok: false; status: number; message: string };

/** Both halves, in order: the cheap cookie check, then the token verify. */
async function proveBothIdentities(c: {
  env: Env;
  req: { raw: Request };
}, pendingCookie: string | undefined): Promise<ProveResult> {
  if (!c.env.DISCORD_CLIENT_SECRET) {
    return { ok: false, status: 503, message: LINK_MSG.misconfigured };
  }
  if (!pendingCookie) {
    return { ok: false, status: 400, message: LINK_MSG.noPending };
  }
  const pending = await verifyPending(
    c.env.DISCORD_CLIENT_SECRET,
    pendingCookie,
    Math.floor(Date.now() / 1000),
  );
  if (!pending) {
    // Forged, tampered and expired are ONE answer on purpose — telling them
    // apart tells a forger which half to fix (link-token.ts's header).
    return { ok: false, status: 400, message: LINK_MSG.noPending };
  }

  let identity;
  try {
    identity = await resolveIdentity(c.req.raw, c.env);
  } catch (err) {
    console.error('estate identity verify misconfigured:', err instanceof Error ? err.message : err);
    return { ok: false, status: 503, message: LINK_MSG.misconfigured };
  }
  if (!identity || !identity.uid) {
    return { ok: false, status: 401, message: LINK_MSG.notSignedIn };
  }

  // ⚠️ Lowercased HERE, once, at the moment of proof — the estate directory
  // normalizes on lookup (`normalizeEmail`, auth-worker's estate-db.ts) and a
  // document holding `Owner@Example.com` while the table holds the lowercase
  // form is a link that resolves to nobody, worded as "you aren't devops".
  const email = identity.email.trim().toLowerCase();

  const displayName = estateDisplayName(identity);
  const slug = slugifyName(displayName);
  if (!isSafeSlug(slug)) {
    return { ok: false, status: 422, message: LINK_MSG.unusableName };
  }

  return {
    ok: true,
    value: {
      discordUserId: pending.discordUserId,
      discordUsername: pending.discordUsername,
      uid: identity.uid,
      email,
      displayName,
      slug,
    },
  };
}

/** The service account, or a worded configuration answer. */
function serviceAccountOrMessage(env: Env) {
  try {
    const sa = parseServiceAccount(env.FIREBASE_SERVICE_ACCOUNT);
    if (sa) return { ok: true as const, sa };
  } catch (err) {
    console.error('FIREBASE_SERVICE_ACCOUNT malformed:', err instanceof Error ? err.message : err);
  }
  return { ok: false as const, status: 503, message: LINK_MSG.misconfigured };
}

// POST /link/confirm — write the bind.
linkRoutes.post('/link/confirm', async (c) => {
  const proof = await proveBothIdentities(c, getCookie(c, PENDING_COOKIE));
  if (!proof.ok) return c.json({ ok: false, message: proof.message }, proof.status as 400);

  const cred = serviceAccountOrMessage(c.env);
  if (!cred.ok) return c.json({ ok: false, message: cred.message }, cred.status as 503);

  try {
    const accessToken = await mintAccessToken(cred.sa);
    const res = await firestoreRequest(
      cred.sa,
      accessToken,
      'PATCH',
      `discord_links/${encodeURIComponent(proof.value.discordUserId)}?${LINK_UPDATE_MASK}`,
      {
        fields: linkDocFields({
          slug: proof.value.slug,
          displayName: proof.value.displayName,
          firebaseUid: proof.value.uid,
          email: proof.value.email,
          linkedAt: new Date(),
        }),
      },
    );
    if (!res.ok) throw new Error(`link write failed (${res.status})`);
  } catch (err) {
    console.error('link write failed:', err instanceof Error ? err.message : err);
    return c.json({ ok: false, message: LINK_MSG.outage }, 502);
  }

  // The ceremony is finished; the pending proof has been spent.
  deleteCookie(c, PENDING_COOKIE, { path: '/link' });
  return c.json({
    ok: true,
    message: LINK_MSG.linked(proof.value.displayName),
    slug: proof.value.slug,
  });
});

// POST /link/unlink — revoke the bind. Same two proofs: proving the Discord
// side is what makes this YOUR link to remove, and the estate token is the
// second half the design asks for. A missing doc is not an error — revocation
// is idempotent, and saying "there was nothing there" is more honest than
// reporting a success that removed nothing.
linkRoutes.post('/link/unlink', async (c) => {
  const proof = await proveBothIdentities(c, getCookie(c, PENDING_COOKIE));
  if (!proof.ok) return c.json({ ok: false, message: proof.message }, proof.status as 400);

  const cred = serviceAccountOrMessage(c.env);
  if (!cred.ok) return c.json({ ok: false, message: cred.message }, cred.status as 503);

  let existed = true;
  try {
    const accessToken = await mintAccessToken(cred.sa);
    const path = `discord_links/${encodeURIComponent(proof.value.discordUserId)}`;
    const before = await firestoreRequest(cred.sa, accessToken, 'GET', path);
    if (before.status === 404) existed = false;
    else if (!before.ok) throw new Error(`link read failed (${before.status})`);
    if (existed) {
      const res = await firestoreRequest(cred.sa, accessToken, 'DELETE', path);
      if (!res.ok) throw new Error(`link delete failed (${res.status})`);
    }
  } catch (err) {
    console.error('unlink failed:', err instanceof Error ? err.message : err);
    return c.json({ ok: false, message: LINK_MSG.outage }, 502);
  }

  deleteCookie(c, PENDING_COOKIE, { path: '/link' });
  return c.json({ ok: true, message: existed ? LINK_MSG.unlinked : LINK_MSG.nothingToUnlink });
});
