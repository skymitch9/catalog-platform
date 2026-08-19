/**
 * **RECALL, DONE BEFORE THE MODEL IS CONSULTED.**
 *
 * ⚠️ **THE LESSON LADDER, APPLIED TO A LANE BEFORE IT COULD FAIL RATHER THAN
 * AFTER.** Four incidents on 2026-08-18 taught it one rung at a time:
 *
 * | | The miss | The lesson |
 * |---|---|---|
 * | docs §12 | answered from the book shelf | offering a tool is not ROUTING to it |
 * | shelf 15:40 | the lane was never entered | …the same, again |
 * | shelf 16:25 | the lane was entered, the tool never called | ⚠️ **entering the lane is not CALLING the tool** |
 * | suggest 19:26 | a stranger's ordinary English matched no pattern | a detector tested against its author's idiolect |
 *
 * `shelf-flow.ts` was the fix for the third: lift the work AHEAD of the model, so
 * there is nothing left to interview anybody about. This file is that same move,
 * made **before** the failure rather than after it — and for this lane it is not
 * merely an improvement, it is the safety property:
 *
 * > ⚠️ **A recall answer must be impossible to satisfy by confabulation.**
 *
 * A model asked *"what did I tell you about X?"* with no tool result in front of
 * it will produce something plausible — that is what models do with questions
 * about a past they cannot see. The failure would be invisible: fluent, specific,
 * and about a conversation that never happened. So the search runs first, the
 * result (or the honest empty) goes into the prompt as **grounding**, and the
 * model composes from lines it can actually see, each carrying its date.
 *
 * ⚠️ **It holds no credential.** The archive port arrives injected, as every
 * other gated store does on this surface.
 */

import {
  recallTerms,
  renderRecall,
  RECALL_MSG,
  type ArchivePort,
  type RecallOutcome,
} from './archive.js';

/** What the lane produced: a block for the model, or a sentence to say as-is. */
export interface RecallGathered {
  /** Grounding for the model. Null when there is nothing to ground with. */
  grounding: string | null;
  /** ⚠️ Set when the lane cannot proceed at all — an outage, or no subject. It
   *  is said VERBATIM and no model is consulted, because a model handed "the
   *  store did not answer" will paraphrase it into something that sounds like a
   *  finding about the person's history. */
  say: string | null;
  /** For the turn ring: whether the search actually ran and what it found. */
  matched: number;
}

/**
 * Search the asker's own archive for what this question is about.
 *
 * ⚠️ **`person` IS THE CALLER'S, RESOLVED SERVER-SIDE** — it is a parameter of
 * this function and never of anything a model can reach.
 */
export async function gatherRecall(opts: {
  question: string;
  port: ArchivePort;
  person: string;
}): Promise<RecallGathered> {
  const terms = recallTerms(opts.question);
  if (terms.length === 0) {
    // ⚠️ NOTHING TO SEARCH FOR. *"Do you remember me?"* has no subject, and a
    // search for no terms would return the most recent turns and hand them over
    // as MATCHES — a confabulation with dates on it, which is worse than the
    // plain confabulation this lane exists to prevent.
    return { grounding: null, say: RECALL_MSG.noSubject, matched: 0 };
  }

  let outcome: RecallOutcome;
  try {
    outcome = await opts.port.recall({ person: opts.person, terms });
  } catch (err) {
    console.error('GABI recall: the search threw:', err instanceof Error ? err.message : err);
    return { grounding: null, say: RECALL_MSG.unreachable, matched: 0 };
  }

  // ⚠️ AN OUTAGE IS NOT AN EMPTY RESULT, and the two must never be worded alike.
  // "I have no record of that" said when the store simply did not answer is a
  // false statement about somebody's own history — and it is the one this lane
  // could most easily make, because both look like "nothing came back".
  if (!outcome.ok) return { grounding: null, say: outcome.message, matched: 0 };

  return { grounding: renderRecall(outcome, terms), say: null, matched: outcome.hits.length };
}
