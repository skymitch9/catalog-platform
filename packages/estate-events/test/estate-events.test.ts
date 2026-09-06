/**
 * @platform/estate-events — the three properties in the module header, made
 * mechanical.
 *
 * ⚠️ WHY THIS FILE EXISTS AT ALL. Until 2026-09-05 this package declared
 * `"test": "tsx --test test/*.test.ts"` and had **no `test/` directory**. A
 * glob matching nothing is a silent no-op, so `npm test --workspaces` printed
 * `ℹ tests 0 / ℹ pass 0 / ℹ fail 0` and the workspace reported SUCCESS for a
 * suite that did not exist — a vacuous green on the one module every estate
 * Worker calls when something has already gone wrong
 * (`docs/info/test-inventory-2026-09-05.md` §4.4).
 *
 * The header of `src/index.ts` states three properties, and every one of them
 * is a promise made to a Worker that is currently having a bad day:
 *
 *   1. **It never throws.** Every test below that hands `sendEvent` a hostile
 *      fetch is that property. The failure it prevents is not a lost log line
 *      — it is a checkout route 500-ing because its LOGGER could not reach D1.
 *   2. **It never blocks the response.** `reportEvent` must return before the
 *      request settles, and must hand the promise to `waitUntil` when it has
 *      one. Pinned by ordering, not by comment.
 *   3. **A missing token or endpoint is a NO-OP, not a throw** — "ships dark
 *      until configured" is the estate's standing idiom, and a Worker that has
 *      not been given the secret yet must behave exactly as it did before.
 *
 * The wire SHAPE — the thing the ring actually refuses — is pinned separately
 * in `event-ring-contract.test.ts`, against the receiver's own source.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  EVENT_LEVELS,
  buildEventBody,
  reportEvent,
  sendEvent,
  type ReportInput,
} from '../src/index.js';

const ENDPOINT = 'https://auth.heygabi.ai';
const TOKEN = 'test-token-not-a-real-secret';

interface Call {
  url: string;
  init: RequestInit;
}

/** A fetch that records what it was asked to do and answers however the test
 *  needs. Nothing here touches the network. */
function recordingFetch(answer: () => Promise<Response> | Response): {
  calls: Call[];
  impl: typeof fetch;
} {
  const calls: Call[] = [];
  const impl = (async (url: unknown, init: unknown) => {
    calls.push({ url: String(url), init: (init ?? {}) as RequestInit });
    return answer();
  }) as unknown as typeof fetch;
  return { calls, impl };
}

const ok = (status = 200) => new Response('{"ok":true}', { status });

function input(over: Partial<ReportInput> = {}): ReportInput {
  return {
    endpoint: ENDPOINT,
    token: TOKEN,
    worker: 'catalog-index',
    level: 'error',
    message: 'push rejected: bad source',
    ...over,
  };
}

// ── buildEventBody — the shape a caller cannot get wrong ────────────────────

