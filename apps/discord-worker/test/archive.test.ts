/**
 * **TIERS 3 AND 4 — the 90-day archive and the recall tool.**
 *
 * The three properties these tests exist to keep true, in the order they would
 * hurt if they broke:
 *
 *  1. ⚠️ **PRIVACY IS A `where` CLAUSE, NOT A PROMPT INSTRUCTION.** There is no
 *     parameter on the tool that names a person, so *"search Sam's
 *     conversations"* is unrepresentable rather than refused.
 *  2. ⚠️ **A REMEMBERED WRONG CLAIM IS WORSE THAN A FRESH ONE.** Recall results
 *     are quoted with their dates and never absorbed into the present tense.
 *  3. ⚠️ **A CLEAR MUST MEAN A DELETE**, must say which of the two stores it
 *     cleared, and must never report "done" over a delete that did not finish.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import {
  archiveDocId,
  expiresAtFor,
  rankRecall,
  recallIntent,
  recallTerms,
  renderRecall,
  scoreRecall,
  ARCHIVE_RETENTION_DAYS,
  RECALL_MSG,
  type ArchiveTurn,
} from '../src/archive.js';
import { gatherRecall } from '../src/recall-flow.js';
import { memoryCommand, MEMORY_MSG, profileForDisplay, emptyProfile } from '../src/memory.js';
import {
  GABI_RECALL_TOOLS,
  GABI_RECALL_TOOL_NAMES,
  isGabiRecallToolName,
  toolsForApi,
} from '../src/gabi-tools.js';

function repoFile(relative: string): string {
  return readFileSync(fileURLToPath(new URL(`../${relative}`, import.meta.url).href), 'utf8');
}
const strip = (x: string) => x.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

function turn(over: Partial<ArchiveTurn> & { text: string; at: number }): ArchiveTurn {
  return { person: 'discord:1', surface: 'discord_dm', space: 'c1', role: 'user', ...over };
}

// ---------------------------------------------------------------------------
// 1. Privacy
// ---------------------------------------------------------------------------

describe('⚠️ privacy is structural, not instructed', () => {
  it('the tool schema has NO parameter that could name a person', () => {
    const tool = GABI_RECALL_TOOLS[0];
    assert.ok(tool);
    const props = Object.keys(tool.input_schema.properties);
    assert.deepEqual(props.sort(), ['query', 'since_days']);
    for (const forbidden of ['person', 'user', 'uid', 'who', 'author', 'discord_id', 'email']) {
      assert.ok(!props.includes(forbidden), `the schema gained ${forbidden}`);
    }
    assert.equal(tool.input_schema.additionalProperties, false);
  });

  it('the executor takes the person from the CONTEXT and never from args', () => {
    const src = strip(repoFile('src/tool-exec.ts'));
    const body = src.slice(src.indexOf('async function runRecallTool'));
    assert.match(body, /person: ctx\.recall\.person/, 'the person must come from the context');
    assert.doesNotMatch(body, /args\.person|args\[.person.\]/, 'a person from args is a prompt injection');
  });

  it('the person key is built at the composition root from the asker`s own id', () => {
    const flow = strip(repoFile('src/mention-flow.ts'));
    const fn = flow.slice(flow.indexOf('function archiveContextFor'));
    assert.match(fn.slice(0, 600), /personKey\(\{ discordUserId \}\)/);
  });

  it('the recall tool is opt-in per call, and OFF by default', () => {
    const none = toolsForApi().map((t) => t.name);
    assert.ok(!none.includes('recall_conversation'), 'a default caller must not be offered it');
    const on = toolsForApi({ recall: true }).map((t) => t.name);
    assert.ok(on.includes('recall_conversation'));
    // ⚠️ One opt-in must not grant another.
    assert.ok(!toolsForApi({ docs: true }).map((t) => t.name).includes('recall_conversation'));
  });

  it('it is READ-ONLY and its own category, so no family can drift into it', () => {
    for (const t of GABI_RECALL_TOOLS) {
      assert.equal(t.mutates, false);
      assert.deepEqual(t.methods, ['GET']);
      assert.equal(t.reads, 'own_past_conversations');
    }
    assert.equal(GABI_RECALL_TOOL_NAMES.length, GABI_RECALL_TOOLS.length);
    assert.equal(isGabiRecallToolName('recall_conversation'), true);
    assert.equal(isGabiRecallToolName('toString'), false, 'the classic allowlist hole');
  });

  it('⚠️ THE FIVE-MODULE CREDENTIAL GUARD IS UNCHANGED — no sixth exec module', () => {
    const CREDENTIALS = [
      /firestoreRequest/,
      /mintAccessToken/,
      /parseServiceAccount/,
      /FIREBASE_SERVICE_ACCOUNT/,
      /ESTATE_APP_TOKEN/,
      /DISCORD_BOT_TOKEN/,
    ];
    for (const f of ['src/archive.ts', 'src/recall-flow.ts', 'src/turnlog.ts', 'src/deadline.ts']) {
      const src = strip(repoFile(f));
      for (const bad of CREDENTIALS) assert.doesNotMatch(src, bad, `${f} now names ${bad}`);
    }
    // …and the implementation lives beside the profile, in the module that
    // already held that credential.
    assert.match(repoFile('src/memory-exec.ts'), /export function makeArchivePort/);
  });
});

// ---------------------------------------------------------------------------
// 2. Honesty — dates, and never the present tense
// ---------------------------------------------------------------------------

describe('⚠️ a recall result is quoted with its date, never absorbed', () => {
  const hits = [turn({ text: 'I am halfway through Primal Hunter 9', at: Date.parse('2026-08-01') })];

  it('every rendered line carries its date and who said it', () => {
    const out = renderRecall(
      { ok: true, hits: rankRecall(hits, ['primal']), scanned: 1, reachedBack: hits[0]!.at, truncated: false },
      ['primal'],
    );
    assert.match(out, /2026-08-01/, 'the date must be on the line');
    assert.match(out, /THEY said/);
    assert.match(out, /QUOTE THESE WITH THEIR DATES/);
    assert.match(out, /never "you like …" or "you are reading …"/i);
  });

  it('⚠️ it forbids using recall to decide what SHE has read', () => {
    const out = renderRecall(
      { ok: true, hits: rankRecall(hits, ['primal']), scanned: 1, reachedBack: hits[0]!.at, truncated: false },
      ['primal'],
    );
    assert.match(out, /Nothing here tells you what you have READ/i);
    assert.match(out, /look it up in this turn/i);
  });

  it('⚠️ an EMPTY result says so, says how far back it looked, and forbids inventing', () => {
    const out = renderRecall(
      { ok: true, hits: [], scanned: 40, reachedBack: Date.parse('2026-07-01'), truncated: false },
      ['mistborn'],
    );
    assert.match(out, /NOTHING MATCHED/);
    assert.match(out, /2026-07-01/, 'an empty answer must state its own reach');
    assert.match(out, /Do NOT reconstruct/i);
    assert.match(out, /An empty result is a real answer/i);
  });

  it('⚠️ a TRUNCATED scan says the older turns were NOT searched', () => {
    const out = renderRecall(
      { ok: true, hits: [], scanned: 200, reachedBack: Date.parse('2026-08-10'), truncated: true },
      ['x'],
    );
    assert.match(out, /was NOT searched/, 'a false negative must not wear a fact`s clothes');
  });

  it('an archive with nothing in it is worded as such, not as a miss', () => {
    const out = renderRecall({ ok: true, hits: [], scanned: 0, reachedBack: null, truncated: false }, ['x']);
    assert.match(out, /nothing archived for this person yet/i);
  });
});

// ---------------------------------------------------------------------------
// 3. The detector and the ranking
// ---------------------------------------------------------------------------

describe('the recall detector is the NARROWEST on this surface', () => {
  it('claims questions about the CONVERSATION', () => {
    for (const q of [
      'did we talk about Sanderson?',
      'have we discussed the Cosmere?',
      'what did I tell you about my reading?',
      'do you remember when I asked about Mistborn?',
      'what did we talk about last week?',
      'remind me what I said about the audiobook player',
      'last time we spoke you mentioned something about ebooks',
      'what did you say about that earlier?',
      'our last conversation had something about Skyward',
    ]) {
      assert.equal(recallIntent(q), true, `missed: ${q}`);
    }
  });

  it('⚠️ and leaves every OTHER lane`s traffic alone', () => {
    for (const q of [
      // shelf — first person about their own record, not about a conversation
      "what haven't I read by Sanderson?",
      'what did I think of Skyward?',
      "what's on my TBR?",
      // books
      'what happens at the end of book 9?',
      'what is the fourth book in the Dungeon Crawler Carl series?',
      // docs / catalogue / suggest / smalltalk
      'how do I promote the audiobook site?',
      'who narrates The Way of Kings?',
      'find me something entertaining',
      'thanks!',
      // ⚠️ the privacy control, which must NEVER be read as a search
      'forget what you know about me',
    ]) {
      assert.equal(recallIntent(q), false, `wrongly claimed: ${q}`);
    }
  });

  it('terms drop the conversational scaffolding and keep the subject', () => {
    assert.deepEqual(recallTerms('did we talk about Sanderson?'), ['sanderson']);
    // ⚠️ No subject at all -> no terms -> the lane refuses to search rather than
    // returning recent turns and calling them matches.
    assert.deepEqual(recallTerms('do you remember me?'), []);
  });

  it('ranking is lexical, drops zero-scores, and prefers the newer of a tie', () => {
    assert.equal(scoreRecall('nothing here', ['mistborn']), 0);
    assert.ok(scoreRecall('Mistborn is great', ['mistborn']) > 0);
    const rows = [
      turn({ text: 'mistborn one', at: 100 }),
      turn({ text: 'mistborn two', at: 200 }),
      turn({ text: 'unrelated', at: 300 }),
    ];
    const ranked = rankRecall(rows, ['mistborn']);
    assert.equal(ranked.length, 2, 'a zero-scoring row is dropped, not returned as a weak match');
    assert.equal(ranked[0]?.at, 200, 'newer wins a tie');
    assert.equal(ranked[0]?.day, new Date(200).toISOString().slice(0, 10));
  });
});

describe('the storage shape', () => {
  it('⚠️ the document id sorts NEWEST FIRST, so no composite index is needed', () => {
    const older = archiveDocId(1_000, 'aaaaaa');
    const newer = archiveDocId(2_000, 'aaaaaa');
    assert.ok(newer < older, 'name-ascending must mean newest-first');
    assert.equal(older.length, newer.length, 'fixed width, or string ordering is not time ordering');
  });

  it('the executor orders by __name__ and NOT by at', () => {
    const src = strip(repoFile('src/memory-exec.ts'));
    const fn = src.slice(src.indexOf('async recall(input)'));
    assert.match(fn.slice(0, 2000), /fieldPath: '__name__'/);
    assert.doesNotMatch(
      fn.slice(0, 2000),
      /orderBy[\s\S]{0,120}fieldPath: 'at'/,
      'ordering by `at` would need an index somebody has to create in a console',
    );
  });

  it('retention is ONE constant and expiresAt derives from it', () => {
    assert.equal(ARCHIVE_RETENTION_DAYS, 90);
    const at = Date.parse('2026-01-01T00:00:00Z');
    assert.equal(expiresAtFor(at) - at, 90 * 24 * 60 * 60 * 1000);
  });

  it('⚠️ expiresAt is written as a TIMESTAMP, or a TTL policy cannot see it', () => {
    const src = strip(repoFile('src/memory-exec.ts'));
    assert.match(src, /expiresAt: \{ timestampValue:/);
  });
});

// ---------------------------------------------------------------------------
// 4. The lane, and the clear verbs
// ---------------------------------------------------------------------------

describe('the lane runs the search BEFORE the model', () => {
  const port = (outcome: unknown) => ({
    write: async () => true,
    forget: async () => ({ ok: true, deleted: 0, more: false }),
    recall: async () => outcome as never,
  });

  it('a subjectless ask is refused without touching the store', async () => {
    let called = false;
    const out = await gatherRecall({
      question: 'do you remember me?',
      person: 'discord:1',
      port: { ...port(null), recall: async () => { called = true; return null as never; } },
    });
    assert.equal(called, false, 'searching for nothing would return recent turns as MATCHES');
    assert.equal(out.say, RECALL_MSG.noSubject);
  });

  it('⚠️ an OUTAGE is never worded as "I have no record of that"', async () => {
    const out = await gatherRecall({
      question: 'did we talk about mistborn?',
      person: 'discord:1',
      port: port({ ok: false, message: RECALL_MSG.unreachable }),
    });
    assert.equal(out.say, RECALL_MSG.unreachable);
    assert.equal(out.grounding, null);
    assert.doesNotMatch(RECALL_MSG.unreachable, /no record/i);
    assert.match(RECALL_MSG.unreachable, /not the same as there being nothing/i);
  });

  it('a hit becomes GROUNDING, so the model composes from lines it can see', async () => {
    const out = await gatherRecall({
      question: 'did we talk about mistborn?',
      person: 'discord:1',
      port: port({
        ok: true,
        hits: rankRecall([turn({ text: 'mistborn is my favourite', at: 1 })], ['mistborn']),
        scanned: 1,
        reachedBack: 1,
        truncated: false,
      }),
    });
    assert.equal(out.say, null);
    assert.match(out.grounding ?? '', /mistborn is my favourite/);
    assert.equal(out.matched, 1);
  });

  it('the lane is WIRED, not merely written, and runs before the model call', () => {
    const flow = strip(repoFile('src/mention-flow.ts'));
    assert.match(flow, /if \(recallIntent\(question\)\)/, 'the pre-router must exist');
    const lane = flow.slice(flow.indexOf('if (recallIntent(question))'));
    const gather = lane.indexOf('await gatherRecall(');
    const model = lane.indexOf('await converseWithTools(');
    assert.ok(gather > 0 && model > 0 && gather < model, 'the search must precede the model');
  });

  it('⚠️ recall is routed AFTER the memory privacy controls', () => {
    const flow = strip(repoFile('src/mention-flow.ts'));
    const control = flow.indexOf('const memoryAsk = memoryCommand(question);');
    const recall = flow.indexOf('if (recallIntent(question))');
    assert.ok(control > 0 && recall > control, 'a deletion request must never be read as a search');
  });
});

describe('⚠️ the clear verbs cover BOTH tiers, distinctly', () => {
  it('the note-only phrasings stay note-only', () => {
    assert.equal(memoryCommand('forget what you know about me'), 'forget');
    assert.equal(memoryCommand('please forget everything you know about me'), 'forget');
  });

  it('history phrasings clear the ARCHIVE', () => {
    for (const q of [
      'forget my history',
      'delete our conversations',
      'wipe our chat history',
      'forget what we talked about',
      'clear my message history',
    ]) {
      assert.equal(memoryCommand(q), 'forget_history', q);
    }
  });

  it('an explicit both-ask clears both', () => {
    assert.equal(
      memoryCommand('delete everything you have on me including our conversations'),
      'forget_all',
    );
    assert.equal(memoryCommand('memory forget all'), 'forget_all');
  });

  it('⚠️ the narrow clear NAMES the wider one, so nobody is left over-confident', () => {
    assert.match(MEMORY_MSG.cleared, /90 days/);
    assert.match(MEMORY_MSG.cleared, /forget my history/);
    // …and the no-archive variant must NOT promise a store that is not running.
    assert.doesNotMatch(MEMORY_MSG.clearedNoArchive, /90 days/);
  });

  it('⚠️ a PARTIAL delete is said, never rounded up to done', () => {
    const partial = MEMORY_MSG.historyPartlyCleared(300);
    assert.match(partial, /300/);
    assert.match(partial, /more than I can remove in one go/i);
    assert.doesNotMatch(partial, /^Done/);
  });

  it('⚠️ a FAILED delete never comes back as a confirmation', () => {
    assert.match(MEMORY_MSG.historyTrouble, /nothing has been removed/i);
    assert.match(MEMORY_MSG.bothPartial, /could NOT delete/);
  });

  it('the profile display DISCLOSES the archive when it is live', () => {
    const p = { ...emptyProfile('discord:1'), notes: ['prefers audio'] };
    assert.match(profileForDisplay(p, true), /90 days/);
    assert.match(profileForDisplay(p, true), /forget my history/);
    // …and says nothing about it when it is not running.
    assert.doesNotMatch(profileForDisplay(p, false), /90 days/);
    // An empty note still discloses — the store exists either way.
    assert.match(profileForDisplay(null, true), /90 days/);
  });
});

describe('the archive write', () => {
  it('is inside the bookkeeping block, AFTER the answer is posted', () => {
    const flow = strip(repoFile('src/mention-flow.ts'));
    const say = flow.indexOf('await say(answer.content, answer.components, answer.overflowNote);');
    const write = flow.indexOf('await archiveTurn(archiveCtx,');
    assert.ok(say > 0 && write > say, 'archiving must never delay or fail a delivered answer');
  });

  it('⚠️ clips to the SAME 600 characters the live window clips to', () => {
    const flow = strip(repoFile('src/mention-flow.ts'));
    const fn = flow.slice(flow.indexOf('async function archiveTurn('));
    assert.equal((fn.match(/ARCHIVE_TURN_CHARS/g) ?? []).length, 2, 'both halves must be clipped');
  });

  it('needs a posture AND a port AND an identity', () => {
    const flow = strip(repoFile('src/mention-flow.ts'));
    const fn = flow.slice(flow.indexOf('function archiveContextFor'));
    assert.match(fn.slice(0, 400), /!cfg\.archiveEnabled \|\| !deps\.archive/);
  });
});

// ---------------------------------------------------------------------------
// ⚠️ EVERY PHRASE SHE ADVERTISES MUST ACTUALLY ROUTE
// ---------------------------------------------------------------------------

/**
 * ⚠️ **THE SAY-THE-WORD LESSON, SELF-INFLICTED (2026-08-18, 14:21).**
 *
 * She told somebody *"you can clear it any time with `/gabi memory forget`"*.
 * They typed it. They got a keyword-soup shelf search and a wall of panel text —
 * because `/gabi` is the original propose-and-deep-link command and has never
 * seen the memory detector, or any lane built since it.
 *
 * Three earlier incidents taught that OFFERING a capability is not ROUTING to
 * it. This is the same defect with her as the author of the offer, so the guard
 * is mechanical: **the phrases she prints in bold are extracted from her own
 * strings and run through the routers.**
 */
