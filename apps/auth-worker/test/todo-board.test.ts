/**
 * todo-board.test.ts — structural guards on the /todo board's content.
 *
 * ⚠️ THIS FILE DOES NOT CHECK WHAT THE BOARD SAYS. It cannot: the board is a
 * curated, plain-language summary written for the owner, and no test can know
 * whether "four books still have no cover" is still four. What it CAN stop is
 * the class of edit that leaves the board silently broken while still rendering
 * — which is exactly what happened to the filter chips' contract before anyone
 * wrote it down.
 *
 * The board is a CSS-only radio filter: `#f-audio:checked ~ .board
 * .item:not(.p-audio) { display: none }`. So an item whose class vocabulary
 * drifts does not error — it just quietly stops appearing under a chip, and a
 * chip whose items all left renders as an empty board that looks like a
 * finished project.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { TODO_BOARD_HTML } from '../src/todo-board.js';

/** Every `class="item …"` on the board. */
function itemClasses(): string[][] {
  return [...TODO_BOARD_HTML.matchAll(/class="item ([^"]+)"/g)].map((m) => m[1]!.trim().split(/\s+/));
}

const PROJECTS = ['p-audio', 'p-books', 'p-games', 'p-landing'];
const SCOPES = ['s-all', 's-some', 's-one', 's-landing'];

test('the board has items at all', () => {
  const items = itemClasses();
  assert.ok(items.length >= 10, `only ${items.length} items — a board this short is probably a broken edit`);
});

test('⚠️ every item carries exactly one scope and at least one project', () => {
  for (const classes of itemClasses()) {
    const scopes = classes.filter((c) => SCOPES.includes(c));
    const projects = classes.filter((c) => PROJECTS.includes(c));
    assert.equal(scopes.length, 1, `item has scopes [${scopes}] — exactly one is required`);
    assert.ok(projects.length >= 1, `item has no p-* class, so no filter chip will ever show it`);
  }
});

test('⚠️ no item carries a class outside the known vocabulary', () => {
  // A typo like `p-book` does not error; it silently removes the item from the
  // Books chip forever.
  for (const classes of itemClasses()) {
    for (const c of classes) {
      assert.ok(
        PROJECTS.includes(c) || SCOPES.includes(c),
        `unknown class "${c}" — the filter CSS only understands ${[...PROJECTS, ...SCOPES].join(', ')}`,
      );
    }
  }
});

test('⚠️ EVERY FILTER CHIP HAS SOMETHING TO SHOW', () => {
  // An empty chip renders as a blank board, which reads as "nothing left to do
  // on this project" — the most misleading thing this page could say.
  const items = itemClasses();
  for (const p of PROJECTS) {
    assert.ok(items.some((c) => c.includes(p)), `the ${p} chip would render an empty board`);
  }
  // #f-cross shows .s-some and .s-all only.
  assert.ok(
    items.some((c) => c.includes('s-some') || c.includes('s-all')),
    'the Cross-project chip would render an empty board',
  );
});

test('⚠️ the six filter radios are still DIRECT siblings, in order', () => {
  // Wrapping them in a <fieldset> for tidiness breaks every `~` rule in the
  // stylesheet and silently disables the whole filter — the file's own header
  // warns about this, and now something checks it.
  const ids = [...TODO_BOARD_HTML.matchAll(/<input class="filter-radio"[^>]*id="(f-[a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids, ['f-all', 'f-audio', 'f-books', 'f-games', 'f-home', 'f-cross']);
  const board = TODO_BOARD_HTML.indexOf('<div class="board">');
  const lastRadio = TODO_BOARD_HTML.lastIndexOf('<input class="filter-radio"');
  const filters = TODO_BOARD_HTML.indexOf('<div class="filters"');
  assert.ok(lastRadio < filters && filters < board, 'radios must precede .filters, which must precede .board');
});

test('every item has a heading and a sentence — no placeholder rows', () => {
  const blocks = TODO_BOARD_HTML.split('<li class="item').slice(1);
  for (const b of blocks) {
    assert.match(b, /<h3>[^<]/, 'item with no heading');
    assert.match(b, /<p>[^<]/, 'item with no description');
    assert.match(b, /<span class="scope">/, 'item with no scope label');
  }
});
