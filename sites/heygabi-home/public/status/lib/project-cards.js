/**
 * status/lib/project-cards.js — every project's card on /status/agents.
 *
 * Owner ask 2026-09-26: *"port in all agents from all our projects … might be
 * nice to see live progress in the site"*. Each repo's session pushes its own
 * `project_<slug>` section (scripts/push-project-board.mjs); this draws one
 * card group per section with four panels — Progress, Stuck, Needs you,
 * Latest. The shape is docs/info/agent-board-contract.md §11.
 *
 * ⚠️ THE FOUR SILENCES, per project and per panel. A panel whose key is ABSENT
 * says the push did not say; a panel whose list is EMPTY says there is
 * genuinely nothing. A section that is not an object says it could not be
 * read. A board with no project sections at all says no project has pushed.
 * None of them ever renders as a blank.
 *
 * ⚠️ A DEFAULT IS SHOWN ONLY FOR A REVERSIBLE QUESTION. The owner's rule:
 * defaults are allowed only for choices that can be undone; anything public,
 * access-increasing or money says "waiting on you — no default" whatever the
 * push carried. A question with no `kind` is not known to be reversible, so it
 * gets no default either — erring toward "waiting on you" is the safe side.
 *
 * ⚠️ textContent ONLY, and a link is drawn only for an http(s) URL — every
 * string here is free text from another machine.
 *
 * Pure at import: no DOM lookups, no timers, so node tests can drive it with
 * scripts/test/helpers/stub-dom.mjs.
 */

import { el } from './core.js';
import { ageOf, str } from './board.js';

export const PROJECT_PREFIX = 'project_';
const PROJECT_KEY_RE = /^project_[a-z0-9-]{1,40}$/;
export const NO_DEFAULT_KINDS = new Set(['public', 'access', 'money']);
export const KNOWN_AGENT_STATES = new Set(['running', 'queued', 'landed', 'failed']);
export const DELIVERABLES_SHOWN = 5;

const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);

/** Every `project_*` key on the board, in a stable order: projects waiting on
 *  the owner first, then by name. */
export function projectEntries(board) {
  const b = obj(board) || {};
  const out = [];
  for (const key of Object.keys(b)) {
    if (!PROJECT_KEY_RE.test(key)) continue;
    const section = obj(b[key]);
    const slug = key.slice(PROJECT_PREFIX.length);
    out.push({
      key,
      slug,
      section,
      title: (section && str(section.name)) || slug,
      waiting: section && Array.isArray(section.questions) ? section.questions.length : 0,
    });
  }
  return out.sort((a, b) => (b.waiting > 0) - (a.waiting > 0) || a.title.localeCompare(b.title));
}

/** A link target, or '' when it is not a plain http(s) URL. */
export function safeUrl(v) {
  const s = str(v);
  return /^https?:\/\/[^\s]+$/i.test(s) ? s : '';
}

/**
 * What a question says about its default. `{ text, hasDefault }`.
 * Only `kind: "reversible"` with a non-empty `default` shows one.
 */
export function questionDefault(q) {
  const kind = str(q && q.kind).toLowerCase();
  const proposed = str(q && q.default);
  if (kind === 'reversible' && proposed) return { text: `If you don't answer: ${proposed}`, hasDefault: true };
  if (NO_DEFAULT_KINDS.has(kind)) {
    return { text: `Waiting on you — no default (${kind} choices never get one)`, hasDefault: false };
  }
  if (proposed) {
    return {
      text: 'Waiting on you — no default (one was proposed, but only a question marked reversible may have one)',
      hasDefault: false,
    };
  }
  return { text: 'Waiting on you — no default', hasDefault: false };
}

/**
 * "updated 4m ago" and which clock said so. The Worker's per-section stamp
 * wins; the push's own `updated_at` is the fallback and is NAMED as the
 * project's clock; neither → says so.
 */
export function updatedLine(stampIso, section, nowMs) {
  const byWorker = ageOf(stampIso, nowMs);
  if (byWorker) return { text: `updated ${byWorker}`, source: 'worker' };
  const byPush = ageOf(section && section.updated_at, nowMs);
  if (byPush) return { text: `updated ${byPush} — by the project's own clock; the board has no stamp for it`, source: 'push' };
  return { text: 'update time unknown — neither the board nor the push carried one', source: 'none' };
}

/** Newest first; rows with no readable time sink, never dropped. */
export function newestFirst(list, field) {
  return [...list].sort((x, y) => {
    const a = Date.parse(str(x && x[field]));
    const b = Date.parse(str(y && y[field]));
    if (!Number.isFinite(a) && !Number.isFinite(b)) return 0;
    if (!Number.isFinite(a)) return 1;
    if (!Number.isFinite(b)) return -1;
    return b - a;
  });
}

/** One agent as the page has always drawn it: dot, name, state and model
 *  badges, task, started-ago. Shared with the conductor's "Running now". */
