/**
 * CLAUDE USAGE METER — GET/POST /api/estate/claude/usage.
 *
 * Owner, 2026-08-21: *"Add credit usage to the website too. Do that one now.
 * In fact the whole usage message you sent now in bold put that in the status
 * page in GABI."* The message he means is the line every substantive reply
 * carries under the global rules — session %, weekly %, Fable %, credits —
 * and the ask is to stop making him read it in a chat log.
 *
 * ── WHY THE NUMBER ARRIVES FROM OUTSIDE, LIKE PARITY DOES ───────────────────
 *
 * ⚠️ THERE IS NO API FOR THIS. The figures live on claude.ai/settings/usage,
 * behind the owner's own login, in a modal that page-text extraction does not
 * even see — they are read by a Claude session driving a browser. So the same
 * shape as shelf-parity.ts: something outside the estate computes, this Worker
 * only stores and serves. Do NOT "improve" this later by having the Worker
 * fetch anything; there is nothing to fetch, and a plausible number invented
 * server-side would be the exact failure this file exists to prevent.
 *
 * ── ONE TIMESTAMP, AND IT IS OURS ───────────────────────────────────────────
 *
 * ⚠️ THE REPORTER DOES NOT GET TO SAY WHEN IT READ THE METER. An early draft
 * carried both a sender `read_at` and a server `received_at`, which sounds more
 * honest and is not: it invites a session to post a figure it read twenty
 * minutes ago and have the page date it correctly, when what the page needs to
 * know is how old the NUMBER is. One timestamp, stamped here, and the contract
 * on the reporter is simply **post immediately after reading**. A clock we do
 * not control cannot be part of a staleness rule.
 *
 * ── WHAT IS STORED ──────────────────────────────────────────────────────────
 *
 * One KV key, `claude:usage:current`, replaced whole. No history: the question
 * is "where are we NOW", and every figure here is superseded the moment the
 * next one is read. A ring buffer would be a second thing to trim for numbers
 * that are already only meaningful for a couple of hours.
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import type { AppBindings } from './env.js';
import { requireDevops } from './middleware/auth.js';
import { keyById, verifyRegistryKey } from './machine-keys.js';
import { readRecord, stampUsed, type TokenRecord } from './shelf-token.js';

export const claudeUsageRoutes = new Hono<AppBindings>();

/** The one key. Replaced whole on every report. */
export const USAGE_KEY = 'claude:usage:current';

/**
 * ⚠️ THE MOST IMPORTANT NUMBER IN THE FILE — the same role STALE_AFTER_MS
 * plays in shelf-parity.ts, for a sharper reason.
 *
 * The session window is FIVE HOURS. A figure three hours old can therefore
 * belong to a session window that has already reset, which does not make it
 * merely old — it makes it about a different thing. Worse, usage only ever
 * moves in one direction inside a window, so a stale reading is always an
 * UNDER-estimate, and the one failure mode that matters here is a comfortable
 * number that is comfortable because nobody has looked recently.
 *
 * ⚠️ "No report" is NOT "usage is fine". The global rules were strengthened
 * twice over exactly this inference; the page must never let a reader make it.
 */
export const STALE_AFTER_MS = 3 * 60 * 60 * 1000;

/**
 * The thresholds, from ~/.claude/CLAUDE.md, in one place so the page and the
 * API cannot drift apart on what a number MEANS.
 *
 * ⚠️ THE SESSION AND WEEKLY LIMITS DO NOT SHARE A THRESHOLD, and treating them
 * as one meter is a mistake the rules call out by name: it wasted roughly a
 * session's worth of weekly budget every time it fired. 89% is calibrated for
 * the session window; on the weekly limit it is far too conservative, because
 * a full session costs only ~9 weekly points and an orderly shutdown costs
 * 0.2–0.4.
 */
