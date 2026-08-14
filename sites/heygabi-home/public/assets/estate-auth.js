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
  authDomain: 'audiobook-catalog.firebaseapp.com',
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
  try {
    await getRedirectResult(auth);
    return null;
  } catch (e) {
    if (e?.code === 'auth/unauthorized-domain') return ownerActionMessage();
    console.warn('[estate-auth] redirect result error:', e);
    return 'Sign-in did not complete. Try again.';
  }
}

/**
 * Subscribe to auth state. cb(user|null) — fires immediately with the
 * persisted session once Firebase has read it. Returns the unsubscribe.
 */
export function watchAuth(cb) {
  return onAuthStateChanged(auth, cb);
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

/** Sign out of the apex's own session. Affects this origin only. */
export async function signOutUser() {
  try {
    await signOut(auth);
  } catch (e) {
    /* a failed sign-out of an absent session is not news */
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
