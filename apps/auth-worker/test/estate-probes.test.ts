/**
 * The estate probe suite's Worker half — the record/read path and the
 * never-throws contract.
 *
 * ⚠️ WHAT IS NOT TESTED HERE: the probes themselves. `runProbeSuite()` makes
 * ~145 live requests to production; a unit test that called it would BE a probe
 * run, would fail whenever the estate was having a bad day, and would fail in a
 * way that says nothing about this file. So the suite is injected
 * (`opts.runSuite`) and what is asserted is everything the Worker wraps around
 * it — which is also where every failure mode that matters lives, because a
 * probe failing is the suite WORKING.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sameZoneFetch,
  PROBE_FAILURES_STORED,
  PROBE_RUNS_KEPT,
  readLatestProbeRun,
  recordProbeRun,
  runScheduledProbes,
  summariseFailures,
  type ProbeRunRow,
  type ProbeStore,
} from '../src/estate-probes.js';

// ---------------------------------------------------------------------------
// A D1 that records what it was asked
// ---------------------------------------------------------------------------

class FakeStore implements ProbeStore {
  rows: ProbeRunRow[] = [];
  queries: { sql: string; args: unknown[] }[] = [];
  insertThrows = false;
  selectThrows: string | null = null;
  /** Overrides what the SELECT answers, for the malformed-JSON case. */
  selectRow: Record<string, unknown> | null | undefined;

  prepare(sql: string) {
    const store = this;
    let args: unknown[] = [];
    const stmt = {
      bind(...a: unknown[]) {
        args = a;
        return stmt;
      },
      async run() {
        store.queries.push({ sql, args });
        if (/^INSERT INTO estate_probe_run/.test(sql)) {
          if (store.insertThrows) throw new Error('D1_ERROR: no such table: estate_probe_run');
          store.rows.push({
            started_at: args[0] as string,
            finished_at: args[1] as string,
            passed: args[2] as number,
            failed: args[3] as number,
            total: args[4] as number,
            truncated: args[5] as number,
            areas_run: args[6] as number,
            areas_total: args[7] as number,
            failures: args[8] as string,
            trigger: args[9] as string,
            error: args[10] as string | null,
          });
        }
        return { success: true };
      },
      async first<T>() {
        store.queries.push({ sql, args });
        if (store.selectThrows) throw new Error(store.selectThrows);
        if (store.selectRow !== undefined) return store.selectRow as T | null;
        const newest = store.rows[store.rows.length - 1];
        return (newest ? { id: store.rows.length, ...newest } : null) as T | null;
      },
    };
    return stmt;
  }
}

const row = (over: Partial<ProbeRunRow> = {}): ProbeRunRow => ({
  started_at: '2026-09-05T17:00:00.000Z',
  finished_at: '2026-09-05T17:00:31.000Z',
  passed: 145,
  failed: 0,
  total: 145,
  truncated: 0,
  areas_run: 9,
  areas_total: 9,
  failures: '[]',
  trigger: 'cron',
  error: null,
  ...over,
});

const result = (over: Record<string, unknown> = {}) => ({
  area: 'auth',
  id: 'A1',
  method: 'GET',
  endpoint: 'https://auth.heygabi.ai/api/health',
  assertion: 'answers 200',
  ok: true,
  observed: '',
  ...over,
});

// ---------------------------------------------------------------------------
// summariseFailures
// ---------------------------------------------------------------------------

test('summariseFailures keeps only the failures, and only five fields of each', () => {
  const out = summariseFailures([
    result(),
    result({ id: 'A2', ok: false, observed: 'status 500' }),
    result({ id: 'A3' }),
  ] as never);
  assert.equal(out.length, 1);
  assert.deepEqual(Object.keys(out[0]!).sort(), ['area', 'assertion', 'endpoint', 'id', 'observed']);
  assert.equal(out[0]!.observed, 'status 500');
});

test('⚠️ the failure list is CAPPED — the worst day must not be the biggest write', () => {
  // When every host is down, all 145 probes fail with near-identical text.
  // Storing them whole would put tens of kB of duplicated "did not answer" into
  // D1 every hour, during the incident, when D1 is the last thing to hammer.
  const all = Array.from({ length: 145 }, (_, i) =>
    result({ id: `A${i}`, ok: false, observed: 'did not answer within 6s' }),
  );
  assert.equal(summariseFailures(all as never).length, PROBE_FAILURES_STORED);
});

test('⚠️ a very long `observed` is truncated — this row lands on an OPEN /api/health', () => {
  const out = summariseFailures([
    result({ ok: false, observed: 'x'.repeat(5000) }),
  ] as never);
  assert.ok(out[0]!.observed.length <= 400, `observed was ${out[0]!.observed.length} chars`);
});

// ---------------------------------------------------------------------------
// recordProbeRun
// ---------------------------------------------------------------------------

