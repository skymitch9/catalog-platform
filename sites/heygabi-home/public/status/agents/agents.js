/**
 * agents.js — /status/agents, CLAUDE CAPACITY.
 *
 * Renders three blocks out of ONE pushed JSON blob: the agents running now,
 * the dispatched/landed/failed feed, and the usage figures. The blob arrives
 * from `GET /api/estate/ops/agent-board` (requireDevops()); the conductor
 * POSTs it with `scripts/push-agent-board.mjs`. The contract is
 * docs/info/agent-board-contract.md — a DOC, not a schema, and this file's
 * tolerance is the other half of that decision (see below).
 *
 * ⚠️ RENDER WHAT IS THERE, NAME WHAT IS NOT. Every field is read defensively
 * and every missing one degrades to a worded line rather than to `undefined`
 * or to a hopeful blank. That is not politeness: the pusher on the other end
 * does not exist for `processing` yet and will grow fields for `agents` over
 * time, so a renderer that threw on an unfamiliar board would take the page
 * down for a push that was perfectly correct.
 *
 * ⚠️ EVERY NODE IS BUILT WITH textContent. Agent names and task lines are free
 * text from another machine; /docs already carries a `mustNotContain: ".innerHTML ="`
 * pin for exactly this reason and this page earns the same one.
 *
 * ⚠️ WHAT THIS PAGE DELIBERATELY DOES NOT DO: judge. It does not decide an
 * agent has hung, does not compute a burn rate, and does not colour a usage
 * tile from a threshold it invented — the tile tones come from percentages the
 * conductor measured, against the estate's own written thresholds. A status
 * surface that guesses is a status surface nobody can act on.
 */

import { AUTH_ORIGIN, TICK_INTERVAL_MS, el, sayEmpty } from '../lib/core.js';
import { mountGate } from '../lib/gate.js';
import {
  BOARD_POLL_MS,
  ageOf,
  arraySection,
  fetchBoard,
  renderFreshness,
  str,
} from '../lib/board.js';
import { idToken } from '../../assets/estate-auth.js';

/**
 * The board sections THIS page renders — the freshness strip is measured
 * against these and nothing else.
 *
 * ⚠️ WITHOUT THIS THE STRIP LIED, and the contract's §9 said so in writing
 * before it was fixed: one D1 row, two pushers, each writing the board whole,
 * so the board-wide `pushed_at` moved every 15 minutes when the processing
 * pusher ran — and this page reported "as of 2 minutes ago" over agent rows the
 * conductor had not touched for hours. The Worker now stamps each section from
 * its own clock (migration 0013) and the strip reads the OLDEST of these.
 */
const PAGE_SECTIONS = ['agents', 'events', 'usage'];

const freshEl = document.getElementById('board-fresh');
const agentListEl = document.getElementById('agent-rows');
const eventListEl = document.getElementById('event-rows');
const usageEl = document.getElementById('usage-block');
const prefsEl = document.getElementById('notify-prefs');

/** The last SUCCESSFUL read, kept whole. Two jobs: a failed poll can say how
 *  old the picture on screen is instead of pretending there is none, and the
 *  5-second ticker can re-word the age without re-fetching — including the
 *  "pushed by" name, which a bare timestamp would drop. */
let lastGood = null;

// ---------------------------------------------------------------------------
// Running agents
// ---------------------------------------------------------------------------

/**
 * The four states the dot understands. Anything else renders grey with its own
 * word shown verbatim — an unknown state is information ("the conductor is
 * saying something new"), not an error, and flattening it to "unknown" would
 * throw that away.
 */
const KNOWN_AGENT_STATES = new Set(['running', 'queued', 'landed', 'failed']);