export function agentRow(raw, nowMs) {
  const a = obj(raw) || {};
  const state = str(a.state) || 'unknown';
  const li = el('li', 'agent-row');
  li.dataset.state = KNOWN_AGENT_STATES.has(state) ? state : 'unknown';
  const dot = el('span', 'dot');
  dot.setAttribute('aria-hidden', 'true');
  li.append(dot);

  const body = el('div', 'agent-body');
  const head = el('div', 'agent-head');
  head.append(el('span', 'agent-name', str(a.name) || str(a.id) || 'unnamed agent'));
  head.append(el('span', 'badge', state));
  if (str(a.model)) head.append(el('span', 'badge', str(a.model)));
  const link = safeUrl(a.link);
  if (link) {
    const anchor = el('a', 'proj-link', 'open');
    anchor.setAttribute('href', link);
    anchor.setAttribute('rel', 'noopener');
    head.append(anchor);
  }
  body.append(head);
  if (str(a.task)) body.append(el('p', 'agent-task', str(a.task)));

  const started = ageOf(a.started_at, nowMs);
  const bits = [];
  if (started) bits.push(`started ${started}`);
  if (str(a.id)) bits.push(`id ${str(a.id)}`);
  if (typeof a.tokens === 'number' && Number.isFinite(a.tokens)) bits.push(`${a.tokens.toLocaleString()} tokens`);
  if (bits.length) body.append(el('p', 'agent-meta', bits.join(' · ')));
  else if (!str(a.started_at)) body.append(el('p', 'agent-meta', 'no start time in the push'));
  li.append(body);
  return li;
}

function panel(title, count, tone) {
  const box = el('section', 'proj-panel');
  if (tone) box.dataset.tone = tone;
  const h = el('h5', 'proj-panel-h', title);
  if (count > 0) h.append(el('span', 'proj-count', String(count)));
  box.append(h);
  return box;
}

/** The absent-vs-empty sentence for one list field, or null when it has rows. */
function listSilence(section, field, absent, empty) {
  if (!(field in section)) return absent;
  if (!Array.isArray(section[field])) return `This push's "${field}" is not a list, so it cannot be shown.`;
  return section[field].length ? null : empty;
}

function progressPanel(section, nowMs) {
  const list = Array.isArray(section.agents) ? section.agents : [];
  const box = panel('Progress', list.filter((a) => str(a && a.state) === 'running').length);
  const silence = listSilence(section, 'agents', 'The last push did not list agents.', 'Nothing running — the last push listed no agents.');
  if (silence) {
    box.append(el('p', 'empty-say', silence));
    return box;
  }
  const ul = el('ul', 'agent-list');
  for (const a of list) ul.append(agentRow(a, nowMs));
  box.append(ul);
  return box;
}

function stuckPanel(section, nowMs) {
  const list = Array.isArray(section.stuck) ? section.stuck : [];
  const box = panel('Stuck', list.length, list.length ? 'warn' : '');
  const silence = listSilence(section, 'stuck', 'The last push did not say whether anything is stuck.', 'Nothing stuck.');
  if (silence) {
    box.append(el('p', 'empty-say', silence));
    return box;
  }
  const ul = el('ul', 'proj-list');
  for (const raw of list) {
    const s = obj(raw) || {};
    const li = el('li', 'proj-item');
    li.append(el('p', 'proj-what', str(s.what) || '(no description)'));
    const since = ageOf(s.since, nowMs);
    const why = str(s.why);
    li.append(el('p', 'proj-meta', [since ? `since ${since}` : 'since unknown', why].filter(Boolean).join(' · ')));
    ul.append(li);
  }
  box.append(ul);
  return box;
}

function questionsPanel(section, nowMs) {
  const list = Array.isArray(section.questions) ? section.questions : [];
  const box = panel('Needs you', list.length, list.length ? 'accent' : '');
  const silence = listSilence(section, 'questions', 'The last push did not list questions.', 'Nothing waiting on you.');
  if (silence) {
    box.append(el('p', 'empty-say', silence));
    return box;
  }
  const ul = el('ul', 'proj-list');
  for (const raw of list) {
    const q = obj(raw) || {};
    const li = el('li', 'proj-item proj-question');
    const head = el('p', 'proj-what', str(q.text) || '(the push carried no question text)');
    li.append(head);
    const kind = str(q.kind).toLowerCase();
    const def = questionDefault(q);
    li.dataset.default = def.hasDefault ? 'yes' : 'no';
    li.append(el('p', 'proj-default', def.text));
    const asked = ageOf(q.asked_at, nowMs);
    li.append(el('p', 'proj-meta', [asked ? `asked ${asked}` : 'asked at an unknown time', kind].filter(Boolean).join(' · ')));
    ul.append(li);
  }
  box.append(ul);
  return box;
}