test('recordProbeRun writes the run and trims the history to PROBE_RUNS_KEPT', async () => {
  const db = new FakeStore();
  assert.equal(await recordProbeRun(db, row()), true);
  assert.equal(db.rows.length, 1);

  const trim = db.queries.find((q) => /^DELETE FROM estate_probe_run/.test(q.sql));
  assert.ok(trim, 'no history trim was issued — the table would grow for ever');
  assert.deepEqual(trim.args, [PROBE_RUNS_KEPT]);
});

test('⚠️ a write that fails returns false rather than throwing — the cron must survive it', async () => {
  // A Worker deployed ahead of migration 0021 hits exactly this. "The probe run
  // could not be recorded" is worth a log line, not a failed invocation.
  const db = new FakeStore();
  db.insertThrows = true;
  assert.equal(await recordProbeRun(db, row()), false);
});

// ---------------------------------------------------------------------------
// readLatestProbeRun
// ---------------------------------------------------------------------------

test('⚠️ NOTHING EVER RUN answers null, NOT a zeroed run', async () => {
  // "no probe run has been recorded" and "0 of 145 passed" are opposite
  // sentences. A zero-filled placeholder renders the second while meaning the
  // first — the same reasoning as the event ring's `since` field.
  const db = new FakeStore();
  assert.equal(await readLatestProbeRun(db, Date.now()), null);
});

test('⚠️ a MISSING TABLE answers null too — /api/health is what a deploy is curled against', async () => {
  const db = new FakeStore();
  db.selectThrows = 'D1_ERROR: no such table: estate_probe_run';
  assert.equal(await readLatestProbeRun(db, Date.now()), null);
});

test('readLatestProbeRun reports the newest run with its age', async () => {
  const db = new FakeStore();
  await recordProbeRun(db, row());
  const now = Date.parse('2026-09-05T17:05:31.000Z');
  const latest = await readLatestProbeRun(db, now);

  assert.ok(latest);
  assert.equal(latest.passed, 145);
  assert.equal(latest.total, 145);
  assert.equal(latest.truncated, false);
  assert.equal(latest.age_ms, 5 * 60_000);
  assert.deepEqual(latest.failures, []);
});

test('⚠️ `truncated` survives the round trip as a BOOLEAN — never render a truncated run as green', async () => {
  const db = new FakeStore();
  await recordProbeRun(db, row({ truncated: 1, areas_run: 3, total: 41, passed: 41, failed: 0 }));
  const latest = await readLatestProbeRun(db, Date.parse('2026-09-05T17:01:00.000Z'));
  assert.equal(latest!.truncated, true);
  assert.equal(latest!.areas_run, 3);
  // 41 of 145 is not "41 passed": the other 104 were never asked, and unknown
  // is not a pass.
  assert.equal(latest!.total, 41);
});

test('a malformed failures blob degrades to an empty list, not a 500 on an open route', async () => {
  const db = new FakeStore();
  db.selectRow = { ...row({ failures: 'not json' }), id: 1 };
  const latest = await readLatestProbeRun(db, Date.now());
  assert.ok(latest);
  assert.deepEqual(latest.failures, []);
  // The counts beside it are COLUMNS, not JSON, so they survive a bad blob —
  // which is why they are the load-bearing half.
  assert.equal(latest.passed, 145);
});

// ---------------------------------------------------------------------------
// runScheduledProbes — the never-throws contract
// ---------------------------------------------------------------------------

test('a run with failures is recorded as a normal run, with `error` still null', async () => {
  const db = new FakeStore();
  const written = await runScheduledProbes(db, {
    runSuite: async () => ({
      passed: 140,
      failed: 5,
      total: 145,
      results: Array.from({ length: 5 }, (_, i) => result({ id: `A${i}`, ok: false, observed: 'status 500' })),
      truncated: false,
      startedAt: '2026-09-05T17:00:00.000Z',
      finishedAt: '2026-09-05T17:00:31.000Z',
      areasRun: 9,
      areasTotal: 9,
    }),
  } as never);

  // ⚠️ Failing probes are the suite WORKING. `error` is reserved for the runner
  // itself breaking, and conflating the two would send a reader to the wrong fix.
  assert.equal(written.error, null);
  assert.equal(written.failed, 5);
  assert.equal(JSON.parse(written.failures).length, 5);
  assert.equal(db.rows.length, 1);
});

test('⚠️ A SUITE THAT THROWS DOES NOT THROW OUT OF THE CRON — it is recorded with `error` set', async () => {
  const db = new FakeStore();
  const written = await runScheduledProbes(db, {
    runSuite: async () => {
      throw new Error('fetch is not defined');
    },
  } as never);

  assert.match(written.error!, /fetch is not defined/);
  // ⚠️ `total: 0` with `error` set, so nothing downstream can read this as
  // "0 failures". A crashed run is not a clean run.
  assert.equal(written.total, 0);
  assert.equal(written.failed, 0);
  assert.equal(written.truncated, 1);
  assert.equal(db.rows.length, 1, 'the crash was recorded, not swallowed');
});