function renderAgents(list, nowMs) {
  if (!agentListEl) return;
  if (!list.length) {
    // ⚠️ "No agents running" is a GOOD state and must not look like a failure —
    // but it must also be distinguishable from "we could not read the board",
    // which the freshness strip above is what settles.
    sayEmpty(agentListEl, 'No agents are running right now, according to the last push.');
    return;
  }
  agentListEl.replaceChildren();
  for (const raw of list) {
    const a = raw && typeof raw === 'object' ? raw : {};
    const state = str(a.state) || 'unknown';

    const li = el('li', 'agent-row');
    li.dataset.state = KNOWN_AGENT_STATES.has(state) ? state : 'unknown';
    li.append(el('span', 'dot'));
    li.lastChild.setAttribute('aria-hidden', 'true');

    const body = el('div', 'agent-body');
    const head = el('div', 'agent-head');
    head.append(el('span', 'agent-name', str(a.name) || str(a.id) || 'unnamed agent'));
    head.append(el('span', 'badge', state));
    if (str(a.model)) head.append(el('span', 'badge', str(a.model)));
    body.append(head);

    if (str(a.task)) body.append(el('p', 'agent-task', str(a.task)));

    // ⚠️ "started 40m ago" and nothing else: this page never converts an age
    // into a verdict ("probably stuck"). The conductor knows what a long run
    // means for a given task; a browser does not.
    const started = ageOf(a.started_at, nowMs);
    const bits = [];
    if (started) bits.push(`started ${started}`);
    if (str(a.id)) bits.push(`id ${str(a.id)}`);
    if (Number.isFinite(Number(a.tokens))) bits.push(`${Number(a.tokens).toLocaleString()} tokens`);
    if (bits.length) body.append(el('p', 'agent-meta', bits.join(' · ')));
    else if (!str(a.started_at)) {
      // A missing start time is worth SAYING, because "how long has this been
      // going" is the single question a running-agent row exists to answer.
      body.append(el('p', 'agent-meta', 'no start time in the push'));
    }

    li.append(body);
    agentListEl.append(li);
  }
}

// ---------------------------------------------------------------------------
// The event feed
// ---------------------------------------------------------------------------

const KNOWN_EVENT_KINDS = new Set(['dispatched', 'landed', 'failed', 'killed']);

/**
 * ⚠️ SORTED NEWEST-FIRST HERE, not trusted from the push. The owner asked for
 * newest first; a pusher that appends will hand this the opposite order, and a
 * feed that silently rendered oldest-first would look like nothing had
 * happened all day. Rows with no readable timestamp sink to the bottom rather
 * than being dropped — an event that happened is worth showing even when its
 * clock is missing.
 */
function sortNewestFirst(events) {
  return [...events].sort((x, y) => {
    const a = Date.parse(str(x && x.at));
    const b = Date.parse(str(y && y.at));
    if (!Number.isFinite(a) && !Number.isFinite(b)) return 0;
    if (!Number.isFinite(a)) return 1;
    if (!Number.isFinite(b)) return -1;
    return b - a;
  });
}

function renderEvents(list, nowMs) {
  if (!eventListEl) return;
  if (!list.length) {
    sayEmpty(eventListEl, 'The last push carried no events.');
    return;
  }
  eventListEl.replaceChildren();
  for (const raw of sortNewestFirst(list)) {
    const e = raw && typeof raw === 'object' ? raw : {};
    const kind = str(e.kind) || 'event';
    const li = el('li', 'feed-row');
    li.dataset.kind = KNOWN_EVENT_KINDS.has(kind) ? kind : 'event';

    const when = ageOf(e.at, nowMs);
    li.append(el('span', 'feed-when', when || 'no time'));
    li.append(el('span', 'badge', kind));

    const who = str(e.agent);
    const what = str(e.detail);
    li.append(el('span', 'feed-what', [who, what].filter(Boolean).join(' — ') || '(no detail)'));
    eventListEl.append(li);
  }
}

// ---------------------------------------------------------------------------
// The usage figures
// ---------------------------------------------------------------------------

/**
 * The three meters, in the order the estate's own rules name them.
 *
 * ⚠️ THE THRESHOLDS ARE THE ESTATE'S WRITTEN ONES, NOT INVENTED HERE, and they
 * differ per meter on purpose — that difference is the whole point of the rule
 * they come from. Session pauses at 89%; weekly stops new agents at 93% and
 * keeps conversational work to 97%, because a session reset costs a nap and
 * the weekly reset costs days. A single shared threshold across all three
 * would quietly throw that distinction away, which is the mistake the rule was
 * written to correct.
 */
const USAGE_METERS = [
  { key: 'session_pct', label: 'Session', amber: 80, red: 89, resets: 'session_resets' },
  { key: 'weekly_pct', label: 'Weekly (all models)', amber: 88, red: 93, resets: 'weekly_resets' },
  // ⚠️ Fable is a WEEKLY pool and shares the weekly reset. It gets its own tile
  // because it can be exhausted while all-models is fine, which changes which
  // MODEL is safe to run rather than whether to run at all.
  { key: 'fable_pct', label: 'Fable', amber: 88, red: 93, resets: 'weekly_resets' },
  // Credits are MONEY, not a rate limit: nothing stops when they run out, the
  // overage simply costs. So they warn late and never claim to be a blocker.
  // Added 2026-08-21 on the owner's ask ("Add credit usage to the website too").
  { key: 'credits_pct', label: 'Credits', amber: 90, red: 99, resets: 'credits_resets' },
];

