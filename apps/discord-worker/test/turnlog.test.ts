/**
 * **THE RECENT TURN RING — and the silent-turn class it exists to end.**
 *
 * ⚠️ **THE INCIDENT, 2026-08-18 7:28 PM Phoenix.** The second real non-owner
 * user ever to talk to GABI asked *"what is the fourth book in the Dungeon
 * Crawler Carl series?"* in a channel, two minutes after GABI had answered
 * somebody else in the same channel, and **got nothing at all**. Her next
 * message was *"Did you turn her off?"* She had not been turned off.
 *
 * The tests below are in two halves, and the second half is the important one:
 *
 *  1. the ring's arithmetic — bounded, ordered, and carrying no message text;
 *  2. ⚠️ **source guards on the four paths that could produce silence**, because
 *     every one of them is a `catch` or a fall-through that a future edit could
 *     quietly restore.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import {
  newTurnTrace,
  pushTurnLog,
  turnLogForDisplay,
  TURN_LOG_ROWS,
  HID_REASONS,
  type TurnLogEntry,
} from '../src/turnlog.js';
import { withDeadline } from '../src/deadline.js';
import { MENTION_MSG } from '../src/mentions.js';

function repoFile(relative: string): string {
  return readFileSync(fileURLToPath(new URL(`../${relative}`, import.meta.url).href), 'utf8');
}

/** Comments are where the reasoning lives; the guards below are about CODE. */
const strip = (x: string) => x.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

function entry(over: Partial<TurnLogEntry> = {}): TurnLogEntry {
  return { at: 1, person: '1', via: 'mention', outcome: 'answered', ...over };
}

describe('the ring is bounded, and that bound is a write-budget promise', () => {
  it('never grows past TURN_LOG_ROWS, however many turns happen', () => {
    let ring: TurnLogEntry[] = [];
    for (let i = 0; i < TURN_LOG_ROWS * 3; i++) ring = pushTurnLog(ring, entry({ at: i }));
    assert.equal(ring.length, TURN_LOG_ROWS);
    // Oldest dropped, newest kept — the other way round would keep a ring of
    // ancient rows and call itself "recent".
    assert.equal(ring[ring.length - 1]?.at, TURN_LOG_ROWS * 3 - 1);
  });

  it('stores oldest-first and DISPLAYS newest-first', () => {
    const ring = [entry({ at: 1 }), entry({ at: 2 }), entry({ at: 3 })];
    assert.deepEqual(turnLogForDisplay(ring).map((r) => r.at), [3, 2, 1]);
    // An absent ring is an empty list, never a throw: the read path runs on a
    // fresh object with nothing in storage.
    assert.deepEqual(turnLogForDisplay(undefined), []);
  });

  it('one row is small — the whole ring is a single Durable Object value', () => {
    let ring: TurnLogEntry[] = [];
    for (let i = 0; i < TURN_LOG_ROWS; i++) {
      ring = pushTurnLog(
        ring,
        entry({
          at: Date.now(),
          person: '123456789012345678',
          channel: '123456789012345678',
          intent: 'question',
          lane: 'books',
          tools: ['list_book_knowledge', 'search_book_text', 'read_book_passage'],
          hid: ['books_capped'],
          ms: 4200,
        }),
      );
    }
    // 128 KiB is the per-value ceiling. A full ring must not be close to it.
    assert.ok(JSON.stringify(ring).length < 32_768, 'the ring row has grown too large');
  });
});

describe('⚠️ the ring records WHAT HAPPENED, never WHAT WAS SAID', () => {
  it('the shape has no field for a question, an answer, or a passage', () => {
    const source = repoFile('src/turnlog.ts');
    const shape = source.slice(
      source.indexOf('export interface TurnLogEntry'),
      source.indexOf('export function pushTurnLog'),
    );
    for (const forbidden of [
      /\bquestion\??:/,
      /\banswer\??:/,
      /\bcontent\??:/,
      /\btext\??:/,
      /\bmessage\??:/,
      /\bpassage\??:/,
      /\bsnippet\??:/,
      /\bquery\??:/,
    ]) {
      assert.doesNotMatch(shape, forbidden, `the ring gained a content field: ${forbidden}`);
    }
  });

  it('the recorder is never handed the message text', () => {
    const gw = strip(repoFile('src/gateway.ts'));
    const calls = [...gw.matchAll(/recordTurnLog\(\{[\s\S]*?\}\)/g)].map((m) => m[0]);
    assert.ok(calls.length >= 2, 'expected the ring to be written on more than one path');
    for (const call of calls) {
      assert.doesNotMatch(call, /trigger\.question/, 'the question text reached the ring');
      assert.doesNotMatch(call, /content/, 'an answer body reached the ring');
    }
  });

  it('the tool recorder takes a NAME and not the arguments', () => {
    const exec = strip(repoFile('src/tool-exec.ts'));
    assert.match(exec, /ctx\.trace\?\.tool\(label\)/, 'the one dispatch point must record the name');
    assert.doesNotMatch(exec, /trace\?\.tool\([^)]*args/, 'tool arguments are content');
  });
});

