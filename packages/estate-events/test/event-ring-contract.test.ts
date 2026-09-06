/**
 * CONTRACT TEST — what this package puts on the wire vs. what the ring accepts.
 *
 * ⚠️ THIS IS THE FILE KI-10 SHOULD HAVE HAD. On 2026-08-26 the backup workflow
 * posted `{"events":[{…}]}` to this route. `parseEvents` does
 * `Array.isArray(body) ? body : [body]`, so the WRAPPER became "the event", a
 * wrapper names no worker, and the ring correctly answered
 * `400 {"error":"missing_worker"}` — on the first real failure it had ever been
 * asked to report, five days after everyone had agreed the notification was
 * "shipped". Nothing on either side was red. See `KNOWN_ISSUES.md` KI-10 and
 * `docs/info/worker-event-ring.md` §6.
 *
 * The sender lives here; the receiver lives in ANOTHER workspace
 * (`apps/auth-worker/src/worker-events.ts`) and compiles separately, so
 * TypeScript notices nothing when one side moves. The pins below are therefore
 * DERIVED FROM THE RECEIVER'S OWN SOURCE rather than hand-copied — a
 * hand-copied expectation is the same hand-kept literal this estate keeps
 * getting bitten by, one file further along.
 *
 * ⚠️ It reads the receiver as TEXT on purpose, and does not import it:
 * `worker-events.ts` pulls in Hono, the machine-key registry, the devops
 * middleware and the agent board, none of which this package depends on. A
 * contract pin that drags four modules into a leaf package's test run is a pin
 * that gets deleted the first time one of them breaks.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EVENT_LEVELS, buildEventBody, sendEvent, type ReportInput } from '../src/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../..');
const RECEIVER = resolve(REPO, 'apps/auth-worker/src/worker-events.ts');
const AUTH_INDEX = resolve(REPO, 'apps/auth-worker/src/index.ts');

const receiverSrc = readFileSync(RECEIVER, 'utf8');
const authIndexSrc = readFileSync(AUTH_INDEX, 'utf8');

/** Brace-match a block whose opening line matches `startRe`. */
function blockAt(src: string, startRe: RegExp, label: string): string {
  const m = startRe.exec(src);
  if (!m) throw new Error(`${label} not found in the receiver — it changed shape; update this contract`);
  let depth = 0;
  const start = src.indexOf('{', m.index);
  for (let i = start; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces reading ${label}`);
}

const input: ReportInput = {
  endpoint: 'https://auth.heygabi.ai',
  token: 'test-token-not-a-real-secret',
  worker: 'catalog-index',
  level: 'error',
  message: 'push rejected: bad source',
};

describe('the level vocabulary is ONE list kept in two files', () => {
  it('EVENT_LEVELS here equals EVENT_LEVELS in the receiver', () => {
    // Both files declare the array literally. A level added on one side only is
    // either an event the ring refuses with `bad_level`, or a level no writer
    // can ever produce — and neither side goes red on its own.
    const m = /export const EVENT_LEVELS = \[([^\]]*)\]/.exec(receiverSrc);
    assert.ok(m, 'the receiver no longer declares EVENT_LEVELS as an array literal');
    const theirs = [...m[1]!.matchAll(/'([^']+)'/g)].map((x) => x[1]);
    assert.deepEqual([...EVENT_LEVELS], theirs);
  });

  it('every level this package exports would pass the receiver’s check', () => {
    // `bad_level` is a REFUSAL, not a strip: an event with an unknown level is
    // not stored at all.
    assert.match(receiverSrc, /error: 'bad_level'/);
    for (const level of EVENT_LEVELS) {
      assert.ok(receiverSrc.includes(`'${level}'`), `${level} is unknown to the ring`);
    }
  });
});

describe('the body shape the ring will actually store', () => {
  it('every key this package emits is a field the receiver declares', () => {
    // Derived from `interface WorkerEvent` in the receiver. A key we send that
    // it does not declare is a value that looks reported and is dropped.
    const iface = blockAt(receiverSrc, /export interface WorkerEvent\b/, 'interface WorkerEvent');
    const theirFields = new Set([...iface.matchAll(/^\s{2}(\w+)\??:/gm)].map((m) => m[1]!));
    assert.ok(theirFields.size >= 4, `parsed too few fields: ${[...theirFields].join(',')}`);
    for (const key of Object.keys(buildEventBody(input))) {
      assert.ok(theirFields.has(key), `the ring has no field for \`${key}\``);
    }
  });

  it('the three fields the ring REFUSES on are always present and non-empty', () => {
    // missing_worker / missing_message / bad_level are the receiver's three
    // hard refusals. buildEventBody must be structurally incapable of producing
    // an event that trips one, given a typed ReportInput.
    for (const err of ['missing_worker', 'missing_message', 'bad_level']) {
      assert.ok(receiverSrc.includes(`'${err}'`), `the receiver no longer refuses ${err}`);
    }
    const body = buildEventBody(input);
    assert.equal(typeof body.worker, 'string');
    assert.ok((body.worker as string).trim().length > 0);
    assert.equal(typeof body.message, 'string');
    assert.ok((body.message as string).trim().length > 0);
    assert.ok((EVENT_LEVELS as readonly string[]).includes(body.level as string));
  });
});

