/**
 * project-cards.test.mjs — how /status/agents draws every project's card
 * (status/lib/project-cards.js, contract §11).
 *
 * Two rules here would fail silently on screen, so they are pinned:
 *   1. a question may show a default ONLY when it is marked reversible — a
 *      public / access / money choice, or an unmarked one, says "no default"
 *      whatever the push carried (the owner's rule);
 *   2. every missing field is a worded line, and ABSENT and EMPTY are two
 *      different sentences (the contract's four silences).
 *
 * ⚠️ A green run proves the module's logic against the stub DOM, not what a
 * person sees — the headless render in the build report is that check.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { installStubDom } from './helpers/stub-dom.mjs';
import {
  newestFirst,
  projectEntries,
  questionDefault,
  renderProjects,
  safeUrl,
  summaryLine,
  updatedLine,
} from '../../sites/heygabi-home/public/status/lib/project-cards.js';

const NOW = Date.parse('2026-09-27T21:00:00.000Z');
const MIN = 60_000;
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();

function render(board, stamps = {}) {
  const dom = installStubDom({ kinds: [] });
  const mount = dom.document.createElement('div');
  renderProjects(mount, board, stamps, NOW);
  dom.restore();
  return mount;
}

const texts = (node) => node.all().filter((n) => n.children.length === 0).map((n) => n.textContent);

test('⚠️ questionDefault: public / access / money NEVER show a default, whatever the push says', () => {
  for (const kind of ['public', 'access', 'money', 'MONEY']) {
    const d = questionDefault({ text: 'q', kind, default: 'go ahead' });
    assert.equal(d.hasDefault, false, kind);
    assert.match(d.text, /no default/);
    assert.ok(!d.text.includes('go ahead'));
  }
});

test('questionDefault: reversible + a default shows it; reversible without one says so', () => {
  assert.deepEqual(questionDefault({ kind: 'reversible', default: 'use opus' }), {
    text: "If you don't answer: use opus",
    hasDefault: true,
  });
  assert.equal(questionDefault({ kind: 'reversible', default: null }).hasDefault, false);
  assert.equal(questionDefault({ kind: 'reversible', default: '   ' }).hasDefault, false);
});

test('⚠️ questionDefault: an UNMARKED or unknown kind is not known to be reversible — no default', () => {
  const unmarked = questionDefault({ text: 'q', default: 'ship it' });
  assert.equal(unmarked.hasDefault, false);
  assert.match(unmarked.text, /only a question marked reversible/);
  assert.equal(questionDefault({ kind: 'weird', default: 'x' }).hasDefault, false);
  assert.equal(questionDefault(null).hasDefault, false);
});

test('updatedLine: the Worker stamp wins; the push clock is named as such; neither says so', () => {
  assert.deepEqual(updatedLine(iso(4 * MIN), { updated_at: iso(90 * MIN) }, NOW), { text: 'updated 4m ago', source: 'worker' });
  const push = updatedLine(undefined, { updated_at: iso(90 * MIN) }, NOW);
  assert.equal(push.source, 'push');
  assert.match(push.text, /1h 30m ago — by the project's own clock/);
  assert.equal(updatedLine('garbage', {}, NOW).source, 'none');
  assert.match(updatedLine(null, null, NOW).text, /unknown/);
});

test('safeUrl: only http(s) becomes a link', () => {
  assert.equal(safeUrl('https://heygabi.ai/status/agents/'), 'https://heygabi.ai/status/agents/');
  assert.equal(safeUrl('javascript:alert(1)'), '');
  assert.equal(safeUrl('data:text/html,x'), '');
  assert.equal(safeUrl(undefined), '');
});

test('projectEntries: only project_<slug> keys; waiting projects first, then by name; name falls back to slug', () => {
  const entries = projectEntries({
    agents: [],
    project_zeta: { name: 'Zeta', questions: [{}] },
    project_alpha: { name: 'Alpha' },
    'project_BAD KEY': {},
    project_bare: {},
    project_broken: 'not an object',
  });
  assert.deepEqual(entries.map((e) => e.key), ['project_zeta', 'project_alpha', 'project_bare', 'project_broken']);
  assert.equal(entries.find((e) => e.key === 'project_bare').title, 'bare');
  assert.equal(entries.find((e) => e.key === 'project_broken').section, null);
});

test('newestFirst: newest on top; unreadable times sink, never dropped', () => {
  const out = newestFirst([{ at: iso(60 * MIN), n: 1 }, { at: 'nope', n: 2 }, { at: iso(MIN), n: 3 }], 'at');
  assert.deepEqual(out.map((x) => x.n), [3, 1, 2]);
});

test('render: two projects become two groups, each with the four panels in order', () => {
  const mount = render(
    {
      agents: [{ name: 'conductor' }],
      project_a: { name: 'A', agents: [], stuck: [], questions: [], deliverables: [] },
      project_b: { name: 'B', agents: [], stuck: [], questions: [], deliverables: [] },
    },
    { project_a: iso(2 * MIN), project_b: iso(20 * MIN) },
  );
  const groups = mount.byClass('proj');
  assert.equal(groups.length, 2);
  for (const g of groups) {
    assert.deepEqual(
      g.byClass('proj-panel-h').map((h) => h.textContent),
      ['Progress', 'Stuck', 'Needs you', 'Latest'],
    );
  }
  assert.ok(mount.findText('updated 2m ago'));
  assert.ok(mount.findText('updated 20m ago'));
  assert.match(mount.byClass('proj-summary')[0].textContent, /^2 projects/);
});

test('⚠️ render: ABSENT and EMPTY are different sentences, per panel', () => {
  const absent = texts(render({ project_a: { name: 'A' } }));
  assert.ok(absent.includes('The last push did not list agents.'));
  assert.ok(absent.includes('The last push did not say whether anything is stuck.'));
  assert.ok(absent.includes('The last push did not list questions.'));
  assert.ok(absent.includes('The last push did not list deliverables.'));
  assert.ok(absent.some((t) => /update time unknown/.test(t)));

  const empty = texts(render({ project_a: { name: 'A', agents: [], stuck: [], questions: [], deliverables: [] } }));
  assert.ok(empty.includes('Nothing running — the last push listed no agents.'));
  assert.ok(empty.includes('Nothing stuck.'));
  assert.ok(empty.includes('Nothing waiting on you.'));
  assert.ok(empty.includes('Nothing delivered yet.'));
});

test('render: a non-object section and a non-list field are worded, never blank or thrown', () => {
  const t = texts(render({ project_x: 42, project_y: { agents: 'lots' } }));
  assert.ok(t.some((s) => /"project_x" section is not an object/.test(s)));
  assert.ok(t.some((s) => /"agents" is not a list/.test(s)));
});

test('render: no project sections at all says no project has pushed — not "no projects"', () => {
  const t = texts(render({ agents: [] }));
  assert.equal(t.length, 1);
  assert.match(t[0], /No project has pushed a card yet/);
  assert.match(texts(render(null))[0], /No project has pushed/);
});

test('render: a full project draws agents, stuck, questions with the no-default rule, and newest-first deliverables', () => {
  const mount = render({
    project_black_bloc_is_bad: {},
    'project_black-bloc': {
      name: 'Black Bloc',
      repo: 'black_bot_baf',
      phase: 'v179',
      usage_stamp: 'session 4% / weekly 32% / Fable 2%',
      agents: [{ name: 'spotlight build', state: 'running', model: 'opus', task: 'dates', started_at: iso(40 * MIN), tokens: 120000 }],
      stuck: [{ what: 'deploy waits', since: iso(3 * 60 * MIN), why: 'owner word' }],
      questions: [
        { text: 'Post publicly?', kind: 'public', default: 'yes', asked_at: iso(10 * MIN), needs_owner: true },
        { text: 'Model?', kind: 'reversible', default: 'opus', asked_at: iso(5 * MIN), needs_owner: true },
      ],
      deliverables: Array.from({ length: 7 }, (_, i) => ({ what: `d${i}`, url: i === 0 ? 'https://example.com/d0' : 'javascript:x', at: iso((i + 1) * MIN) })),
    },
  });
  const t = texts(mount);
  assert.ok(t.includes('Black Bloc'));
  assert.ok(t.includes('v179'));
  assert.ok(t.includes('session 4% / weekly 32% / Fable 2%'));
  assert.ok(t.includes('started 40m ago · 120,000 tokens'));
  assert.ok(t.includes('since 3h ago · owner word'));
  assert.ok(t.includes('Waiting on you — no default (public choices never get one)'));
  assert.ok(t.includes("If you don't answer: opus"));
  assert.ok(!t.some((s) => s.includes("If you don't answer: yes")), 'the public question never shows its default');

  const links = mount.byTag('a');
  assert.deepEqual(links.map((a) => a.getAttribute('href')), ['https://example.com/d0'], 'only the http(s) url is a link');
  const shown = mount.byClass('proj-panels')[0].children[3].children[1].children.map((li) => li.children[0].textContent);
  assert.deepEqual(shown, ['d0', 'd1', 'd2', 'd3', 'd4']);
  assert.ok(mount.findText('2 earlier'));
  assert.equal(mount.byClass('proj').length, 1, 'an illegal key (underscore in the slug) is not a project');
});

test('summaryLine: counts across projects', () => {
  const line = summaryLine(projectEntries({
    project_a: { agents: [{ state: 'running' }, { state: 'landed' }], questions: [{}], stuck: [] },
    project_b: { agents: [{ state: 'running' }], stuck: [{}] },
  }));
  assert.equal(line, '2 projects · 2 agents running · 1 waiting on you · 1 stuck');
});
