/**
 * AUDIT F6 — what the CALL SITE passes to toolsForApi.
 *
 * gabi-tools.test.ts already pins the pure `toolsForApi()` function: given
 * `{ shelf: true }` it returns the shelf tools. That is not the bug. The bug
 * was in `converseWithTools` (gabi-chat.ts), the SOLE call site, which built
 * the API tool array from `{ docs, books }` only — so the Tier-0d shelf tools
 * and the Tier-4 recall tool were never DESCRIBED to the model, even when their
 * ports were wired and the postures were on. These tests exercise the call site
 * itself by capturing the tools array actually sent to the Messages API.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { converseWithTools } from '../src/gabi-chat.js';
import {
  GABI_SHELF_TOOL_NAMES,
  GABI_RECALL_TOOL_NAMES,
} from '../src/gabi-tools.js';
import type { ToolContext } from '../src/tool-exec.js';

/** A model reply that ends the turn immediately, so no tool is executed — the
 *  turn exists only so we can read the tools array it OFFERED. */
function endTurnReply(): Response {
  return new Response(
    JSON.stringify({
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      model: 'test',
      content: [{ type: 'text', text: 'ok' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 1 },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

/** Run one turn with the given toolCtx and return the tool names the call site
 *  offered on the FIRST (tools-bearing) request. */
async function toolsOffered(toolCtx: ToolContext): Promise<string[]> {
  let captured: string[] = [];
  const fetchOverride = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (Array.isArray(body.tools)) {
      captured = (body.tools as { name: string }[]).map((t) => t.name);
    }
    return endTurnReply();
  }) as unknown as typeof fetch;

  await converseWithTools(
    'test-key-not-real',
    'what is on my tbr?',
    null,
    { discordUserId: '1', guildId: 'g1', authorName: 'owner' },
    toolCtx,
    { fetch: fetchOverride },
  );
  return captured;
}

const baseCtx = { catalogBaseUrl: 'https://catalog.test' } as ToolContext;
/** Truthy port stubs — only their PRESENCE is read at the call site; the turn
 *  ends before any tool executes, so no method is called. */
const shelfCtx = { port: {}, discordUserId: '1' } as unknown as ToolContext['shelf'];
const recallCtx = { port: {}, person: 'owner' } as unknown as ToolContext['recall'];

test('F6: with a shelf port, the shelf tools ARE offered to the model', async () => {
  const names = await toolsOffered({ ...baseCtx, shelf: shelfCtx });
  for (const n of GABI_SHELF_TOOL_NAMES) {
    assert.ok(names.includes(n), `call site did not offer shelf tool "${n}"`);
  }
});

test('F6: with a recall port, recall_conversation IS offered to the model', async () => {
  const names = await toolsOffered({ ...baseCtx, recall: recallCtx });
  for (const n of GABI_RECALL_TOOL_NAMES) {
    assert.ok(names.includes(n), `call site did not offer recall tool "${n}"`);
  }
});

test('F6: with NEITHER port, neither family leaks (each is its own opt-in)', async () => {
  const names = await toolsOffered({ ...baseCtx });
  for (const n of [...GABI_SHELF_TOOL_NAMES, ...GABI_RECALL_TOOL_NAMES]) {
    assert.ok(!names.includes(n), `"${n}" was offered with no port present`);
  }
});