export const SESSION_PAUSE_PCT = 89;
/** Stop starting NEW AGENTS — the irreversible commitment. */
export const WEEKLY_NO_AGENTS_PCT = 93;
/** Stop even conversational work. Commits and edits are individually tiny. */
export const WEEKLY_STOP_PCT = 97;

/** Bounded so a malformed or hostile report cannot become a storage problem. */
const MAX_TEXT = 60;
/** $100,000 in cents — a bound, not an expectation. */
const MAX_CENTS = 10_000_000;

export type UsageReport = {
  /** Current session window, whole percent as displayed. */
  session_pct: number;
  /** Weekly "All models". */
  weekly_pct: number;
  /** Weekly Fable. */
  fable_pct: number;
  /** Usage credits. */
  credits_pct: number;
  /** Dollars spent against the credit pool, in CENTS. Optional. */
  credits_spent_cents?: number;
  /** Verbatim from the page, e.g. "Resets in 4 hr 20 min". Optional. */
  session_resets?: string;
  /** Verbatim, e.g. "Resets Sun 3:59 PM". Optional. */
  weekly_resets?: string;
  /** Verbatim, e.g. "Resets Sep 1". Optional. */
  credits_resets?: string;
};

export type StoredUsage = UsageReport & { received_at: string };

/**
 * ⚠️ INTEGERS ONLY, 0–100, AND THAT IS A CORRECTNESS GUARD, NOT TIDINESS.
 * The meters display WHOLE PERCENT. A fractional value therefore cannot have
 * been read off the page — it can only have been computed, estimated or
 * interpolated by the reporter, which is precisely the "assumption wearing a
 * measurement's clothes" the estate's verification rules forbid. Rejecting it
 * is how that stays impossible rather than merely discouraged.
 */
function pctOk(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 100;
}

function textOk(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= MAX_TEXT;
}

export function validateUsage(body: unknown): { ok: true; report: UsageReport } | { ok: false; detail: string } {
  if (typeof body !== 'object' || body === null) {
    return { ok: false, detail: 'The report must be a JSON object.' };
  }
  const b = body as Record<string, unknown>;

  for (const f of ['session_pct', 'weekly_pct', 'fable_pct', 'credits_pct'] as const) {
    if (!pctOk(b[f])) {
      return {
        ok: false,
        detail: `"${f}" must be a whole number 0–100, read directly off claude.ai/settings/usage. The meters show whole percent; a fraction means it was computed rather than read.`,
      };
    }
  }

  const report: UsageReport = {
    session_pct: b.session_pct as number,
    weekly_pct: b.weekly_pct as number,
    fable_pct: b.fable_pct as number,
    credits_pct: b.credits_pct as number,
  };

  if (b.credits_spent_cents !== undefined) {
    const c = b.credits_spent_cents;
    if (typeof c !== 'number' || !Number.isInteger(c) || c < 0 || c > MAX_CENTS) {
      return { ok: false, detail: `"credits_spent_cents" must be a whole number of cents between 0 and ${MAX_CENTS}.` };
    }
    report.credits_spent_cents = c;
  }

  // ⚠️ The reset strings are stored VERBATIM and rendered as TEXT, never as
  // markup. They come from a page we do not control, through a bearer that
  // lives on a machine, and the status page is a devops surface — a reset
  // label is not worth an injection surface. status.js uses textContent.
  for (const f of ['session_resets', 'weekly_resets', 'credits_resets'] as const) {
    if (b[f] !== undefined) {
      if (!textOk(b[f])) {
        return { ok: false, detail: `"${f}", if sent, must be a non-empty string of at most ${MAX_TEXT} characters.` };
      }
      report[f] = b[f] as string;
    }
  }

  return { ok: true, report };
}

export type UsageState =
  | 'never_reported'
  | 'unknown'
  | 'weekly_stop'
  | 'session_pause'
  | 'weekly_no_agents'
  | 'ok';

