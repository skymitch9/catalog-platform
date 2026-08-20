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
const mount = document.getElementById('keys-mount');
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

function factRow(k, v, mono, pre) {
  const li = document.createElement('li');
  li.append(el('span', 'k', k));
  // `pre` keeps multi-line install blocks readable without touching innerHTML.
  li.append(el('span', pre ? 'v pre' : mono ? 'v mono' : 'v', v));
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
  const t = key.token;
  const active = (t && t.active) || [];
  const rotating = active.length > 0;

  if (!rotating) {
    const facts = el('ul', 'key-facts key-state');
    facts.append(factRow('Status', key.legacy_present
      ? 'running on the original hand-installed key'
      : 'no key yet'));
    card.append(facts);
  } else {
    // ONE ROW PER KEY THAT WORKS RIGHT NOW, each with its own revoke.
    // Rotation used to be the only way to kill anything, and it cannot kill the
    // CURRENT key -- every rotate mints a new one -- so a key created by mistake
    // could only ever be replaced, never removed. That is the gap this closes.
    for (const k of active) {
      card.append(activeKeyRow(key, k, active.length));
    }
  }

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
    // NOTHING HERE IS ONE CLICK (owner rule). A mis-click on a row of lookalike
    // buttons must cost a dialog, not a rotation -- and the dialog NAMES THE KEY,
    // because an unnamed "are you sure?" on the wrong card confirms the wrong thing.
    const killNow = rotating && revoke.checked;
    const prompt = killNow
      ? 'Kill the old ' + key.label + ' key immediately?\n\n'
        + 'Whatever is using it stops working the moment you continue, until the new '
        + 'key is installed at:\n  ' + key.livesAt + '\n\nUse this only if you think it leaked.'
      : rotating
        ? 'Rotate the ' + key.label + ' key?\n\n'
          + 'A new value is generated and shown ONCE. The current key keeps working for '
          + '24 hours, so install the new one at:\n  ' + key.livesAt + '\n\nbefore then.'
        : 'Generate a key for ' + key.label + '?\n\n'
          + 'The value is shown ONCE and cannot be looked up afterwards by anyone. '
          + 'You will need to install it at:\n  ' + key.livesAt;
    if (!window.confirm(prompt)) return;

    gen.disabled = true;
    status.textContent = rotating ? 'Rotating...' : 'Generating...';
    status.dataset.tone = '';
    onceHost.textContent = '';

    const r = await authedFetch(KEYS_URL + '/' + encodeURIComponent(key.id), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ revoke_now: revoke.checked }),
    });
    gen.disabled = false;

    if (r.authLapsed) { status.textContent = 'Sign-in lapsed \u2014 sign in again, then retry.'; status.dataset.tone = 'err'; return; }
    if (r.networkError) {
      status.textContent = 'Could not reach the key service. Reload before trying again \u2014 the key may have been created.';
      status.dataset.tone = 'err';
      return;
    }
    if (r.res.status === 401 || r.res.status === 403) {
      status.textContent = 'Only devops accounts can generate keys. Ask Skylar for the devops role.';
      status.dataset.tone = 'err';
      return;
    }
    let data = null;
    try { data = await r.res.json(); } catch (e) { /* handled below */ }
    if (!r.res.ok) {
      status.textContent = (data && data.detail) || 'The key was not created. Try again shortly.';
      status.dataset.tone = 'err';
      return;
    }
    if (!data || typeof data.token !== 'string' || !data.token) {
      status.textContent = 'The key was created but the answer was unreadable \u2014 reload and check the fingerprint before generating another.';
      status.dataset.tone = 'err';
      return;
    }
    status.textContent = rotating ? 'Rotated.' : 'Created.';
    status.dataset.tone = 'ok';
    revoke.checked = false;
    showOnce(onceHost, data);
  });
}