describe('⚠️ REGRESSION — she must not advertise a phrase that does not route', () => {
  const memorySrc = readFileSync(
    fileURLToPath(new URL('../src/memory.ts', import.meta.url).href),
    'utf8',
  );

  /** Bolded imperatives inside real string literals — never comments, because a
   *  phrase she cannot say is not a promise she has made. */
  function advertisedPhrases(source: string): string[] {
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const found = new Set<string>();
    for (const m of code.matchAll(/\*\*([^*]{3,60})\*\*/g)) {
      const phrase = (m[1] ?? '').replace(/'\s*\+\s*\n?\s*'/g, '').replace(/\s+/g, ' ').trim();
      if (/forget|remember|history/i.test(phrase)) found.add(phrase);
    }
    return [...found];
  }

  it('every memory phrase she prints in bold is a routable command', () => {
    const phrases = advertisedPhrases(memorySrc);
    assert.ok(phrases.length >= 2, 'expected her to advertise the clear verbs');
    for (const phrase of phrases) {
      assert.notEqual(
        memoryCommand(phrase),
        null,
        `she advertises "${phrase}" and nothing routes it`,
      );
    }
  });

  it('⚠️ and she no longer advertises the /gabi subcommand that never routed', () => {
    // `/gabi <anything>` is answered by `processGabi`, which does a shelf lookup
    // and returns a panel link. It has no memory detector and no lane routing at
    // all, so any subcommand she names there is a promise the command cannot
    // keep.
    assert.doesNotMatch(
      memorySrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''),
      /\/gabi memory/,
      'a /gabi subcommand is advertised again, and /gabi cannot route it',
    );
  });

  it('the phrasings she advertises route on their own, with no context needed', () => {
    // ⚠️ These have to work as a bare DM, a bare mention and a bare reply — a
    // command that needs a preceding turn is not a command somebody can be told
    // to type.
    assert.equal(memoryCommand('forget what you know about me'), 'forget');
    assert.equal(memoryCommand('forget my history'), 'forget_history');
  });
});