/**
 * Turn a stored report + the clock into the state the page renders.
 *
 * Pure and exported: these branches decide whether somebody believes they have
 * budget, and none of them should need a live Worker to test.
 *
 * ⚠️ ORDER MATTERS, TWICE OVER.
 *
 * 1. Staleness is checked FIRST, so an old comfortable number can never render
 *    green. Usage only rises inside a window, so a stale figure is always an
 *    under-estimate — the one direction of error that gets a run killed.
 * 2. Then MOST SEVERE FIRST, and the middle two are not in numeric order on
 *    purpose: `session_pause` (89% session) outranks `weekly_no_agents` (93%
 *    weekly) because the session rule says stop working and shut down in an
 *    orderly way, while the weekly one at 93% only says stop starting AGENTS —
 *    ordinary conversational work continues to 97%. Sorting these by the
 *    percentage rather than by what they ask you to DO would quietly downgrade
 *    the stricter instruction.
 */
export function deriveUsageState(stored: StoredUsage | null, nowMs: number): { state: UsageState; detail: string } {
  if (!stored) {
    return {
      state: 'never_reported',
      detail:
        'No Claude session has reported usage yet. This is not a claim that usage is low — it is the absence of a reading.',
    };
  }

  const age = nowMs - Date.parse(stored.received_at);
  if (!Number.isFinite(age) || age > STALE_AFTER_MS) {
    return {
      state: 'unknown',
      detail:
        'The last reading is more than three hours old, so it may belong to a session window that has already reset. Usage only ever rises inside a window, so a stale figure is an under-estimate — treat this as no reading at all, not as a low one.',
    };
  }

  if (stored.weekly_pct >= WEEKLY_STOP_PCT) {
    return {
      state: 'weekly_stop',
      detail: `Weekly is at ${stored.weekly_pct}%. Stop — including conversational work. The weekly limit is the real ceiling: missing a session reset costs hours, missing this one costs days.`,
    };
  }
  if (stored.session_pct >= SESSION_PAUSE_PCT) {
    return {
      state: 'session_pause',
      detail: `The session window is at ${stored.session_pct}%. The last ~10% is the budget for an orderly shutdown — refresh the handoff, commit, push — not runway for more work.`,
    };
  }
  if (stored.weekly_pct >= WEEKLY_NO_AGENTS_PCT) {
    return {
      state: 'weekly_no_agents',
      detail: `Weekly is at ${stored.weekly_pct}%. No new agents — a subagent's cost is invisible until it lands, and one has arrived at 372k tokens in a single lump. Conversational work is fine to ${WEEKLY_STOP_PCT}%.`,
    };
  }
  return { state: 'ok', detail: 'Inside every threshold. Agents and ordinary work are both fine.' };
}

/**
 * POST — a Claude session reporting what it just read. Bearer only.
 *
 * ⚠️ A SIGNED-IN COOKIE MUST NOT WORK HERE, for the same reason it must not on
 * the parity route: this is machine auth, and a browser session must never be
 * able to write the number that says how much budget is left.
 *
 * ⚠️ NO LEGACY ENV LEG. Every other migrated route carries one because it had a
 * hand-delivered predecessor installed somewhere unreachable. This key is new,
 * so it starts life self-service-only — adding a fallback "for symmetry" would
 * create a second credential with no rotation story, which is exactly what the
 * shelf key is currently trying to get rid of.
 */