describe('buildEventBody — every optional becomes an explicit null', () => {
  it('carries the four required fields and nulls the three optional ones', () => {
    const body = buildEventBody(input());
    assert.equal(body.worker, 'catalog-index');
    assert.equal(body.level, 'error');
    assert.equal(body.message, 'push rejected: bad source');
    assert.equal(body.route, null);
    assert.equal(body.request_id, null);
    assert.equal(body.detail, null);
  });

  it('⚠️ an absent optional is null and NOT undefined — undefined vanishes in JSON', () => {
    // JSON.stringify drops undefined-valued keys entirely, so `undefined` here
    // would silently change the wire shape rather than the value. The `?? null`
    // in the source is load-bearing; this is the assertion that says so.
    const body = buildEventBody(input());
    const round = JSON.parse(JSON.stringify(body)) as Record<string, unknown>;
    for (const key of ['route', 'request_id', 'detail']) {
      assert.ok(key in round, `${key} must survive JSON.stringify`);
      assert.equal(round[key], null);
    }
  });

  it('an explicit null and an explicit value both pass through unchanged', () => {
    const body = buildEventBody(input({ route: '/api/index/push', request_id: null, detail: 'x' }));
    assert.equal(body.route, '/api/index/push');
    assert.equal(body.request_id, null);
    assert.equal(body.detail, 'x');
  });

  it('stamps `at` with an ISO string the receiver can parse', () => {
    // The ring falls back to its OWN clock when `at` is unparseable, so a bad
    // stamp here is invisible rather than loud — which is exactly why it is
    // worth pinning on this side.
    const body = buildEventBody(input());
    assert.equal(typeof body.at, 'string');
    assert.ok(Number.isFinite(Date.parse(body.at as string)), `unparseable at: ${String(body.at)}`);
    assert.match(body.at as string, /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
  });

  it('emits exactly the seven keys and no extras', () => {
    // An eighth key is not harmless: the ring stores what it recognises and
    // drops the rest, so a field added here without a matching change there is
    // a value that looks reported and is not.
    assert.deepEqual(Object.keys(buildEventBody(input())).sort(), [
      'at',
      'detail',
      'level',
      'message',
      'request_id',
      'route',
      'worker',
    ]);
  });

  it('⚠️ does NOT truncate — clipping is the receiver’s job, in one place', () => {
    const long = 'x'.repeat(5000);
    const body = buildEventBody(input({ message: long, detail: long }));
    assert.equal((body.message as string).length, 5000);
    assert.equal((body.detail as string).length, 5000);
  });

  it('the exported level list is the four the ring understands', () => {
    assert.deepEqual([...EVENT_LEVELS], ['error', 'warn', 'info', 'deploy']);
  });
});

// ── sendEvent — refusal, transport, and the swallow ─────────────────────────

describe('⚠️ ships dark until configured — a missing secret is a no-op, never a throw', () => {
  it('no token: returns false and never opens a socket', async () => {
    const { calls, impl } = recordingFetch(ok);
    assert.equal(await sendEvent({ ...input({ token: undefined }), fetchImpl: impl }), false);
    assert.equal(calls.length, 0, 'a Worker without the secret must not call out at all');
  });

  it('empty-string token: same no-op (a wiped secret reads as empty, not absent)', async () => {
    const { calls, impl } = recordingFetch(ok);
    assert.equal(await sendEvent({ ...input({ token: '' }), fetchImpl: impl }), false);
    assert.equal(calls.length, 0);
  });

  it('no endpoint: returns false and never opens a socket', async () => {
    const { calls, impl } = recordingFetch(ok);
    assert.equal(await sendEvent({ ...input({ endpoint: '' }), fetchImpl: impl }), false);
    assert.equal(calls.length, 0);
  });
});

describe('sendEvent — the request it actually makes', () => {
  it('POSTs the ring route with the bearer and a JSON content type', async () => {
    const { calls, impl } = recordingFetch(ok);
    await sendEvent({ ...input(), fetchImpl: impl });
    assert.equal(calls.length, 1);
    const call = calls[0]!;
    assert.equal(call.url, 'https://auth.heygabi.ai/api/estate/ops/worker-events');
    assert.equal(call.init.method, 'POST');
    const headers = call.init.headers as Record<string, string>;
    assert.equal(headers.Authorization, `Bearer ${TOKEN}`);
    assert.equal(headers['Content-Type'], 'application/json');
  });

  it('trims trailing slashes off the endpoint rather than doubling them', async () => {
    const { calls, impl } = recordingFetch(ok);
    await sendEvent({ ...input({ endpoint: 'https://auth.heygabi.ai///' }), fetchImpl: impl });
    assert.equal(calls[0]!.url, 'https://auth.heygabi.ai/api/estate/ops/worker-events');
  });

  it('sends the built body verbatim', async () => {
    const { calls, impl } = recordingFetch(ok);
    await sendEvent({ ...input({ route: '/r', detail: 'd' }), fetchImpl: impl });
    const sent = JSON.parse(calls[0]!.init.body as string) as Record<string, unknown>;
    assert.equal(sent.worker, 'catalog-index');
    assert.equal(sent.level, 'error');
    assert.equal(sent.route, '/r');
    assert.equal(sent.detail, 'd');
  });

  it('returns res.ok — true on 2xx, false on a refusal or a 500', async () => {
    // 204 carries no body by construction, hence the null; the ring answers
    // 200 with a JSON envelope today, and either must read as success.
    const answers = [
      [200, '{"ok":true,"stored":1}', true],
      [204, null, true],
      [400, '{"error":"missing_worker"}', false],
      [401, '{"error":"unauthorised"}', false],
      [500, 'upstream exploded', false],
    ] as const;
    for (const [status, body, expected] of answers) {
      const { impl } = recordingFetch(() => new Response(body, { status }));
      assert.equal(await sendEvent({ ...input(), fetchImpl: impl }), expected, `status ${status}`);
    }
  });

  it('⚠️ property 1 — a rejecting fetch is swallowed, never rethrown', async () => {
    const impl = (async () => {
      throw new Error('getaddrinfo ENOTFOUND auth.heygabi.ai');
    }) as unknown as typeof fetch;
    assert.equal(await sendEvent({ ...input(), fetchImpl: impl }), false);
  });

  it('⚠️ property 1 — a fetch that throws SYNCHRONOUSLY is swallowed too', async () => {
    // The `try` wraps the call, not only the await — a binding that throws on
    // invocation (a detached context, a stubbed global) must not escape either.
    const impl = (() => {
      throw new TypeError('Illegal invocation');
    }) as unknown as typeof fetch;
    assert.equal(await sendEvent({ ...input(), fetchImpl: impl }), false);
  });

  it('falls back to the global fetch when no fetchImpl is given', async () => {
    const original = globalThis.fetch;
    let seen = '';
    globalThis.fetch = (async (url: unknown) => {
      seen = String(url);
      return ok();
    }) as unknown as typeof fetch;
    try {
      assert.equal(await sendEvent(input()), true);
    } finally {
      globalThis.fetch = original;
    }
    assert.equal(seen, 'https://auth.heygabi.ai/api/estate/ops/worker-events');
  });
});

// ── reportEvent — fire and forget ───────────────────────────────────────────

describe('⚠️ property 2 — reportEvent never blocks the response', () => {
  it('returns before the fetch settles', async () => {
    let settle!: () => void;
    const gate = new Promise<void>((r) => {
      settle = r;
    });
    let finished = false;
    const impl = (async () => {
      await gate;
      finished = true;
      return ok();
    }) as unknown as typeof fetch;

    const ctx = { waitUntil: (_p: Promise<unknown>) => {} };
    assert.equal(reportEvent(ctx, { ...input(), fetchImpl: impl }), undefined);
    assert.equal(finished, false, 'reportEvent must not await the send');
    settle();
    await gate;
  });

  it('hands exactly one promise to waitUntil', async () => {
    const handed: Promise<unknown>[] = [];
    const { impl } = recordingFetch(ok);
    reportEvent({ waitUntil: (p) => handed.push(p) }, { ...input(), fetchImpl: impl });
    assert.equal(handed.length, 1);
    assert.ok(handed[0] instanceof Promise);
    await handed[0];
  });

  it('⚠️ the promise handed to waitUntil never rejects — a rejection there kills the invocation', async () => {
    const handed: Promise<unknown>[] = [];
    const impl = (async () => {
      throw new Error('ring unreachable');
    }) as unknown as typeof fetch;
    reportEvent({ waitUntil: (p) => handed.push(p) }, { ...input(), fetchImpl: impl });
    await assert.doesNotReject(() => handed[0]!);
  });

  it('with no ExecutionContext it still fires, un-awaited, and does not throw', async () => {
    const { calls, impl } = recordingFetch(ok);
    for (const ctx of [null, undefined]) {
      assert.equal(reportEvent(ctx, { ...input(), fetchImpl: impl }), undefined);
    }
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(calls.length, 2, 'the request goes out even with nowhere to park it');
  });

  it('a ctx whose waitUntil is not a function is treated as no ctx', async () => {
    const { calls, impl } = recordingFetch(ok);
    const bogus = { waitUntil: 'nope' } as unknown as { waitUntil(p: Promise<unknown>): void };
    assert.equal(reportEvent(bogus, { ...input(), fetchImpl: impl }), undefined);
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(calls.length, 1);
  });

  it('⚠️ an unconfigured Worker reports nothing and still cannot throw', async () => {
    const handed: Promise<unknown>[] = [];
    const { calls, impl } = recordingFetch(ok);
    reportEvent({ waitUntil: (p) => handed.push(p) }, { ...input({ token: undefined }), fetchImpl: impl });
    assert.equal(calls.length, 0);
    assert.equal(await handed[0], false);
  });
});
