/**
 * **THE RECENT TURN LOG — what fired, what hid, and what said nothing.**
 *
 * ## ⚠️ THE INCIDENT THIS EXISTS FOR (2026-08-18, 7:28 PM Phoenix)
 *
 * The second real non-owner user ever to talk to GABI asked *"what is the fourth
 * book in the Dungeon Crawler Carl series?"* in a channel, two minutes after
 * GABI had answered somebody else in the same channel. **She said nothing at
 * all.** The asker's next message was *"Did you turn her off?"*
 *
 * She had not been turned off. And when the question *"why was there no
 * answer?"* was put to the estate, **there was nowhere to look**:
 *
 * | Instrument | What it could say about 7:28 PM |
 * |---|---|
 * | `wrangler tail` | nothing — it is a LIVE stream and nobody was watching |
 * | Workers Logs | nothing — ⚠️ `[observability]` was not enabled on this Worker |
 * | the worker event ring | nothing — `discord-worker` was never wired to it |
 * | the conversation store | nothing — an unanswered turn writes no record, by design |
 * | the daily fuses | ⚠️ counts only, with no per-turn history |
 *
 * **Every one of those absences is correct on its own terms, and together they
 * meant a real person's complaint could not be investigated at all.** That is
 * what this file fixes. It is not a log; it is the smallest possible ring that
 * makes *"she didn't answer me"* a checkable claim.
 *
 * ## ⚠️ IT RECORDS WHAT HAPPENED. IT NEVER RECORDS WHAT WAS SAID.
 *
 * No question text, no answer text, no book title, no retrieved passage — and
 * `test/turnlog.test.ts` reads this source and fails the build if a field for
 * any of them appears. Two separate reasons, and either alone would be enough:
 *
 *  1. `gabi-bare-text-triggers-memo.md` §6.2 names the estate's most fragile
 *     privacy promise — *"nothing logs the content"* — as being **"one careless
 *     line away from being false"**. This is exactly the file that would be that
 *     line.
 *  2. The ring is read behind the **devops** gate, which is wider than the gates
 *     on what she actually reads for people: a book passage is `vis_ebooks`, a
 *     TBR is the person's own. Their content must not leak upward into an
 *     operations surface.
 *
 * What a devops reader gets instead is the SHAPE of the turn: which door it came
 * through, which lane claimed it, which tools fired, what scope hid it, and
 * whether it ended in words. That answers *"why was she silent?"* without
 * answering *"what did they ask?"*.
 */

// ---------------------------------------------------------------------------
// The ring
// ---------------------------------------------------------------------------

/**
 * ⚠️ **HOW MANY TURNS ARE KEPT, AND WHY IT IS THIS SMALL.**
 *
 * The whole ring is ONE Durable Object row, rewritten once per recorded turn.
 * That write rides along with `recordTurn`'s existing two, so the budget
 * arithmetic in `wrangler.toml` moves from ≈2,500/day to ≈2,700/day against the
 * free plan's 100,000 — still under 3%, and still bounded by the same
 * `GLOBAL_TURNS_PER_DAY = 200` fuse that bounds everything else on this surface.
 *
 * ⚠️ 40 rows × ~180 bytes ≈ 7 KB, comfortably inside the 128 KiB per-value
 * ceiling. A bigger ring would be a bigger row rewritten on every turn, which is
 * the one way this could become expensive.
 */
export const TURN_LOG_ROWS = 40;

/** How the turn reached her. `ignored` is a NON-turn kept deliberately — see
 *  `TurnLogEntry.why`. */
export type TurnLogVia = 'mention' | 'reply' | 'dm' | 'component' | 'ignored';

/**
 * ⚠️ **FIVE OUTCOMES, AND `silent` IS THE ONE THE RING WAS BUILT FOR.**
 *
 * | outcome | means |
 * |---|---|
 * | `answered` | words reached the channel |
 * | `capped` | a fuse refused — ⚠️ and she SAID so; a capped turn is not a silent one |
 * | `error` | something threw, and the catch spoke |
 * | `silent` | ⚠️ **she took the turn and nothing reached the channel.** The prohibited outcome |
 * | `ignored` | it was never a turn: not addressed to her, or empty |
 */
export type TurnLogOutcome = 'answered' | 'capped' | 'error' | 'silent' | 'ignored';

