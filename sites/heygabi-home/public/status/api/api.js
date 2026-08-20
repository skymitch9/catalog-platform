/**
 * status/api/api.js — renders the estate's machine-key registry and mints the
 * keys that can be minted.
 *
 * Owner asks 2026-08-20: "a way for justin to gen a key or regen a key... all
 * from the ui page for max safety", then "we should put all api key rotation
 * stuff here for our portfolio". Endpoints: GET /api/estate/keys and
 * POST /api/estate/keys/:id (apps/auth-worker/src/machine-keys.ts), both
 * requireDevops().
 *
 * ⚠️ THE REGISTRY IS THE WORKER'S, NOT THIS FILE'S. Every card is built from
 * what GET /estate/keys returns, including which credentials exist and which
 * may be minted. A hardcoded card here would be a second list to forget, and
 * both failure shapes are bad: omitting a credential makes the page a liar by
 * silence, and offering a button the route refuses teaches people the page is
 * wrong. `mode` decides whether a card gets a button — and the ROUTE refuses
 * non-self-service ids regardless, because the UI is not the security boundary.
 *
 * ⚠️ NO MINTED VALUE IS EVER HELD IN MODULE STATE. It goes straight into the
 * DOM node that displays it and is read back from that node to copy. There is
 * deliberately no `let lastToken`: a module-scoped copy would survive sign-out
 * and the gate closing. clearAllOnce() empties those nodes, and the gate's
 * onDenied calls it.
 *
 * ⚠️ EVERY VALUE FROM THE API IS WRITTEN WITH textContent, NEVER innerHTML.
 */

import { idToken } from '../../assets/estate-auth.js';
import { AUTH_ORIGIN } from '../lib/core.js';
import { mountGate } from '../lib/gate.js';

const KEYS_URL = `${AUTH_ORIGIN}/api/estate/keys`;

const section = document.getElementById('api-section');
const infoSection = document.getElementById('info-section');
const mount = document.getElementById('keys-mount');
const infoMount = document.getElementById('info-mount');
const pageStatus = document.getElementById('keys-status');

function setPageStatus(text, tone) {
  pageStatus.textContent = text || '';
  pageStatus.dataset.tone = tone || '';
}