function usageTone(pct, meter) {
  if (!Number.isFinite(pct)) return '';
  if (pct >= meter.red) return 'danger';
  if (pct >= meter.amber) return 'warn';
  return '';
}

function renderUsage(usage, nowMs) {
  if (!usageEl) return;
  usageEl.replaceChildren();

  if (!usage) {
    // ⚠️ A MISSING USAGE BLOCK IS NOT 0%. Rendering three empty meters would
    // read as "plenty of budget", which is the most expensive wrong answer
    // this page could give.
    const p = el('p', 'empty-say', 'The last push carried no usage figures — the budget is unknown from here, not fine.');
    usageEl.append(p);
    return;
  }

  const grid = el('div', 'usage-grid');
  for (const meter of USAGE_METERS) {
    const pct = Number(usage[meter.key]);
    const tile = el('div', 'usage-tile');
    const tone = usageTone(pct, meter);
    if (tone) tile.dataset.tone = tone;

    tile.append(el('div', 'usage-label', meter.label));
    tile.append(el('p', 'usage-value', Number.isFinite(pct) ? `${pct}%` : '—'));

    const bar = el('div', 'usage-bar');
    const fill = el('span', 'usage-fill');
    fill.style.width = `${Number.isFinite(pct) ? Math.max(0, Math.min(100, pct)) : 0}%`;
    bar.append(fill);
    tile.append(bar);

    // ⚠️ VERBATIM, never reformatted. The reporter copies the reset label
    // straight off claude.ai ("Resets Sun 4:00 PM", "Resets in 33 min"), and a
    // reworded copy is one somebody has to reconcile against the source.
    const resetAge = str(usage[meter.resets]);
    tile.append(
      el(
        'p',
        'usage-sub',
        Number.isFinite(pct)
          ? resetAge || `pause at ${meter.red}%`
          : 'not in the last push',
      ),
    );
    grid.append(tile);
  }
  usageEl.append(grid);

  const cents = Number(usage.credits_spent_cents);
  if (Number.isFinite(cents)) {
    usageEl.append(el('p', 'usage-sub', `$${(cents / 100).toFixed(2)} spent against the credit pool.`));
  }

  // ⚠️ THE READ-AT LINE IS MANDATORY AND IS ITS OWN CLOCK. The board's push
  // age says when the snapshot was published; THIS says when the numbers
  // inside it were actually read off the usage page, and the two can differ by
  // hours if a push carried a figure taken earlier. A percentage whose age is
  // unknown is not a reportable figure — the estate's own rule, on the surface
  // that rule was written for.
  const readAt = str(usage.received_at) || str(usage.read_at);
  const age = ageOf(readAt, nowMs);
  usageEl.append(
    el(
      'p',
      'section-note',
      age
        ? `Figures read ${age}${str(usage.note) ? ` · ${str(usage.note)}` : ''}`
        : '⚠️ These figures carry no read-at timestamp, so their age is unknown — treat them as stale until the next reading stamps one.',
    ),
  );
}

/**
 * THE BUDGET READING — fetched from its own endpoint, not from the agent board.
 *
 * ⚠️ WHY THIS IS A SEPARATE FETCH, AND WHY IT MUST STAY ONE. Until
 * 2026-08-21 these tiles rendered `board.usage`, a section of the conductor's
 * agent-board push — which meant the figures only refreshed when somebody
 * pushed a BOARD. Measured that day: this page, the one whose whole job is
 * Claude capacity, was showing figures **2 days 2 hours old** while the numbers
 * themselves were minutes old. The page was honest about the age (that is why
 * it was caught) and still useless.
 *
 * `GET /api/estate/claude/usage` is now the single source: written by
 * `scripts/report-claude-usage.mjs` the moment a session reads the meters,
 * validated (whole percent only), and stale-after-3h in the Worker rather than
 * here.
 *
 * ⚠️ `board.usage` is DEPRECATED and deliberately no longer read. Do not add
 * a fallback to it — a fallback is how two sources survive, and two sources of
 * one number is what produced the stale reading in the first place.
 */