/** One live key: what it is, how it has been used, and a way to kill just it. */
function activeKeyRow(key, k, activeCount) {
  const box = el('div', 'active-key');

  const line = el('div', 'active-line');
  line.append(el('code', 'akey-fp', k.fingerprint + '\u2026'));
  line.append(el('span', 'akey-slot', k.slot === 'current'
    ? 'current'
    : 'previous \u2014 valid until ' + when(k.valid_until)));
  box.append(line);

  const meta = el('ul', 'key-facts akey-meta');
  meta.append(factRow('Created', when(k.created_at) + ' by ' + k.created_by));
  meta.append(factRow('Last used', k.last_used_at
    ? when(k.last_used_at) + ' (' + ago(k.last_used_at) + ')'
    : 'never'));
  // Uses is the cheapest possible answer to "is anything still on this key?" --
  // the question that decides whether a rotation is safe to finish.
  meta.append(factRow('Uses', String(k.use_count)));
  box.append(meta);

  const kill = el('button', 'linkbtn danger', 'Revoke this key');
  kill.type = 'button';
  const kstatus = el('span', 'key-status');

  kill.addEventListener('click', async () => {
    const others = activeCount - 1;
    const tail = others > 0
      ? others + ' other key on this credential stays valid.'
      : key.legacy_present
        ? 'No minted key will remain \u2014 only the original hand-installed secret still works.'
        : 'NOTHING will be able to authenticate until you generate and install a new one.';
    const ok = window.confirm(
      'Revoke the ' + k.slot + ' ' + key.label + ' key (' + k.fingerprint + '\u2026)?\n\n'
      + 'It stops working immediately. ' + tail,
    );
    if (!ok) return;

    kill.disabled = true;
    kstatus.textContent = 'Revoking...';
    kstatus.dataset.tone = '';
    // POST, not DELETE: adminCors() allows GET/POST/OPTIONS, and a DELETE is
    // refused at the preflight before the Worker sees it.
    const r = await authedFetch(KEYS_URL + '/' + encodeURIComponent(key.id) + '/revoke', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slot: k.slot }),
    });
    kill.disabled = false;

    if (r.authLapsed) { kstatus.textContent = 'Sign-in lapsed \u2014 sign in again.'; kstatus.dataset.tone = 'err'; return; }
    if (r.networkError) {
      kstatus.textContent = 'Could not reach the key service. Reload before retrying \u2014 it may already be revoked.';
      kstatus.dataset.tone = 'err';
      return;
    }
    let d = null;
    try { d = await r.res.json(); } catch (e) { /* below */ }
    if (!r.res.ok) {
      kstatus.textContent = (d && d.detail) || 'That did not revoke. Try again shortly.';
      kstatus.dataset.tone = 'err';
      return;
    }
    loadKeys();
  });

  const acts = el('div', 'key-actions');
  acts.append(kill, kstatus);
  box.append(acts);
  return box;
}

/**
 * One card per credential, collapsed at its own header.
 *
 * ⚠️ THE CARD IS THE <details>, NOT SOMETHING INSIDE IT. This went through
 * two wrong shapes first: a separate reference section (you had to scroll
 * between a key and its own explanation, and a bank of lookalike buttons is
 * how the wrong credential gets rotated), then a collapsible info block nested
 * inside an always-open card (two levels of disclosure to reach one fact).
 * Now the header IS the control: closed, the page is a seven-line index of
 * what exists; open, you get everything about that one key — what it is, where
 * it comes from, how it rotates, its current state, and its button — with no
 * second thing to expand.
 *
 * Native <details> means collapsing needs no JS and survives this script
 * failing, and the button stays inside the card that explains it.
 */
function renderKey(key) {
  const card = document.createElement('details');
  card.className = 'key-card';

  const sum = document.createElement('summary');
  const h = document.createElement('h3');
  h.textContent = key.label;
  sum.append(h);
  sum.append(el('span', 'key-tag', key.mode === 'self-service'
    ? 'rotate here'
    : key.mode === 'paired' ? 'rotate by hand — two sides' : 'rotate by hand — console'));
  card.append(sum);

  // Always visible once the card is open — no second disclosure to click.
  const facts = el('ul', 'key-facts');
  facts.append(factRow('What it is', key.body));
  facts.append(factRow('Comes from', key.origin || 'not recorded'));
  facts.append(factRow('Lives at', key.livesAt));
  facts.append(factRow('If it leaks', key.blast));
  facts.append(factRow('Rotate', key.rotateHow || 'not recorded'));
  // PER-KEY, not one shared accordion. The shared one could only describe the
  // shelf server concretely and left the other two as an exercise, and generic
  // instructions for a specific credential are how a key lands in the wrong file.
  if (key.installHow) facts.append(factRow('Install it', key.installHow, false, true));
  if (key.manualWhy) facts.append(factRow('No button because', key.manualWhy));
  card.append(facts);

  if (key.manualFix) card.append(el('pre', 'cmd', key.manualFix));

  if (key.corrupt) {
    // Must never read as "no key yet" — that would look like a fresh install.
    const bad = el('p', 'key-status', 'The stored record for this key is unreadable. Do not generate over it before someone looks — tell Skylar.');
    bad.dataset.tone = 'err';
    card.append(bad);
    return card;
  }

  if (key.mode === 'self-service') renderSelfService(card, key);
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

  // Every key, in registry order (blast radius smallest first), each carrying
  // its own collapsed info and — where there is one — its own button.
  mount.textContent = '';
  for (const key of data.keys) mount.append(renderKey(key));
  setPageStatus('', '');
}

mountGate({
  sections: [section],
  onAllowed: loadKeys,
  onDenied: () => {
    // The gate closing must take any minted credential off the screen with it.
    clearAllOnce();
    mount.textContent = '';
    setPageStatus('', '');
  },
});
