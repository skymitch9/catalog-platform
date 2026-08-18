/**
 * estate-auth.js — Firebase sign-in for the apex, ported (minimum) from
 * audiobook_catalog/site/identity.js. ES module, browser-native, no build.
 *
 * WHAT THIS IS FOR — and the one deliberate difference from identity.js:
 * the audiobook site captures a name into localStorage and then signs the
 * Firebase session OUT immediately (its Firestore rules never check auth).
 * The apex does the opposite on purpose: it KEEPS the Firebase session,
 * because its whole reason for signing in is minting ID tokens to send as
 * bearers to index.heygabi.ai (search) and auth.heygabi.ai (the admin API).
 * No localStorage identity, no capture-detach dance, no profile writes.
 * Firebase auth state is origin-scoped, so this session and the audiobook
 * site's capture-detach behaviour on audiobooks.heygabi.ai cannot see each
 * other (estate-auth-design.md §7.2 — verified by the attended §15 two-tab
 * test before this is trusted).
 *
 * What IS ported from identity.js, because it was learned the hard way there:
 *   - popup-first, redirect fallback ONLY for POPUP_UNAVAILABLE codes
 *     (a person closing the popup is a cancellation, not a reason to
 *     navigate the whole page to Google);
 *   - every page that offers sign-in must call handleRedirectResult() on
 *     load, or the mobile/in-app-browser flow drops the credential on the
 *     floor and the user lands back signed out with no error.
 *
 * ⚠️ auth/unauthorized-domain means heygabi.ai is not on Firebase →
 * Authentication → Settings → Authorised domains. That is a CONSOLE action
 * only the owner can take (it cannot be scripted). ownerActionMessage() turns
 * it into an instruction instead of a broken button.
 */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js';