async function loadUsage(nowMs) {
  const token = await idToken();
  if (!token) return; // the gate retries on the next auth event
  let res;
  try {
    res = await fetch(`${AUTH_ORIGIN}/api/estate/claude/usage`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    renderUsage(null, nowMs);
    return;
  }
  if (!res.ok) {
    // ⚠️ Every failure path lands on renderUsage(null), which says the budget
    // is UNKNOWN rather than drawing empty meters. Empty meters read as
    // "plenty left", which is the most expensive wrong answer this page can
    // give.
    renderUsage(null, nowMs);
    return;
  }
  let body;
  try {
    body = await res.json();
  } catch {
    renderUsage(null, nowMs);
    return;
  }
  // The Worker owns staleness: `unknown`/`never_reported` carry no usable
  // report, and rendering one would be rendering a number the server has
  // already judged untrustworthy.
  const usable = body && body.report && body.state !== 'never_reported' && body.state !== 'unknown';
  renderUsage(usable ? body.report : null, nowMs);
  if (!usable && usageEl && body && body.detail) {
    usageEl.append(el('p', 'section-note', String(body.detail)));
  }
}

// ---------------------------------------------------------------------------
// Notification preferences (owner ask 2026-08-18, item 7)
//
// ⚠️ THE ONLY CONTROL ON THIS PAGE, AND THE ONLY ONE THAT SHOULD BE. Every
// other block here is a machine-pushed reading; a browser rewriting one would
// be lying to the owner about his own estate. Preferences are the exception
// because they flow the other way: he decides, the conductor obeys.
//
// ⚠️ THEY ARE NOT IN THE PUSHED BOARD, deliberately. The board is one
// last-write-wins blob written by machines every 15 minutes, so a preference
// stored there would be silently overwritten by the next push — and the write
// door would have to be the conductor's machine token, which must never reach a
// page. They live in their own table behind their own doors.
//
// ⚠️ THE CLASSES AND THEIR WORDING COME FROM THE SERVER. A label that lives
// here while the behaviour lives in the conductor is two things that drift, and
// the owner then switches off something that does not do what its label says.
// ---------------------------------------------------------------------------

const PREFS_URL = `${AUTH_ORIGIN}/api/estate/ops/notify-prefs`;

let prefsState = null;
let prefsSaving = false;

function setPrefsNote(text, tone) {
  if (!prefsEl) return;
  let note = prefsEl.querySelector('.prefs-note');
  if (!note) {
    note = el('p', 'section-note prefs-note');
    prefsEl.append(note);
  }
  note.textContent = text;
  if (tone) note.dataset.tone = tone; else delete note.dataset.tone;
}

function renderPrefs() {
  if (!prefsEl) return;
  prefsEl.replaceChildren();

  if (!prefsState) {
    prefsEl.append(el('p', 'empty-say', 'Notification preferences could not be read — see the note below.'));
    return;
  }
  const classes = Array.isArray(prefsState.classes) ? prefsState.classes : [];
  if (!classes.length) {
    prefsEl.append(el('p', 'empty-say', 'The estate reported no notification classes, so there is nothing to choose between.'));
    return;
  }

  const list = el('ul', 'prefs-list');
  for (const cls of classes) {
    const on = Boolean(prefsState.prefs && prefsState.prefs[cls.key]);
    const li = el('li', 'prefs-row');

    const label = document.createElement('label');
    label.className = 'prefs-label';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = on;
    box.disabled = prefsSaving;
    box.addEventListener('change', () => savePref(cls.key, box.checked));
    label.append(box);
    label.append(el('span', 'prefs-name', cls.label || cls.key));
    li.append(label);
    // ⚠️ Every toggle says what it MEANS. A switch whose effect a reader has
    // to guess at gets guessed at wrongly, and this one decides what wakes him.
    if (cls.detail) li.append(el('p', 'prefs-detail', cls.detail));
    list.append(li);
  }
  prefsEl.append(list);

  // ⚠️ "Nobody has chosen yet" is DIFFERENT from "he chose these", and the
  // page says which. A default presented as a decision is a decision nobody
  // made — and here that would mean believing he had opted out of something.
  const who = str(prefsState.updated_by);
  const when = ageOf(prefsState.updated_at, Date.now());
  setPrefsNote(
    prefsState.configured
      ? `Set${who ? ` by ${who}` : ''}${when ? ` ${when}` : ''}. The conductor reads this each time it checks in.`
      : 'Nobody has chosen yet — these are the estate’s defaults: tell me when something breaks, stay quiet otherwise.',
  );
}

async function loadPrefs() {
  if (!prefsEl) return;
  let res;
  try {
    res = await fetch(PREFS_URL, { headers: { Authorization: `Bearer ${await idToken()}` }, cache: 'no-store' });
  } catch {
    prefsState = null;
    renderPrefs();
    setPrefsNote('The auth Worker did not answer, so your notification choices could not be read. Nothing was changed.', 'danger');
    return;
  }
  if (!res.ok) {
    prefsState = null;
    renderPrefs();
    // ⚠️ A permission refusal and an outage get different words — the estate's
    // standing rule. Mislabelling an outage sends someone asking for access
    // they already hold.
    setPrefsNote(
      res.status === 401 || res.status === 403
        ? 'This account is not allowed to change notification settings. An admin can grant devops from /admin.'
        : `The preferences endpoint answered HTTP ${res.status}, so your choices could not be read.`,
      'danger',
    );
    return;
  }
  prefsState = await res.json().catch(() => null);
  renderPrefs();
}

async function savePref(key, value) {
  if (!prefsState || prefsSaving) return;
  const previous = Boolean(prefsState.prefs[key]);
  prefsSaving = true;
  // Optimistic, but the note says it is IN FLIGHT — a toggle that flips and
  // then silently reverts on a failed save is how a setting gets believed.
  prefsState.prefs[key] = value;
  renderPrefs();
  setPrefsNote('Saving\u2026');

  let res;
  try {
    res = await fetch(PREFS_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await idToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(prefsState.prefs),
    });
  } catch {
    prefsState.prefs[key] = previous;
    prefsSaving = false;
    renderPrefs();
    setPrefsNote('The auth Worker did not answer — nothing was saved, and the switch has been put back.', 'danger');
    return;
  }
  prefsSaving = false;
  if (!res.ok) {
    // ⚠️ PUT BACK WHAT HE SEES to match what is STORED. Leaving the new
    // position on screen after a failed save is the worst outcome available:
    // he believes he has turned an alert on, and it is off.
    prefsState.prefs[key] = previous;
    const body = await res.json().catch(() => null);
    renderPrefs();
    setPrefsNote(
      res.status === 401 || res.status === 403
        ? 'You are not allowed to change these. Nothing was saved and the switch has been put back.'
        : `${body?.detail || `The estate refused the change (HTTP ${res.status}).`} Nothing was saved and the switch has been put back.`,
      'danger',
    );
    return;
  }
  prefsState = await res.json().catch(() => prefsState);
  renderPrefs();
}