test('⚠️ a crash AND an unwritable table still does not throw — the last line of defence', async () => {
  const db = new FakeStore();
  db.insertThrows = true;
  const written = await runScheduledProbes(db, {
    runSuite: async () => {
      throw new Error('everything is on fire');
    },
  } as never);
  assert.match(written.error!, /everything is on fire/);
  assert.equal(db.rows.length, 0);
});

// ---------------------------------------------------------------------------
// sameZoneFetch — ⚠️ THE FIX FOR A MEASURED FALSE RED
//
// The estate-probes cron's FIRST run (2026-09-06 01:19 UTC) reported 107/142
// passed, 35 failed, and every failure was an `auth.heygabi.ai` URL answering
// HTTP 522: a Cloudflare Worker cannot fetch its own zone. The same suite from
// a laptop was 145/145 minutes earlier. These tests pin the routing that keeps
// a "where it ran" artifact from rendering as a production failure.
// ---------------------------------------------------------------------------

test('⚠️ same-zone URLs go through the SELF binding, and nothing else does', async () => {
  const viaSelf: string[] = [];
  const self = {
    async fetch(url: string) {
      viaSelf.push(url);
      return new Response('{}', { status: 200 });
    },
  };
  const send = sameZoneFetch(self, 'https://auth.heygabi.ai');
  assert.ok(send);

  await send('https://auth.heygabi.ai/api/health', {});
  await send('https://auth.heygabi.ai/api/estate/me', {});
  assert.deepEqual(viaSelf, [
    'https://auth.heygabi.ai/api/health',
    'https://auth.heygabi.ai/api/estate/me',
  ]);

  // A foreign host must NOT be routed through the binding — a self-binding can
  // only reach this Worker's own routes, so sending index.heygabi.ai down it
  // would 404 against the wrong Worker and read as an outage.
  const originalFetch = globalThis.fetch;
  let networkCalls = 0;
  globalThis.fetch = (async (u: string) => {
    networkCalls += 1;
    assert.equal(u, 'https://index.heygabi.ai/api/health');
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
  try {
    await send('https://index.heygabi.ai/api/health', {});
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(networkCalls, 1);
  assert.equal(viaSelf.length, 2, 'the foreign host must not have touched the binding');
});

test('⚠️ a LOOKALIKE host is not same-zone — the match is a parsed origin, not a prefix', async () => {
  // `https://auth.heygabi.ai.example.test/` genuinely startsWith the origin, so
  // a prefix test would hand it to this Worker's own handler. Every probe URL is
  // a hardcoded constant today, which makes this defence in depth — but a
  // same-zone router has to be CERTAIN which requests it swallows.
  const viaSelf: string[] = [];
  const send = sameZoneFetch(
    { async fetch(url: string) { viaSelf.push(url); return new Response('{}'); } },
    'https://auth.heygabi.ai',
  );
  assert.ok(send);

  const originalFetch = globalThis.fetch;
  const viaNetwork: string[] = [];
  globalThis.fetch = (async (u: string) => {
    viaNetwork.push(u);
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
  try {
    await send('https://auth.heygabi.ai.example.test/api/health', {});
    await send('http://auth.heygabi.ai/api/health', {}); // scheme differs
    await send('not a url at all', {});
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(viaSelf, [], 'a lookalike, a wrong scheme or a junk URL must never reach the binding');
  assert.equal(viaNetwork.length, 3);
});

test('⚠️ an ABSENT binding returns undefined and says so — never a silent fallback', () => {
  // undefined means "the suite keeps global fetch", which is exactly what
  // produced the 35 x 522. It must be loud, because the symptom (every
  // same-zone probe red) looks identical to the estate being down.
  const errors: string[] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => { errors.push(args.join(' ')); };
  try {
    assert.equal(sameZoneFetch(undefined), undefined);
  } finally {
    console.error = originalError;
  }
  assert.equal(errors.length, 1);
  assert.match(errors[0]!, /522/);
  assert.match(errors[0]!, /SELF/);
});

test('the trigger is recorded, so a hand-run cannot pass as evidence the clock ticks', async () => {
  const db = new FakeStore();
  const written = await runScheduledProbes(db, {
    trigger: 'manual',
    runSuite: async () => ({
      passed: 1,
      failed: 0,
      total: 1,
      results: [result()],
      truncated: false,
      startedAt: '2026-09-05T17:00:00.000Z',
      finishedAt: '2026-09-05T17:00:01.000Z',
      areasRun: 9,
      areasTotal: 9,
    }),
  } as never);
  assert.equal(written.trigger, 'manual');
});