function deliverableItem(raw, nowMs) {
  const d = obj(raw) || {};
  const li = el('li', 'proj-item');
  const what = str(d.what) || '(no description)';
  const url = safeUrl(d.url);
  if (url) {
    const a = el('a', 'proj-what proj-link', what);
    a.setAttribute('href', url);
    a.setAttribute('rel', 'noopener');
    li.append(a);
  } else li.append(el('p', 'proj-what', what));
  li.append(el('p', 'proj-meta', ageOf(d.at, nowMs) || 'time unknown'));
  return li;
}

function latestPanel(section, nowMs) {
  const list = Array.isArray(section.deliverables) ? newestFirst(section.deliverables, 'at') : [];
  const box = panel('Latest', 0);
  const silence = listSilence(section, 'deliverables', 'The last push did not list deliverables.', 'Nothing delivered yet.');
  if (silence) {
    box.append(el('p', 'empty-say', silence));
    return box;
  }
  const ul = el('ul', 'proj-list');
  for (const d of list.slice(0, DELIVERABLES_SHOWN)) ul.append(deliverableItem(d, nowMs));
  box.append(ul);
  if (list.length > DELIVERABLES_SHOWN) {
    const more = el('details', 'proj-more');
    more.append(el('summary', '', `${list.length - DELIVERABLES_SHOWN} earlier`));
    const rest = el('ul', 'proj-list');
    for (const d of list.slice(DELIVERABLES_SHOWN)) rest.append(deliverableItem(d, nowMs));
    more.append(rest);
    box.append(more);
  }
  return box;
}

/** One project's card group. */
export function projectGroup(entry, stampIso, nowMs) {
  const card = el('article', 'proj');
  card.dataset.project = entry.slug;
  const head = el('header', 'proj-head');
  const titleRow = el('div', 'proj-title-row');
  titleRow.append(el('h4', 'proj-name', entry.title));
  const s = entry.section;
  if (s && str(s.phase)) titleRow.append(el('span', 'badge', str(s.phase)));
  head.append(titleRow);

  const meta = [];
  if (s && str(s.repo)) meta.push(str(s.repo));
  const upd = updatedLine(stampIso, s, nowMs);
  meta.push(upd.text);
  const metaEl = el('p', 'proj-sub', meta.join(' · '));
  metaEl.dataset.source = upd.source;
  head.append(metaEl);
  if (s && str(s.usage_stamp)) head.append(el('p', 'proj-usage', str(s.usage_stamp)));
  card.append(head);

  if (!s) {
    card.append(el('p', 'empty-say', `The "${entry.key}" section is not an object, so it cannot be read — the project's next push will replace it.`));
    return card;
  }
  const grid = el('div', 'proj-panels');
  grid.append(progressPanel(s, nowMs), stuckPanel(s, nowMs), questionsPanel(s, nowMs), latestPanel(s, nowMs));
  card.append(grid);
  return card;
}

/** A one-line roll-up across every project, or '' when there are none. */
export function summaryLine(entries) {
  if (!entries.length) return '';
  let questions = 0;
  let stuck = 0;
  let running = 0;
  for (const e of entries) {
    const s = e.section || {};
    if (Array.isArray(s.questions)) questions += s.questions.length;
    if (Array.isArray(s.stuck)) stuck += s.stuck.length;
    if (Array.isArray(s.agents)) running += s.agents.filter((a) => str(a && a.state) === 'running').length;
  }
  const n = entries.length;
  return [
    `${n} project${n === 1 ? '' : 's'}`,
    `${running} agent${running === 1 ? '' : 's'} running`,
    questions ? `${questions} waiting on you` : 'nothing waiting on you',
    stuck ? `${stuck} stuck` : 'nothing stuck',
  ].join(' · ');
}

/**
 * Paint every project into `mount`. `stamps` is the Worker's
 * section_pushed_at map ({} when the row predates it).
 */
export function renderProjects(mount, board, stamps, nowMs = Date.now()) {
  if (!mount) return;
  mount.replaceChildren();
  const entries = projectEntries(board);
  if (!entries.length) {
    mount.append(
      el(
        'p',
        'empty-say',
        'No project has pushed a card yet. Each repo’s session publishes its own with scripts/push-project-board.mjs.',
      ),
    );
    return;
  }
  mount.append(el('p', 'proj-summary', summaryLine(entries)));
  const st = obj(stamps) || {};
  for (const entry of entries) mount.append(projectGroup(entry, st[entry.key], nowMs));
}

/** The words for a board that could not be read at all; the freshness strip
 *  already says why, so this only keeps the panel from looking empty. */
export function sayProjectsUnavailable(mount, status) {
  if (!mount) return;
  if (status === 'never') {
    mount.replaceChildren(el('p', 'empty-say', 'Nothing has been pushed to the board yet, so no project cards exist — not "no projects".'));
  }
}
