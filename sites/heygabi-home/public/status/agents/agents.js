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

import { TICK_INTERVAL_MS, el, sayEmpty } from '../lib/core.js';
import { mountGate } from '../lib/gate.js';
import {
  BOARD_POLL_MS,
  ageOf,
  arraySection,
  fetchBoard,
  objectSection,
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
  { key: 'session_pct', label: 'Session', amber: 80, red: 89 },
  { key: 'weekly_pct', label: 'Weekly (all models)', amber: 88, red: 93 },
  { key: 'fable_pct', label: 'Fable', amber: 88, red: 93 },
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

    const resets = str(usage[meter.key.replace('_pct', '_resets_at')]);
    const resetAge = resets && Number.isFinite(Date.parse(resets))
      ? `resets ${new Date(Date.parse(resets)).toLocaleString()}`
      : '';
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

  // ⚠️ THE READ-AT LINE IS MANDATORY AND IS ITS OWN CLOCK. The board's push
  // age says when the snapshot was published; THIS says when the numbers
  // inside it were actually read off the usage page, and the two can differ by
  // hours if a push carried a figure taken earlier. A percentage whose age is
  // unknown is not a reportable figure — the estate's own rule, on the surface
  // that rule was written for.
  const readAt = str(usage.read_at);
  const age = ageOf(readAt, nowMs);
  usageEl.append(
    el(
      'p',
      'section-note',
      age
        ? `Figures read ${age}${str(usage.note) ? ` · ${str(usage.note)}` : ''}`
        : '⚠️ These figures carry no read-at timestamp, so their age is unknown — treat them as stale until the next push stamps one.',
    ),
  );
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
        renderUsage(null, now);
      }
      return;
    }

    lastGood = result;
    renderAgents(arraySection(result.board, 'agents'), now);
    renderEvents(arraySection(result.board, 'events'), now);
    renderUsage(objectSection(result.board, 'usage'), now);
  } finally {
    polling = false;
  }
}

const agentsSectionEl = document.getElementById('agents-section');

const gate = mountGate({
  sections: [agentsSectionEl],
  onAllowed: () => { refreshBoard(); },
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