function when(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

function ago(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs} h ago`;
  return `${Math.round(hrs / 24)} d ago`;
}

function el(tag, className, text) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text !== undefined) n.textContent = text;
  return n;
}

function factRow(k, v, mono) {
  const li = document.createElement('li');
  li.append(el('span', 'k', k));
  li.append(el('span', mono ? 'v mono' : 'v', v));
  return li;
}

function clearAllOnce() {
  for (const n of mount.querySelectorAll('.once-mount')) n.textContent = '';
}

async function authedFetch(url, init) {
  const token = await idToken();
  if (!token) return { authLapsed: true };
  const headers = { authorization: `Bearer ${token}`, ...(init && init.headers) };
  try {
    return { res: await fetch(url, { ...init, headers }) };
  } catch {
    return { networkError: true };
  }
}

/** The show-once panel. Built at mint time; the value lives only in this node. */
function showOnce(host, data) {
  host.textContent = '';
  const box = el('div', 'once-box');
  box.append(el('p', 'once-h', 'Copy this now — it is never shown again.'));

  const val = el('code', 'once-val', data.env_line || data.token);
  val.setAttribute('tabindex', '-1');
  box.append(val);

  const actions = el('div', 'once-actions');
  const copyBtn = el('button', 'btn', 'Copy the line');
  copyBtn.type = 'button';
  const note = el('span', 'key-status');
  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(val.textContent);
      note.textContent = 'Copied.';
      note.dataset.tone = 'ok';
    } catch {
      // Clipboard can be refused. Selecting it beats saying "failed" and stopping.
      const r = document.createRange();
      r.selectNodeContents(val);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
      note.textContent = 'Could not copy automatically — it is selected, press Ctrl/Cmd+C.';
      note.dataset.tone = 'err';
    }
  });

  const done = el('button', 'linkbtn', 'I have saved it — hide');
  done.type = 'button';
  done.addEventListener('click', () => { host.textContent = ''; loadKeys(); });

  actions.append(copyBtn, done, note);
  box.append(actions);

  box.append(el('p', 'key-body', data.previous_valid_until
    ? `The previous key keeps working until ${when(data.previous_valid_until)}, so nothing breaks if this paste goes wrong.`
    : 'Any previous key has been revoked immediately.'));

  host.append(box);
  val.focus();
}

function renderSelfService(card, key) {
  // ⚠️ NO DESCRIPTIVE TEXT HERE. What the key is, what it can do and where it
  // lives are all in Info above; repeating them beside the button turned the
  // control into a paragraph somebody had to read past to find the control.
  // Only the facts you need to ACT survive: is there a key, and is it working.
  const facts = el('ul', 'key-facts');
  const t = key.token;
  const rotating = Boolean(t && t.exists);

  if (!rotating) {
    facts.append(factRow('Status', key.legacy_present
      ? 'running on the original hand-installed key'
      : 'no key yet'));
  } else {
    facts.append(factRow('Key', `${t.fingerprint}…`, true));
    // The one diagnostic worth the space: it is how you tell an install that
    // took from one that silently did not.
    facts.append(factRow('Last used', t.last_used_at
      ? `${when(t.last_used_at)} (${ago(t.last_used_at)})`
      : 'never'));
    if (t.previous_valid_until) {
      facts.append(factRow('Previous key',
        `${t.previous_fingerprint}… valid until ${when(t.previous_valid_until)}`, true));
    }
  }
  card.append(facts);

  const actions = el('div', 'key-actions');
  const gen = el('button', 'btn', rotating ? 'Regenerate' : 'Generate');
  gen.type = 'button';

  const revokeWrap = el('label', 'key-revoke');
  const revoke = document.createElement('input');
  revoke.type = 'checkbox';
  revokeWrap.append(revoke, document.createTextNode(' Kill the old key immediately'));
  revokeWrap.hidden = !rotating;

  const status = el('span', 'key-status');
  actions.append(gen, revokeWrap, status);
  card.append(actions);

  const onceHost = el('div', 'once-mount');
  card.append(onceHost);

  gen.addEventListener('click', async () => {
    if (rotating && revoke.checked) {
      const ok = window.confirm(
        `Kill the old ${key.label} key immediately?

` +
        'Whatever is using it stops working the moment you continue, until the ' +
        'new key is installed there. Use this only if you think the old key leaked.',
      );
      if (!ok) return;
    }
    gen.disabled = true;
    status.textContent = rotating ? 'Rotating…' : 'Generating…';
    status.dataset.tone = '';
    onceHost.textContent = '';

    const r = await authedFetch(`${KEYS_URL}/${encodeURIComponent(key.id)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ revoke_now: revoke.checked }),
    });
    gen.disabled = false;

    if (r.authLapsed) { status.textContent = 'Sign-in lapsed — sign in again, then retry.'; status.dataset.tone = 'err'; return; }
    if (r.networkError) {
      // ⚠️ Genuinely ambiguous: the key may or may not exist now. Say so.
      status.textContent = 'Could not reach the key service. Reload before trying again — the key may have been created.';
      status.dataset.tone = 'err';
      return;
    }
    if (r.res.status === 401 || r.res.status === 403) {
      status.textContent = 'Only devops accounts can generate keys. Ask Skylar for the devops role.';
      status.dataset.tone = 'err';
      return;
    }
    let data = null;
    try { data = await r.res.json(); } catch { /* handled below */ }
    if (!r.res.ok) {
      status.textContent = (data && data.detail) || 'The key was not created. Try again shortly.';
      status.dataset.tone = 'err';
      return;
    }
    if (!data || typeof data.token !== 'string' || !data.token) {
      status.textContent = 'The key was created but the answer was unreadable — reload and check the fingerprint before generating another.';
      status.dataset.tone = 'err';
      return;
    }
    status.textContent = rotating ? 'Rotated.' : 'Created.';
    status.dataset.tone = 'ok';
    showOnce(onceHost, data);
  });
}