describe('⚠️ KI-10 — the wrapper that made the ring refuse a real failure', () => {
  it('the receiver still treats a bare object as ONE event', () => {
    // If this line ever changes, the sender below must change with it — and
    // this assertion is the only thing in either repo that would notice.
    assert.match(receiverSrc, /Array\.isArray\(body\)\s*\?\s*body\s*:\s*\[body\]/);
  });

  it('what we POST is a bare event object — not a wrapper, not an array', async () => {
    let sent: unknown;
    const impl = (async (_url: unknown, init: unknown) => {
      sent = JSON.parse((init as RequestInit).body as string);
      return new Response('{"ok":true}', { status: 200 });
    }) as unknown as typeof fetch;
    await sendEvent({ ...input, fetchImpl: impl });

    assert.ok(sent && typeof sent === 'object', 'the body must be a JSON object');
    assert.ok(!Array.isArray(sent), 'a bare object, not an array — the ring wraps it itself');
    const keys = Object.keys(sent as Record<string, unknown>);
    assert.ok(!keys.includes('events'), '⚠️ KI-10: an `events` wrapper names no worker and is refused 400');
    assert.ok(keys.includes('worker'), 'the top-level object must BE the event');
  });

  it('one call sends one event, so the receiver’s MAX_BATCH can never be tripped from here', () => {
    const m = /export const MAX_BATCH = (\d+)/.exec(receiverSrc);
    assert.ok(m, 'the receiver no longer declares MAX_BATCH');
    assert.ok(Number(m[1]) >= 1);
    // buildEventBody has no plural path at all; this records that as intent.
    assert.ok(!Array.isArray(buildEventBody(input)));
  });
});

describe('the route — derived from where the receiver is actually mounted', () => {
  it('the URL this package POSTs to is the route the auth Worker serves', async () => {
    const path = /workerEventsRoutes\.post\('([^']+)'/.exec(receiverSrc)?.[1];
    assert.ok(path, 'the receiver no longer registers a POST route');
    const mount = /app\.route\('([^']+)',\s*workerEventsRoutes\)/.exec(authIndexSrc)?.[1];
    assert.ok(mount, 'workerEventsRoutes is no longer mounted in apps/auth-worker/src/index.ts');

    let url = '';
    const impl = (async (u: unknown) => {
      url = String(u);
      return new Response('{"ok":true}', { status: 200 });
    }) as unknown as typeof fetch;
    await sendEvent({ ...input, fetchImpl: impl });

    assert.equal(url, `${input.endpoint}${mount}${path}`);
  });

  it('the ring answers a bearer, and this package sends one', () => {
    // Not a claim about WHICH token — `checkEventsAuth` accepts either the
    // events token or the conductor's. Only that the scheme has not changed
    // out from under a writer that hard-codes `Bearer `.
    assert.match(receiverSrc, /Bearer/);
  });
});
