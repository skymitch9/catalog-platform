/**
 * **DEADLINES — because a HANG is the one failure that says nothing.**
 *
 * ## ⚠️ The 2026-08-18 silent turn, and what it taught
 *
 * A real person asked GABI a question in a channel and got **nothing**: no
 * answer, no error message, no log line, no exception in a `wrangler tail`.
 * Every other failure mode this Worker has ends in words — a refusal, an outage
 * sentence, a capped sentence, a caught throw. **A hang ends in nothing at all**,
 * because every one of those sentences is written by code that never runs.
 *
 * ⚠️ **AND A HANG IS EASY TO SHIP BY ACCIDENT.** Four of this Worker's outbound
 * calls carry `AbortSignal.timeout(...)` — the books port, the catalogue CSV, the
 * docs port, the delegated verbs. Three did not: the estate index lookup, the
 * Firestore profile read, and Discord itself. Nothing marks the difference at a
 * call site; you only notice when a socket somewhere stops answering and a
 * person is left staring at a channel.
 *
 * ⚠️ **The root cause of that specific silence was never proven** (the ring and
 * the retained logs did not exist yet, so its evidence is gone for ever). This
 * file is therefore deliberately a **class fix rather than a bug fix**: it makes
 * the whole family impossible to reproduce, whichever member of it fired.
 *
 * ## ⚠️ A DEADLINE IS NOT A CANCELLATION, AND SAYING SO MATTERS
 *
 * `withDeadline` does not stop the slow work — it stops WAITING for it. The
 * promise keeps running; the Worker simply proceeds with a stated fallback. That
 * is the correct trade on a conversational surface: the alternative to a slightly
 * worse answer is no answer, and no answer is the thing being fixed.
 *
 * The one consequence worth writing down: a raced-past call may still complete
 * afterwards and log. A stray *"profile read failed"* line arriving after a turn
 * has been answered is not a fault — it is the tail of a race that was won
 * deliberately.
 */

/** Resolved when the deadline wins, so the caller can say WHICH happened rather
 *  than guessing from a fallback value that might be legitimate. */
export interface DeadlineOutcome<T> {
  value: T;
  timedOut: boolean;
}

/**
 * Wait for `work`, but never longer than `ms`.
 *
 * ⚠️ **`work` rejecting is NOT the deadline's business** — a caller that wants
 * failures swallowed catches them itself, exactly as `profileFor` already does.
 * Folding "it threw" and "it was slow" together here would hide a real outage
 * inside a latency figure.
 */
export async function withDeadline<T>(
  work: Promise<T>,
  ms: number,
  fallback: T,
): Promise<DeadlineOutcome<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const alarm = new Promise<DeadlineOutcome<T>>((resolve) => {
    timer = setTimeout(() => resolve({ value: fallback, timedOut: true }), ms);
  });
  try {
    return await Promise.race([
      work.then((value) => ({ value, timedOut: false })),
      alarm,
    ]);
  } finally {
    // ⚠️ Cleared on BOTH paths. A live timer holds the isolate awake, which on a
    // Durable Object whose duration is the metered resource is a slow leak
    // rather than a crash — the worst kind to find later.
    if (timer !== undefined) clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// The numbers, and why each is what it is
// ---------------------------------------------------------------------------

/**
 * ⚠️ **THE WHOLE-TURN WATCHDOG.** The backstop that makes the invariant
 * *"no taken turn ends in silence"* true **without knowing which call hung** —
 * which matters, because the incident that prompted it was never diagnosed.
 *
 * 25 seconds is chosen against the pieces rather than picked: the model client's
 * own timeout is 20s (`CHAT_TIMEOUT_MS`) and a turn may make several calls, so
 * anything under 20 would fire on turns that were merely slow and were about to
 * succeed. It is a floor on patience, not a target.
 *
 * ⚠️ It does not cancel the turn. If the real answer lands afterwards the person
 * gets it as a second message, and `MENTION_MSG.stillThinking` is worded so that
 * reads as a follow-through rather than a contradiction.
 */
export const TURN_WATCHDOG_MS = 25_000;

/** The per-turn profile read (Firestore + an OAuth mint). ⚠️ Tier 2 is a
 *  NICETY — design §7 prices it at ≈0.05¢ a turn — so it gets the shortest
 *  patience of anything here. A turn without her memory is a turn; a turn that
 *  never happens is not. */
export const PROFILE_READ_MS = 4_000;

/** The public index lookup that grounds an ordinary question. Longer than the
 *  profile read because its result is often the ANSWER rather than colour, and
 *  shorter than the model's own timeout because it is one plain GET. */
export const INDEX_LOOKUP_MS = 8_000;