describe('the trace collector', () => {
  it('⚠️ the FIRST lane wins — a turn is claimed once', () => {
    const t = newTurnTrace();
    t.lane('docs');
    t.lane('shelf');
    assert.equal(t.read().lane, 'docs');
  });

  it('tools accumulate in order, and are bounded against a runaway loop', () => {
    const t = newTurnTrace();
    for (let i = 0; i < 50; i++) t.tool(`tool_${i}`);
    const { tools } = t.read();
    assert.equal(tools[0], 'tool_0');
    assert.ok(tools.length <= 16, 'an unbounded tool list would make one ring row unbounded');
  });

  it('hidden-scope reasons de-duplicate — three refusals of one kind is one fact', () => {
    const t = newTurnTrace();
    t.hid('books_capped');
    t.hid('books_capped');
    t.hid('not_devops');
    assert.deepEqual(t.read().hid, ['books_capped', 'not_devops']);
  });

  it('every reason the lanes actually push is a NAMED one', () => {
    // A reason nobody can find in HID_REASONS is a reason nobody can search for.
    const flow = repoFile('src/mention-flow.ts');
    const used = [...flow.matchAll(/trace\?\.hid\('([a-z_]+)'\)/g)].map((m) => m[1] as string);
    assert.ok(used.length > 0, 'the lanes stopped recording what hid a turn');
    for (const reason of used) {
      assert.ok(
        (HID_REASONS as readonly string[]).includes(reason),
        `${reason} is pushed but is not in HID_REASONS`,
      );
    }
  });

  it('an absent trace changes nothing — every call site is optional', () => {
    const flow = repoFile('src/mention-flow.ts');
    const bare = [...flow.matchAll(/cfg\.trace\.(lane|tool|hid)\(/g)];
    assert.equal(bare.length, 0, 'a non-optional trace call would throw for every existing caller');
  });
});

// ---------------------------------------------------------------------------
// ⚠️ THE SILENCE GUARDS — one per path that produced, or could produce, nothing
// ---------------------------------------------------------------------------

describe('⚠️ REGRESSION — no taken turn may end in silence', () => {
  const gw = strip(repoFile('src/gateway.ts'));

  it('1. a dispatch that THROWS speaks in the channel', () => {
    // Before this, `onFrame` caught and logged, and a log is not a channel.
    assert.match(gw, /private async dispatchInner\(/, 'the inner handler must exist');
    const wrapper = gw.slice(gw.indexOf('private async onDispatch('), gw.indexOf('private async dispatchInner('));
    assert.match(wrapper, /catch \(err\)/, 'onDispatch must catch');
    assert.match(wrapper, /createChannelMessage\(/, 'and it must SAY something, not only log');
    assert.match(wrapper, /MENTION_MSG\.unreachable/, 'in words that name it as our problem');
  });

  it('2. the two storage reads OUTSIDE the mention handler degrade instead of throwing', () => {
    const inner = gw.slice(gw.indexOf('private async dispatchInner('));
    assert.match(
      inner,
      /this\.convLoad\(key\)\.catch\(/,
      'a conversation read that throws must not kill the turn',
    );
    assert.match(
      inner,
      /this\.personaTurn\([^)]*\)\.catch\(/,
      'a persona read that throws must not kill the turn',
    );
  });

  it('3. a refused REPLY is retried as a plain message before it is given up on', () => {
    const inner = gw.slice(gw.indexOf('reply: async (content, extra)'));
    const fn = inner.slice(0, inner.indexOf('followUp: async'));
    assert.match(fn, /replyToMessage\(/);
    assert.match(fn, /createChannelMessage\(/, 'the retry path is missing');
    assert.match(fn, /NEVER DELIVERED/, 'an undeliverable answer has to be loud');
  });

  it('4. ⚠️ the outcome is decided by DELIVERY, not by having produced an answer', () => {
    const inner = gw.slice(gw.indexOf('private async dispatchInner('));
    assert.match(inner, /let delivered = false;/);
    assert.match(inner, /!delivered\s*\n?\s*\?\s*'silent'/, 'undelivered must record as silent');
  });

  it('5. an IGNORED message that was addressed to her leaves a trace', () => {
    const inner = gw.slice(gw.indexOf('private async dispatchInner('));
    const block = inner.slice(inner.indexOf("if (trigger.kind === 'ignore')"));
    assert.match(block, /trigger\.why/, 'the reason was computed and thrown away before this');
    // ⚠️ WIDENED 2026-08-19. The blanket `not_mentioned` exemption was hiding
    // the very turns under investigation, so an ignore is now logged whenever
    // the message LOOKS addressed to her. The filter stays free because this
    // bot has no Message Content intent: an ordinary channel message arrives
    // with an empty `content` and is still not recorded.
    assert.match(block, /looksAddressed/, 'an addressed-but-ignored message must leave a trace');
    assert.match(block, /content_len/, 'shape, so a silent ignore can be diagnosed');
    assert.match(block, /replied_to_me/, 'the ping-off reply blind spot must be visible');
    // ⚠️ …and still no message text, ever.
    assert.doesNotMatch(block, /content:\s*raw\.content/, 'the text must never be logged');
  });

  it('6. the ring write can never fail a turn', () => {
    const rec = gw.slice(gw.indexOf('private async recordTurnLog('));
    assert.match(rec.slice(0, 900), /catch \(err\)/, 'a throwing ring would cause the very defect it catches');
  });

  it('7. the turn-log route is routed BEFORE the /start fallthrough', () => {
    // Falling through would open a Discord WebSocket as a side effect of a
    // devops opening a diagnostic page — the `/conv/dcount` trap, again.
    const fetchFn = gw.slice(gw.indexOf('async fetch(request: Request)'));
    const turnlog = fetchFn.indexOf("path === '/turnlog'");
    const start = fetchFn.indexOf("if (!mentionsOn(this.env))");
    assert.ok(turnlog > 0 && start > 0 && turnlog < start, '/turnlog must not reach the poke');
  });

  it('8. ⚠️ a CAPPED turn still speaks — a fuse is not a silence', () => {
    const flow = strip(repoFile('src/mention-flow.ts'));
    const capped = flow.slice(flow.indexOf('const verdict = await deps.capCheck('));
    const body = capped.slice(0, capped.indexOf("return { answered: true, intent: 'capped' };"));
    assert.match(body, /await say\(verdict\.message\)/, 'a capped person must be told, in words');
  });
});

describe('⚠️ the instrument that retains is switched ON', () => {
  it('Workers Logs is enabled in wrangler.toml', () => {
    const toml = repoFile('wrangler.toml');
    assert.match(toml, /\[observability\]/, 'no retained logs is how the incident became unanswerable');
    assert.match(toml, /enabled\s*=\s*true/);
  });
});

// ---------------------------------------------------------------------------
// ⚠️ THE HANG — the one failure mode that says nothing
// ---------------------------------------------------------------------------

describe('⚠️ deadlines: a hang must end in words, not in nothing', () => {
  it('withDeadline returns the fallback and SAYS it timed out', async () => {
    const never = new Promise<string>(() => {});
    const out = await withDeadline(never, 5, 'fallback');
    assert.equal(out.timedOut, true);
    assert.equal(out.value, 'fallback');
  });

  it('and it does not fire on work that finishes in time', async () => {
    const out = await withDeadline(Promise.resolve('real'), 1_000, 'fallback');
    assert.equal(out.timedOut, false);
    assert.equal(out.value, 'real');
  });

  it('⚠️ a rejection is NOT swallowed — "it threw" and "it was slow" stay apart', async () => {
    await assert.rejects(() => withDeadline(Promise.reject(new Error('boom')), 1_000, 'x'));
  });

  it('the timer is cleared on the fast path — a live timer holds the object awake', () => {
    const src = repoFile('src/deadline.ts');
    assert.match(src, /finally \{[\s\S]*clearTimeout\(timer\)/, 'the timer must be cleared on BOTH paths');
  });

  it('⚠️ EVERY outbound call on the turn path has a deadline of its own', () => {
    // The index lookup was the one that did not, and nothing at a call site
    // marked the difference.
    assert.match(strip(repoFile('src/have.ts')), /AbortSignal\.timeout\(INDEX_LOOKUP_MS\)/);
    assert.match(strip(repoFile('src/book-knowledge-exec.ts')), /AbortSignal\.timeout\(/);
    assert.match(strip(repoFile('src/estate-docs-exec.ts')), /AbortSignal\.timeout\(/);
    assert.match(strip(repoFile('src/catalog-data.ts')), /AbortSignal\.timeout\(/);
    // The per-turn profile read is raced rather than aborted (it goes through a
    // shared helper this app does not own) — but it IS bounded.
    assert.match(strip(repoFile('src/mention-flow.ts')), /withDeadline\(deps\.memory\.load\(key\), PROFILE_READ_MS/);
  });

  it('⚠️ the whole-turn WATCHDOG posts, records, and does not wait', () => {
    const gw = strip(repoFile('src/gateway.ts'));
    const block = gw.slice(gw.indexOf('const raced = await withDeadline(watched'));
    const fn = block.slice(0, 2400);
    assert.match(fn, /raced\.timedOut/);
    assert.match(fn, /MENTION_MSG\.stillThinking/, 'the watchdog must SPEAK');
    assert.match(fn, /outcome: 'silent'/, 'and record it, so a pattern is visible');
    assert.match(fn, /why: 'watchdog'/);
  });

  it("the watchdog's sentence is a follow-through, never a blame or a bare status", () => {
    const m = MENTION_MSG.stillThinking;
    assert.match(m, /taking much longer/i);
    assert.match(m, /rather than anything to do with you/i);
    assert.doesNotMatch(m, /\b(timeout|timed out|error|permission|\d{3})\b/i);
  });
});

// ---------------------------------------------------------------------------
// ⚠️ THE TAPE, 2026-08-19 ~00:25 Phoenix — what the instrumentation caught
// ---------------------------------------------------------------------------

describe('⚠️ the socket state is visible, because non-delivery leaves no trace', () => {
  const gw = strip(repoFile('src/gateway.ts'));

  it('the turn log reports whether she is connected, and since when', () => {
    const block = gw.slice(gw.indexOf("path === '/turnlog'"));
    assert.match(block, /socket:/);
    assert.match(block, /connected_since/);
    assert.match(block, /last_ready_at/);
    assert.match(block, /fatal_reason/);
  });

  it('⚠️ connected_since is null when the socket is DOWN — never a stale uptime', () => {
    const block = gw.slice(gw.indexOf('socket: {'));
    assert.match(block.slice(0, 900), /this\.ws !== null\s*\?/, 'it must be gated on live state');
  });

  it('the deploy-eviction gap is named where somebody debugging will read it', () => {
    const block = gw.slice(gw.indexOf('socket: {'));
    assert.match(block.slice(0, 2000), /deploy evicts this Durable Object/i);
    assert.match(block.slice(0, 2000), /never delivered to the Worker at all/i);
  });

  it('⚠️ the fatal flag backs off hourly and clears only on a real handshake', () => {
    assert.match(gw, /FATAL_RETRY_MS/, 'the backoff constant is gone');
    assert.match(gw, /private async fatalHold\(/);
    // It must RESCHEDULE — standing down without an alarm is what made the old
    // behaviour permanent.
    const hold = gw.slice(gw.indexOf('const hold = await this.fatalHold();'));
    assert.match(hold.slice(0, 700), /setAlarm\(/, 'a hold with no alarm never retries');
    // …and only a successful READY clears it.
    const ready = gw.slice(gw.indexOf('K_LAST_READY, new Date().toISOString()'));
    assert.match(ready.slice(0, 600), /storage\.delete\(K_FATAL\)/);
  });
});

describe('⚠️ REGRESSION — the reply-with-the-ping-off blind spot', () => {
  const gw = strip(repoFile('src/gateway.ts'));

  it('she says it ONCE per person, not once per message', () => {
    const block = gw.slice(gw.indexOf('if (repliedToMe && contentLen === 0)'));
    assert.match(block.slice(0, 1200), /kPingTold\(authorId\)/, 'no per-person memory of having said it');
    // ⚠️ Stamped BEFORE the post: a send that succeeded without the stamp would
    // repeat for ever.
    const stamp = block.indexOf('storage.put(kPingTold');
    const post = block.indexOf('createChannelMessage(');
    assert.ok(stamp > 0 && post > 0 && stamp < post, 'stamp must precede the post');
  });

  it('⚠️ it only fires on a CONTENTLESS reply to HER — never on ordinary traffic', () => {
    const block = gw.slice(gw.indexOf('if (repliedToMe && contentLen === 0)'));
    assert.match(block.slice(0, 200), /repliedToMe && contentLen === 0/);
  });

  it('the sentence never guesses what they said, and never blames them', () => {
    const m = MENTION_MSG.replyPingOff;
    assert.match(m, /can't see what you wrote/i, 'she must say plainly that she cannot see it');
    assert.match(m, /Leave the ping on/i, 'and give the way out');
    assert.match(m, /only mention this once/i);
    assert.doesNotMatch(m, /\byou (?:should|need to|must|failed)\b/i, 'a Discord default is not their fault');
  });
});