claudeUsageRoutes.post('/estate/claude/usage', async (c: Context<AppBindings>) => {
  const kv = c.env.estate_docs;
  if (!kv) {
    return c.json({ error: 'docs_kv_unbound', fix: 'add the estate_docs kv_namespaces binding' }, 503);
  }

  const def = keyById('claude-usage');
  if (!def) {
    // Unreachable while the registry entry exists; a 500 rather than a silent
    // accept, because the alternative is an unauthenticated write route.
    return c.json({ error: 'key_registry_missing', detail: 'No claude-usage entry in the key registry.' }, 500);
  }

  const header = c.req.header('authorization') ?? null;
  const presented = /^Bearer\s+(.+)$/i.exec((header ?? '').trim())?.[1]?.trim() ?? '';

  let verdict: Awaited<ReturnType<typeof verifyRegistryKey>>;
  try {
    verdict = await verifyRegistryKey(kv, def, presented, undefined, Date.now());
  } catch {
    return c.json({ error: 'machine_key_corrupt', detail: 'The stored key record is unreadable.' }, 500);
  }

  if (verdict === 'no_match') {
    // ⚠️ TELL THE TWO CAUSES APART. "No key has ever been minted" and "your
    // bearer is wrong" need different actions, and a single message sends
    // whoever is debugging to run the wrong one. shelf-parity.ts learned this
    // the hard way with `secret_unset`.
    let rec: TokenRecord | null = null;
    try {
      rec = await readRecord(kv, def.kvKey!);
    } catch {
      rec = null;
    }
    if (!presented) {
      return c.json(
        {
          error: 'unauthenticated',
          detail: 'This endpoint takes the Claude usage reporter key as a bearer. No Authorization header was sent.',
          fix: 'Send: Authorization: Bearer <CLAUDE_USAGE_TOKEN>.',
        },
        401,
      );
    }
    if (rec === null) {
      return c.json(
        {
          error: 'claude_usage_key_unminted',
          detail: 'No Claude usage reporter key has ever been minted, so nothing can authenticate here yet.',
          fix: 'Generate one at https://heygabi.ai/status/api (devops sign-in) — the value is shown once.',
        },
        503,
      );
    }
    return c.json(
      {
        error: 'bad_token',
        detail: 'That bearer is not the Claude usage reporter key. A key does exist, so this is a wrong value, not a missing one.',
        fix: 'Rotate at https://heygabi.ai/status/api and re-install it where the reporter reads it.',
      },
      401,
    );
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'bad_json', detail: 'The body was not readable JSON.' }, 400);
  }

  const v = validateUsage(body);
  if (!v.ok) return c.json({ error: 'bad_report', detail: v.detail }, 400);

  const stored: StoredUsage = { ...v.report, received_at: new Date().toISOString() };
  await kv.put(USAGE_KEY, JSON.stringify(stored));

  if (verdict === 'current' || verdict === 'previous') {
    let rec: TokenRecord | null = null;
    try {
      rec = await readRecord(kv, def.kvKey!);
    } catch {
      rec = null;
    }
    if (rec) await stampUsed(kv, rec, stored.received_at, def.kvKey, verdict);
  }

  const { state } = deriveUsageState(stored, Date.now());
  return c.json({
    ok: true,
    received_at: stored.received_at,
    state,
    // Told plainly so a rotation nobody finished is visible in the reporter's
    // own output, not only on a page nobody has open.
    key: verdict === 'previous' ? 'previous (grace window — install the new key)' : verdict,
  });
});

/** GET — the status page reading. Devops-gated, like parity and the key registry. */
claudeUsageRoutes.get('/estate/claude/usage', requireDevops(), async (c: Context<AppBindings>) => {
  const kv = c.env.estate_docs;
  if (!kv) {
    return c.json({ error: 'docs_kv_unbound', fix: 'add the estate_docs kv_namespaces binding' }, 503);
  }

  const raw = await kv.get(USAGE_KEY, 'text');
  let stored: StoredUsage | null = null;
  if (raw) {
    try {
      stored = JSON.parse(raw) as StoredUsage;
    } catch {
      stored = null; // an unreadable stored value renders as never_reported, not as a 500
    }
  }

  const { state, detail } = deriveUsageState(stored, Date.now());
  return c.json({
    state,
    detail,
    report: stored,
    thresholds: {
      session_pause_pct: SESSION_PAUSE_PCT,
      weekly_no_agents_pct: WEEKLY_NO_AGENTS_PCT,
      weekly_stop_pct: WEEKLY_STOP_PCT,
      stale_after_ms: STALE_AFTER_MS,
    },
  });
});