import {
  getAuth,
  signInWithPopup,
  signInWithRedirect,
  signInWithCustomToken,
  getRedirectResult,
  GoogleAuthProvider,
  onAuthStateChanged,
  signOut,
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';

// The shared estate Firebase project — same config every audiobook page ships.
// One project for the whole estate is a standing decision (PLATFORM.md);
// FIREBASE_PROJECT_ID is pinned to this projectId in every Worker verifier.
const firebaseConfig = {
  apiKey: 'AIzaSyDgAblkxzVxl7nFbd7jXOo6PpuNPsJw11Y',
  // Flipped 2026-08-16 — sso-design.md §4.1/§8 Phase 1 (option a). Was
  // 'audiobook-catalog.firebaseapp.com'. auth.heygabi.ai reverse-proxies
  // /__/auth/* to that same host (apps/auth-worker/src/auth-proxy.ts), so
  // the sign-in ceremony now runs same-site instead of cross-site — fixes
  // the third-party-storage breakage in signInWithRedirect() (§3.2). This
  // does NOT share sessions across origins (§4.1 says so plainly); it only
  // makes THIS origin's sign-in reliable. Rollback: revert this one string
  // to the firebaseapp.com value and redeploy.
  authDomain: 'auth.heygabi.ai',
  projectId: 'audiobook-catalog',
  storageBucket: 'audiobook-catalog.firebasestorage.app',
  messagingSenderId: '68492219785',
  appId: '1:68492219785:web:7cbe57dda8712377f0bd58',
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

/** Popup failures that mean "the browser will not give us a popup", as opposed
 * to "the person changed their mind". Only these justify the redirect fallback.
 * (Ported verbatim from identity.js.) */
const POPUP_UNAVAILABLE = new Set([
  'auth/popup-blocked',
  'auth/operation-not-supported-in-this-environment',
  'auth/web-storage-unsupported',
]);

/** The owner-action console step, said as an instruction. */
export function ownerActionMessage() {
  return (
    'Sign-in is blocked because heygabi.ai is not yet an authorised domain for the ' +
    'shared Firebase project. Owner action (console only): Firebase → project ' +
    'audiobook-catalog → Authentication → Settings → Authorised domains → add heygabi.ai. ' +
    'Nothing else is broken — this page will work the moment that entry exists.'
  );
}

/**
 * Complete a redirect-based sign-in on the way back from Google. Must run on
 * load of every page that offers sign-in (identity.js's rule, kept). Returns
 * an error message string when the return trip failed, else null — the
 * successful case needs nothing: the session persists and watchAuth fires.
 */
export async function handleRedirectResult() {
  let answer = null;
  try {
    await getRedirectResult(auth);
  } catch (e) {
    if (e?.code === 'auth/unauthorized-domain') {
      answer = ownerActionMessage();
    } else {
      console.warn('[estate-auth] redirect result error:', e);
      answer = 'Sign-in did not complete. Try again.';
    }
  }
  // ⚠️ The estate-SSO bootstrap is hooked HERE on purpose, and this is the
  // reason no apex page needed editing to gain single sign-on: this module's
  // standing rule is already "every page that offers sign-in must call
  // handleRedirectResult() on load" (see the docblock above), which makes
  // this the one chokepoint every such page reliably passes through. Hanging
  // the bootstrap off it means a new page gets inheritance by following the
  // rule it already had to follow, and cannot forget to.
  //
  // Deliberately NOT awaited: the caller awaits this function to decide
  // whether to show a sign-in error, and that decision must not wait on a
  // network round trip to auth.heygabi.ai. The bootstrap resolves later and
  // fires watchAuth on its own, which is what every page already re-renders
  // from.
  bootstrapEstateSso();
  return answer;
}

/**
 * Subscribe to auth state. cb(user|null) — fires immediately with the
 * persisted session once Firebase has read it. Returns the unsubscribe.
 */
export function watchAuth(cb) {
  return onAuthStateChanged(auth, cb);
}

// ==================== Estate SSO (sso-design.md §4.3, Phase 3) ====================
//
// THE PROBLEM, in one line: Firebase web auth state is per-ORIGIN (its own
// IndexedDB per origin), so signing in here left every other estate surface
// signed out. The owner hit it head-on — "Ebooks makes me login every time
// why is it not inheriting login from main page?"
//
// THE MECHANISM: an HttpOnly cookie on the PARENT domain (`.heygabi.ai`,
// set by auth.heygabi.ai) plus a Worker-minted Firebase custom token.
// Sign in interactively once, anywhere; every other estate origin trades
// that cookie for a short-lived custom token and calls
// signInWithCustomToken() to create its OWN normal local session. Because
// the result is an ordinary Firebase session, every existing watchAuth /
// currentUser / getIdToken call site keeps working untouched — that is the
// whole reason this shape was chosen over relaying tokens through a hidden
// iframe (design §4.2 rejects that one at length).
//
// ⚠️ WHAT THIS IS NOT: it is NOT authority. No Worker anywhere trusts this
// cookie for authorization, and this layer mints nothing that outlives or
// bypasses the estate checks. Every consumer still verifies a real Firebase
// ID token and consults the estate directory with the §3.1 10-minute TTL,
// exactly as before. All the cookie can produce is a session the same person
// could get by tapping the Google button themselves — it moves the SIGN-IN,
// never the authority. Revocation is unaffected, and the mint route refuses
// a revoked member outright (session.ts).
//
// ⚠️ SILENT BY DEFAULT, STATUS QUO ON FAILURE. Every path below swallows its
// errors and returns false. A missing cookie, a Worker outage, an unset
// signing key, a browser that partitions the cookie away — all degrade to
// exactly today's behaviour: the page shows "sign in" and works. SSO must
// never turn into a broken page or a sign-in loop, so nothing here throws,
// nothing here blocks first paint, and nothing here is awaited by any
// render path.

const SESSION_URL = 'https://auth.heygabi.ai/api/session';
const SESSION_TOKEN_URL = 'https://auth.heygabi.ai/api/session/token';

/** Publish-once marker, per browser tab per uid — see publishEstateSession. */
const PUBLISH_MARK_PREFIX = 'estate_sso_published_';

/**
 * Tell the estate this browser is signed in: POST our fresh Firebase ID
 * token to the auth Worker, which verifies it and sets the parent-domain
 * cookie. That cookie is what every OTHER estate origin later trades for a
 * session of its own.
 *
 * ⚠️ Marked once per browser tab per uid, deliberately. POST /api/session
 * creates a NEW session row every call (one per device is the intent), so
 * calling it on every page load would spam D1 with a row per navigation.
 * The marker is only kept on success, so a failed publish retries on the
 * next page rather than silently never — the same idiom identity.js already
 * uses for its /hello estate-enrollment pipe.
 *
 * Returns true when the cookie was set. Never throws.
 */
export async function publishEstateSession() {
  try {
    const user = auth.currentUser;
    if (!user || !user.uid) return false;

    const key = PUBLISH_MARK_PREFIX + user.uid;
    try {
      if (sessionStorage.getItem(key)) return false;
    } catch (e) {
      /* storage unavailable — publish anyway, at worst an extra row */
    }

    const token = await user.getIdToken();
    const res = await fetch(SESSION_URL, {
      method: 'POST',
      // ⚠️ Required in BOTH directions: without it the browser drops the
      // Set-Cookie on the way back, and the whole mechanism silently no-ops
      // while every status code still reads 200.
      credentials: 'include',
      headers: { Authorization: 'Bearer ' + token },
    });
    if (!res.ok) return false;
    try { sessionStorage.setItem(key, '1'); } catch (e) { /* retry next page */ }
    return true;
  } catch (e) {
    return false; // offline, CORS, storage — the estate simply does not learn
  }
}

/**
 * Inherit a sign-in that happened on another estate surface. Trades the
 * parent-domain cookie for a short-lived custom token and turns it into a
 * normal local Firebase session.
 *
 * Call on load ONLY when this origin has no local session of its own —
 * bootstrapEstateSso() below does that check for you and is what pages
 * should call.
 *
 * Deliberately does NOT cache its failures. A negative answer can go stale
 * the moment the person signs in on another tab, and one small fetch per
 * signed-out page load is the price of inheritance feeling instant. The
 * request is cheap and carries no body.
 *
 * Returns true when a session was created here. Never throws.
 */
export async function inheritEstateSession() {
  try {
    const res = await fetch(SESSION_TOKEN_URL, { method: 'POST', credentials: 'include' });
    // 401 no_session (no cookie — the ordinary signed-out case), 403
    // estate_revoked, 503 token_signer_unset (the owner's console step not
    // yet done) all land here and all mean the same thing to a page: stay
    // signed out and say exactly what it says today.
    if (!res.ok) return false;
    const body = await res.json();
    if (!body || typeof body.token !== 'string') return false;
    await signInWithCustomToken(auth, body.token);
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * The one call a page makes. Run it on load, after handleRedirectResult().
 *
 * Waits for Firebase to publish its restored session (that first answer is
 * asynchronous — treating the initial null as "signed out" is the classic
 * bug here), then does exactly one of two things:
 *   - already signed in locally  → publish, so this sign-in can travel;
 *   - not signed in locally      → try to inherit one from the estate.
 *
 * Returns true if the browser ended up signed in on this origin because of
 * this call. Fire-and-forget is fine; nothing renders off the return value.
 */
export async function bootstrapEstateSso() {
  try {
    const user = await new Promise((resolve) => {
      if (auth.currentUser) return resolve(auth.currentUser);
      const unsub = onAuthStateChanged(auth, (u) => { unsub(); resolve(u || null); });
    });
    if (user) {
      await publishEstateSession();
      return false; // already signed in here; nothing inherited
    }
    return await inheritEstateSession();
  } catch (e) {
    return false;
  }
}

/**
 * Start a Google sign-in. Resolves to one of:
 *   { ok: true }                     — signed in (watchAuth also fires)
 *   { redirecting: true }            — page is navigating to Google
 *   { cancelled: true }              — the person backed out; say nothing loud
 *   { error: string }                — show this; ownerAction true when it is
 *   { error, ownerAction: true }       the authorised-domain console step
 */
export async function signIn() {
  const provider = new GoogleAuthProvider();
  try {
    await signInWithPopup(auth, provider);
    // Let the sign-in travel: publish it to the estate so the other
    // surfaces can inherit it silently. Awaited (it is one fast request)
    // so that a person who signs in here and immediately clicks through to
    // another catalog finds the cookie already set. A failure is silent —
    // this origin is signed in either way, which is all signIn() promises.
    await publishEstateSession();
    return { ok: true };
  } catch (e) {
    if (e?.code === 'auth/unauthorized-domain') {
      return { error: ownerActionMessage(), ownerAction: true };
    }
    if (e?.code === 'auth/popup-closed-by-user' || e?.code === 'auth/cancelled-popup-request') {
      return { cancelled: true };
    }
    if (POPUP_UNAVAILABLE.has(e?.code)) {
      try {
        await signInWithRedirect(auth, provider);
        return { redirecting: true }; // navigation is under way; not reached in practice
      } catch (e2) {
        if (e2?.code === 'auth/unauthorized-domain') {
          return { error: ownerActionMessage(), ownerAction: true };
        }
        console.error('[estate-auth] redirect sign-in failed:', e2);
        return { error: 'Sign-in failed. Try again.' };
      }
    }
    console.error('[estate-auth] sign-in failed:', e);
    return { error: 'Sign-in failed. Try again.' };
  }
}

/**
 * Sign out of the apex's own session, and clear the estate cookie so this
 * sign-in stops travelling to other origins.
 *
 * ⚠️ Sign-out semantics are LOCAL + COOKIE-CLEAR, an explicit owner decision
 * (design §9 Q4). An origin that has ALREADY localised a session keeps it
 * until it ends naturally — this does not reach out and sign you out
 * everywhere. Full single-sign-out would need every origin to re-check the
 * cookie on each load, which reintroduces the "one page signs you out from
 * under another" failure class the v1 identity code died of. The
 * security-relevant lever is estate revocation, which shuts every door
 * within minutes and is untouched by any of this.
 */
export async function signOutUser() {
  try {
    await signOut(auth);
  } catch (e) {
    /* a failed sign-out of an absent session is not news */
  }
  // Drop the publish markers so a later sign-in re-publishes rather than
  // believing it already had.
  try {
    const stale = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k && k.indexOf(PUBLISH_MARK_PREFIX) === 0) stale.push(k);
    }
    stale.forEach((k) => sessionStorage.removeItem(k));
  } catch (e) { /* storage unavailable — nothing was marked anyway */ }
  try {
    await fetch(SESSION_URL, { method: 'DELETE', credentials: 'include' });
  } catch (e) {
    /* the local session is already gone; a stranded cookie expires on its own */
  }
}

/**
 * A fresh ID token for the current user, or null when signed out. The SDK
 * caches and refreshes internally — calling this per request is the intended
 * use, not a cost.
 */
export async function idToken() {
  const user = auth.currentUser;
  if (!user) return null;
  try {
    return await user.getIdToken();
  } catch (e) {
    console.warn('[estate-auth] token mint failed:', e);
    return null;
  }
}