// ---------------------------------------------------------------------------
// The poll
// ---------------------------------------------------------------------------

let polling = false;

async function refreshBoard() {
  if (polling) return;
  polling = true;
  try {
    const now = Date.now();
    const result = await fetchBoard(await idToken());
    renderFreshness(freshEl, result, lastGood?.pushedAt ?? null, now, PAGE_SECTIONS);

    if (result.status !== 'ok') {
      // ⚠️ THE LISTS ARE LEFT EXACTLY AS THEY WERE. Blanking them on a failed
      // poll would read as "every agent stopped"; the freshness strip above has
      // already said, in words, that what is on screen is not current. The one
      // case that gets a written list is the never-pushed one, where there is
      // genuinely nothing behind the failure to preserve.
      if (result.status === 'never') {
        sayEmpty(agentListEl, 'Nothing has been pushed to the agent board yet, so there is nothing to show — not "no agents".');
        sayEmpty(eventListEl, 'No events yet — the conductor has not pushed a board.');
        loadUsage(now);
      }
      return;
    }

    lastGood = result;
    renderAgents(arraySection(result.board, 'agents'), now);
    renderEvents(arraySection(result.board, 'events'), now);
    loadUsage(now);
  } finally {
    polling = false;
  }
}

const agentsSectionEl = document.getElementById('agents-section');

const gate = mountGate({
  sections: [agentsSectionEl],
  onAllowed: () => { refreshBoard(); loadPrefs(); },
});

// The owner's ask: a 30-second poll. Visible tabs only — a backgrounded tab
// learns nothing by asking, and the visibilitychange handler makes returning
// to the tab an immediate re-read rather than a wait of up to 30 seconds.
setInterval(() => {
  if (!document.hidden && gate.isAllowed()) refreshBoard();
}, BOARD_POLL_MS);

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && gate.isAllowed()) refreshBoard();
});

// The freshness strip re-words itself between polls for the same reason every
// other age on this estate does: "as of 29 seconds ago" must not still say so
// two minutes later because a fetch happened not to land.
setInterval(() => {
  if (lastGood && freshEl) renderFreshness(freshEl, lastGood, lastGood.pushedAt, Date.now(), PAGE_SECTIONS);
}, TICK_INTERVAL_MS);
