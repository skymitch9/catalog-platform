/**
 * status/lib/gate.js — the devops sign-in gate shared by all four /status
 * pages (Health · Processing · Pipelines · Agents).
 *
 * Extracted from status.js on 2026-08-18 with the page split. It is the SAME
 * gate that has run on /status since 2026-08-15 — a Firebase sign-in plus one
 * `GET /api/estate/me`, reading the EFFECTIVE `is_devops` the directory
 * answers (approvers qualify implicitly; `is_approver` is kept as a fallback
 * so an older auth-worker deploy does not lock approvers out).
 *
 * ⚠️ ONE IMPLEMENTATION, FOUR PAGES, AND THAT IS THE WHOLE POINT. Four copies
 * of a gate is four chances for one of them to fail OPEN, and the failure
 * would be invisible — a page that reveals its controls to the wrong person
 * looks exactly like a page that works. Adding a fifth page means calling
 * this, never re-deriving it.
 *
 * ⚠️ FAILS CLOSED. A probe that throws, times out, or answers a shape this
 * does not recognise leaves `allowed` false and every gated section hidden.
 * On a read-only status row an unknown answer can degrade to "unknown"; on a
 * gate it must degrade to "no".
 *
 * ⚠️ IT REVEALS, IT NEVER REMOVES. Anonymous content on a page stays
 * anonymous — this only toggles the sections handed to `mountGate({sections})`.
 */

import { handleRedirectResult, idToken, signIn, signOutUser, watchAuth } from '../../assets/estate-auth.js';
import { AUTH_ORIGIN } from './core.js';

/**
 * Wire the sign-in bar and the gated sections.
 *
 *   sections   [HTMLElement|null]  hidden until the gate says yes
 *   onAllowed  ()  => void         called each time the gate opens (re-runs on
 *                                  every auth event — make it idempotent)
 *   onDenied   ()  => void         optional; called when it closes again
 *
 * Returns `{ isAllowed, refresh }` so a caller can ask the current answer
 * without keeping its own copy of it.
 */
export function mountGate({ sections = [], onAllowed = () => {}, onDenied = () => {} } = {}) {
  const signinBtn = document.getElementById('ops-signin');
  const whoEl = document.getElementById('ops-who');
  const noteEl = document.getElementById('ops-note');
  // A page without the bar is a page that did not opt in; do nothing rather
  // than throw, so one malformed page cannot take its own script down.
  if (!signinBtn || !whoEl || !noteEl) return { isAllowed: () => false, refresh: () => {} };

  const gated = sections.filter(Boolean);
  let currentUser = null;
  let allowed = false;
  let checkedFor = null; // the uid the last /me probe ran for

  function setNote(text, tone) {
    noteEl.textContent = text || '';
    noteEl.dataset.tone = tone || '';
    noteEl.hidden = !text;
  }

  function showSections(visible) {
    for (const s of gated) s.hidden = !visible;
  }

  /**
   * GET /api/estate/me with the caller's own ID token — a 200-shaped fact, not
   * a client-side guess. Never throws: a failed probe leaves the sections
   * hidden, which is the safe default on a control surface.
   */
  async function probe() {
    const uid = currentUser?.uid;
    if (!uid || checkedFor === uid) return;
    checkedFor = uid;
    const token = await idToken();
    if (!token) return;
    try {
      const res = await fetch(`${AUTH_ORIGIN}/api/estate/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        allowed = false;
      } else {
        const body = await res.json();
        // is_devops is EFFECTIVE from /me (approver ⇒ true), so this one field
        // is the whole answer — owner order 2026-08-15: the devops role drives
        // this page. Older worker deploys lack the field; is_approver keeps
        // approvers working across that skew.
        allowed = body?.is_devops === true || body?.is_approver === true;
      }
    } catch {
      allowed = false;
    }
    if (currentUser?.uid === uid) render();
  }

  function render() {
    const signedIn = currentUser !== null;
    signinBtn.hidden = signedIn;
    whoEl.hidden = !signedIn;

    if (!signedIn) {
      whoEl.replaceChildren();
      showSections(false);
      setNote('');
      onDenied();
      return;
    }

    whoEl.replaceChildren();
    const out = document.createElement('button');
    out.type = 'button';
    out.className = 'linkbtn';
    out.textContent = 'sign out';
    out.addEventListener('click', async () => { await signOutUser(); });
    whoEl.append(`Signed in as ${currentUser.displayName || currentUser.email} · `, out);

    if (checkedFor !== currentUser.uid) {
      // ⚠️ "Checking access…" is a real state and gets its own words. A blank
      // here reads as "you are not allowed", which is a different and wrong
      // thing to tell someone mid-probe.
      setNote('Checking access…');
      showSections(false);
      return;
    }

    if (allowed) {
      setNote('');
      showSections(true);
      onAllowed();
    } else {
      showSections(false);
      onDenied();
      // Names the role AND how to get it — the estate's standing rule that a
      // refusal says what happened, what it needs, and who can grant it.
      setNote(
        'Signed in, but this account holds neither devops nor admin — these controls stay hidden. ' +
          'An admin can grant devops from /admin ("Make devops").',
        'warn',
      );
    }
  }

  signinBtn.addEventListener('click', async () => {
    signinBtn.disabled = true;
    const r = await signIn();
    signinBtn.disabled = false;
    if (r.error) setNote(r.error, 'warn');
  });

  watchAuth((user) => {
    const changed = currentUser?.uid !== user?.uid;
    currentUser = user;
    if (!user) {
      allowed = false;
      checkedFor = null;
    }
    render();
    if (user && changed) probe();
  });

  handleRedirectResult().then((err) => {
    if (err) setNote(err, 'warn');
  });

  return {
    isAllowed: () => allowed,
    refresh: () => { checkedFor = null; probe(); },
  };
}