export interface TurnLogEntry {
  at: number;
  /** ⚠️ A Discord snowflake, never a display name and never the message text.
   *  The same no-PII line `/api/health` and the `gabi_turn` accounting draw, and
   *  the same one the personality ROSTER already draws for devops readers. */
  person: string;
  via: TurnLogVia;
  outcome: TurnLogOutcome;
  /** Which channel — a snowflake. Two people in two channels is the commonest
   *  thing to need to tell apart when somebody says "she ignored me". */
  channel?: string;
  /** The classifier's answer, when the turn got that far. */
  intent?: string;
  /** ⚠️ Which LANE claimed the turn — docs / books / shelf / suggest / recall /
   *  memory / catalogue / delegated / persona / chat. The single most useful
   *  field, because three separate 2026-08-18 incidents were all a turn entering
   *  the wrong lane, and none of them was visible from outside. */
  lane?: string;
  /** ⚠️ Tool names that ACTUALLY EXECUTED, in order. Offering a tool is not
   *  calling it, and this is the field that tells those apart after the fact. */
  tools?: string[];
  /**
   * ⚠️ **WHAT SCOPE HID.** A posture that was off, a fuse that refused, an
   * identity that was not linked, a grant the estate declined. The owner asked
   * for this by name, and it is the difference between *"she couldn't"* and
   * *"she wouldn't"* — which are different problems with different fixes.
   */
  hid?: string[];
  /** For `ignored`: the reason `mentionTrigger` declined. */
  why?: string;
  /** Wall-clock milliseconds. A turn that took 20 seconds and a turn that never
   *  started look identical from a channel. */
  ms?: number;
}

/**
 * Append, newest LAST, dropping oldest first.
 *
 * Pure so the ring is testable without a Durable Object — and so the one thing
 * that must never happen (unbounded growth in a per-turn row write) is provable
 * rather than reviewed.
 */
export function pushTurnLog(
  ring: readonly TurnLogEntry[] | undefined,
  entry: TurnLogEntry,
  max = TURN_LOG_ROWS,
): TurnLogEntry[] {
  const next = [...(ring ?? []), entry];
  return next.length > max ? next.slice(next.length - max) : next;
}

/** Newest first, for a reader. ⚠️ The stored order is oldest-first because that
 *  is what makes the append cheap; the display order is the other one, and
 *  conflating them is how a "recent" list shows the oldest forty. */
export function turnLogForDisplay(ring: readonly TurnLogEntry[] | undefined): TurnLogEntry[] {
  return [...(ring ?? [])].reverse();
}

// ---------------------------------------------------------------------------
// ⚠️ THE COLLECTOR — one mutable bag per turn, passed down the config
// ---------------------------------------------------------------------------

/**
 * What the lanes write into while a turn runs.
 *
 * ⚠️ **A MUTABLE COLLECTOR RATHER THAN A RETURN VALUE, DELIBERATELY.** Threading
 * a trace back out through `answerQuestion`, five lane functions and
 * `converseWithTools` would be a signature change in a dozen places and a
 * reviewer would have no way to see which one forgot. One bag on the config
 * reaches every lane that already takes the config, and `runTool` — the single
 * dispatch point every tool family goes through — records the calls for all of
 * them at once.
 *
 * ⚠️ **It is OPTIONAL everywhere.** A caller that does not pass one (every test,
 * the component lane before it was wired) behaves exactly as before, and nothing
 * here can fail a turn: every method is a push onto an array.
 */
export interface TurnTrace {
  lane(name: string): void;
  tool(name: string): void;
  hid(reason: string): void;
  read(): { lane?: string; tools: string[]; hid: string[] };
}

/**
 * ⚠️ **THE FIRST LANE WINS.** A turn is claimed once, by the first pre-router
 * that takes it; a later helper calling `lane()` again is describing where it
 * ended up inside that lane, not a second claim. Recording the last one would
 * make every docs answer that fell back to a shelf lookup read as a shelf turn —
 * which is precisely the confusion the 2026-08-18 routing incidents produced.
 */
export function newTurnTrace(): TurnTrace {
  let lane: string | undefined;
  const tools: string[] = [];
  const hid: string[] = [];
  return {
    lane(name) {
      if (!lane && name) lane = name;
    },
    tool(name) {
      // Bounded: a runaway loop must not make one ring row unbounded.
      if (name && tools.length < 16) tools.push(name);
    },
    hid(reason) {
      if (reason && hid.length < 8 && !hid.includes(reason)) hid.push(reason);
    },
    read() {
      return { ...(lane ? { lane } : {}), tools, hid };
    },
  };
}

/** The reasons a scope hides a turn, named once so the page and the tests agree.
 *  ⚠️ An array of KNOWN strings rather than free text: a reason nobody can find
 *  in this file is a reason nobody can search the ring for. */
export const HID_REASONS = [
  'docs_switched_off',
  'docs_not_configured',
  'docs_capped',
  'books_switched_off',
  'books_not_configured',
  'books_capped',
  'shelf_switched_off',
  'shelf_not_configured',
  'shelf_unlinked',
  'suggest_switched_off',
  'suggest_gate_refused',
  'memory_switched_off',
  'recall_switched_off',
  'recall_not_configured',
  'recall_unavailable',
  'delegated_switched_off',
  'delegated_not_configured',
  'not_devops',
  'turn_capped',
  'estate_unreachable',
] as const;

export type HidReason = (typeof HID_REASONS)[number];
