import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TODO_BOARD_HTML } from '../src/todo-board.js';

// ---------------------------------------------------------------------------
// TODO_BOARD_HTML — the bundled content asset. Pure sanity, no network: the
// gating itself (401 tokenless / 403 stranger / 200 approver) is exercised
// against a REAL wrangler dev in test/live-probes.ts phases A/B/C/D — the
// same idiom ops.ts's ops/pipeline gating and site-roles.ts's gating use
// (neither has a Hono-level 401/403 unit test either). requireApprover()
// calls resolveIdentity(), which needs a fully-configured Firebase verifier
// context to fail the way production does (a bare Hono `.request()` call
// with a stub env answers 500 misconfigured, not 401) — the live probe
// suite's real `wrangler dev` already builds that context correctly, so
// duplicating it here would only test the stub, not the gate.
// ---------------------------------------------------------------------------

test('TODO_BOARD_HTML: a non-empty <main> fragment carrying the CSS-only filter radios', () => {
  assert.ok(TODO_BOARD_HTML.startsWith('<main>'));
  assert.ok(TODO_BOARD_HTML.trim().endsWith('</main>'));
  // The six radios the filter's `~` rules depend on — see the shim's own
  // header comment for why they must stay direct siblings of .filters/.board.
  for (const id of ['f-all', 'f-audio', 'f-books', 'f-games', 'f-home', 'f-cross']) {
    assert.ok(TODO_BOARD_HTML.includes(`id="${id}"`), `missing radio #${id}`);
  }
});

test('TODO_BOARD_HTML: no <script> — the fragment is injected via innerHTML into a strict-CSP page', () => {
  assert.ok(!/<script/i.test(TODO_BOARD_HTML));
});

test('TODO_BOARD_HTML: carries no secrets — token names, auth weaknesses, order/price detail (the board README rule)', () => {
  const lower = TODO_BOARD_HTML.toLowerCase();
  for (const word of ['token', 'secret', 'password', 'firebase_service_account', '$', 'purchase', 'order id']) {
    assert.ok(!lower.includes(word), `TODO_BOARD_HTML unexpectedly mentions "${word}"`);
  }
});