/**
 * An Info entry: what a credential IS, where it comes from, and how it rotates.
 *
 * ⚠️ <details> WITHOUT `open`, deliberately. Everything starts collapsed so
 * the section reads as an index of what exists; seven expanded reference cards
 * is a wall, and a wall gets skimmed rather than read. Native <details> means
 * collapsing needs no JS and keeps working if this script fails.
 *
 * ⚠️ EVERY key gets one, including the three with buttons. The owner asked
 * for "where we get all our tokens from and how to rotate them" — a reference
 * covering only the awkward ones would not tell anybody that the self-service
 * three are minted from CSPRNG in the Worker, which is the fact that explains
 * why they cannot be looked up afterwards.
 */
function renderInfo(key) {
  const card = document.createElement('details');
  card.className = 'key-card';

  const sum = document.createElement('summary');
  sum.append(el('strong', null, key.label));
  sum.append(el('span', 'key-tag', key.mode === 'self-service'
    ? 'rotate below'
    : key.mode === 'paired' ? 'rotate by hand — two sides' : 'rotate by hand — console'));
  card.append(sum);

  const facts = el('ul', 'key-facts');
  facts.append(factRow('What it is', key.body));
  facts.append(factRow('Comes from', key.origin || 'not recorded'));
  facts.append(factRow('Lives at', key.livesAt));
  facts.append(factRow('If it leaks', key.blast));
  facts.append(factRow('Rotate', key.rotateHow || 'not recorded'));
  if (key.manualWhy) facts.append(factRow('No button because', key.manualWhy));
  card.append(facts);

  if (key.manualFix) card.append(el('pre', 'cmd', key.manualFix));
  return card;
}

/** A control card. Only ever built for self-service keys — see loadKeys(). */
function renderKey(key) {
  const card = el('div', 'key-card');

  const head = el('div', 'key-head');
  head.append(el('h3', null, key.label));
  head.append(el('span', 'key-tag', key.tag));
  card.append(head);

  if (key.corrupt) {
    // Must never read as "no key yet" — that would look like a fresh install.
    const bad = el('p', 'key-status', 'The stored record for this key is unreadable. Do not generate over it before someone looks — tell Skylar.');
    bad.dataset.tone = 'err';
    card.append(bad);
    return card;
  }

  renderSelfService(card, key);
  return card;
}

async function loadKeys() {
  setPageStatus('Loading…', '');
  const r = await authedFetch(KEYS_URL);
  if (r.authLapsed) { setPageStatus('Sign-in lapsed — sign in again.', 'err'); return; }
  if (r.networkError) { setPageStatus('Could not reach the key service (network). Try again shortly.', 'err'); return; }
  if (r.res.status === 401 || r.res.status === 403) {
    setPageStatus('Only devops accounts can manage keys. Ask Skylar for the devops role.', 'err');
    return;
  }
  if (!r.res.ok) { setPageStatus('Could not read the key registry. Try again shortly.', 'err'); return; }

  let data;
  try { data = await r.res.json(); } catch { setPageStatus('The answer was unreadable.', 'err'); return; }
  if (!data || !Array.isArray(data.keys)) { setPageStatus('The answer carried no keys.', 'err'); return; }

  // ⚠️ THE TOP LIST IS ONLY WHAT SOMEBODY CAN ACT ON HERE. Mixing in the four
  // that have no button made the page read as a wall of caveats and buried the
  // three controls that actually do something. The other four are not dropped
  // — dropping them would make the inventory a liar by silence — they move to
  // Info, in full, alongside every key's provenance and rotation procedure.
  mount.textContent = '';
  const actionable = data.keys.filter((k) => k.mode === 'self-service');
  for (const key of actionable) mount.append(renderKey(key));
  if (!actionable.length) {
    mount.append(el('p', 'key-body', 'No key on this page can be minted here. See Info below.'));
  }

  infoMount.textContent = '';
  for (const key of data.keys) infoMount.append(renderInfo(key));
  setPageStatus('', '');
}

mountGate({
  // Both sections gate together — Info describes credentials and names where
  // they live, which is not public information either.
  sections: [infoSection, section],
  onAllowed: loadKeys,
  onDenied: () => {
    // The gate closing must take any minted credential off the screen with it.
    clearAllOnce();
    mount.textContent = '';
    infoMount.textContent = '';
    setPageStatus('', '');
  },
});
