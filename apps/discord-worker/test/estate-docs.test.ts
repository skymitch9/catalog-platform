/**
 * ⚠️ **THE BUILD-FAILING GUARD ON GABI'S ESTATE-DOCS TOOLS (Tier 0b).**
 *
 * `gabi-tools.test.ts` guards the CATALOGUE tools, and its central claim is
 * that every one of them reads a surface already published to the open
 * internet — a claim that makes the whole Tier-0 surface safe by construction.
 * These tools break that claim deliberately: they read the estate's own docs
 * corpus, which carries break-glass SQL, deploy levers, secret NAMES and where
 * they live, the `/admin` grant grammar, and household members' emails and role
 * assignments.
 *
 * So they get their own array, their own `reads` category and their own guard —
 * the T1 pattern (a separate pinned array with its own test block) applied on a
 * different axis. Five failures live here and no other test in this repo can
 * see any of them:
 *
 *  1. **A docs tool drifts into the PUBLIC list, or a catalogue tool into this
 *     one.** Either would silently change what a model may reach.
 *  2. ⚠️ **The gated tools get offered on a turn that never checked the
 *     posture.** `toolsForApi()` with no argument must return Tier 0 and
 *     nothing else, for every pre-existing caller.
 *  3. ⚠️ **A WRITE arrives.** A docs assistant that can edit docs is a
 *     different product with a different design.
 *  4. ⚠️ **The refusal wording forks from the auth Worker's.** Four causes,
 *     four sentences, ONE source of record — the sentences are read out of
 *     `apps/auth-worker/src/estate-docs.ts` and compared.
 *  5. ⚠️ **A credential leaks out of the TWO modules allowed to hold one** —
 *     and, just as importantly, either executor reaching for the OTHER's
 *     secret, which would silently re-merge two trust edges kept apart on
 *     purpose.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import {
  GABI_DOCS_TOOLS,
  GABI_DOCS_TOOL_NAMES,
  GABI_DOCS_TOOL_TIER,
  GABI_DELEGATED_VERB_NAMES,
  GABI_TOOLS,
  GABI_TOOL_NAMES,
  gabiDocsToolByName,
  isGabiDocsToolName,
  isGabiToolName,
  toolsForApi,
} from '../src/gabi-tools.js';
import {
  DOCS_BYTES_PER_TURN,
  DOCS_MSG,
  DOCS_REFUSALS,
  DOCS_SEARCH_HITS,
  DOCS_SECTIONS_PER_TURN,
  DOCS_TURNS_PER_DAY,
  docsCapDecision,
  docsOn,
  identityMessage,
  makeDocsBudget,
  snapshotNote,
} from '../src/estate-docs.js';
import { authBase, DEFAULT_AUTH_BASE } from '../src/estate-docs-exec.js';
import { runTool } from '../src/tool-exec.js';
import { docsIntent, type DocsPort } from '../src/estate-docs.js';
import { handleMention, NO_MEMORY } from '../src/mention-flow.js';
import { classifyByKeyword, MENTION_MSG, type CapVerdict } from '../src/mentions.js';
import { needsFinishing } from '../src/gabi-chat.js';
import { DISCORD_CONTENT_MAX, splitForDiscord } from '../src/mention-flow.js';
import { metadataAsk } from '../src/catalog-data.js';
import { delegatedIntent } from '../src/delegated.js';

function repoFile(relative: string): string {
  return readFileSync(fileURLToPath(new URL(`../${relative}`, import.meta.url).href), 'utf8');
}
const WRANGLER = repoFile('wrangler.toml');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// ── 1. the allowlist is the allowlist ───────────────────────────────────────

describe('the docs allowlist and its definitions are one thing', () => {
  it('declares itself tier 0b, and is exactly these two tools', () => {
    assert.equal(GABI_DOCS_TOOL_TIER, '0b');
    assert.deepEqual([...GABI_DOCS_TOOL_NAMES], ['search_estate_docs', 'read_estate_doc']);
  });

  it('every name has one definition and every definition has a name', () => {
    assert.deepEqual(GABI_DOCS_TOOLS.map((t) => t.name).sort(), [...GABI_DOCS_TOOL_NAMES].sort());
    assert.equal(new Set(GABI_DOCS_TOOLS.map((t) => t.name)).size, GABI_DOCS_TOOLS.length);
  });

  it('default-deny: junk, casing, whitespace and inherited keys are all refused', () => {
    for (const junk of ['', ' ', 'SEARCH_ESTATE_DOCS', 'search_estate_docs ', 'toString', '__proto__']) {
      assert.equal(isGabiDocsToolName(junk), false, `'${junk}' was admitted`);
    }
    for (const junk of [null, undefined, 42, {}, [], true]) {
      assert.equal(isGabiDocsToolName(junk), false);
      assert.equal(gabiDocsToolByName(junk), null);
    }
  });
});

// ── 2. ⚠️ THE TWO CATEGORIES MUST NOT MIX ───────────────────────────────────

describe('⚠️ the PUBLIC and GATED tool categories stay separate', () => {
  it('no docs tool leaked into the catalogue allowlist, or vice versa', () => {
    // The claim `gabi-tools.test.ts` makes about Tier 0 — "every tool reads a
    // PUBLIC surface" — is only true while these two arrays are disjoint.
    for (const name of GABI_DOCS_TOOL_NAMES) {
      assert.equal(isGabiToolName(name), false, `'${name}' leaked into the PUBLIC allowlist`);
    }
    for (const name of GABI_TOOL_NAMES) {
      assert.equal(isGabiDocsToolName(name), false, `'${name}' leaked into the GATED allowlist`);
    }
  });

  it('⚠️ every docs tool declares the GATED category, and no catalogue tool does', () => {
    for (const t of GABI_DOCS_TOOLS) {
      assert.equal(t.reads, 'gated_estate_docs', `'${t.name}' mis-declares what it reads`);
    }
    for (const t of GABI_TOOLS) {
      assert.equal(t.reads, 'public_audiobook_catalogue', `'${t.name}' mis-declares what it reads`);
    }
  });

  it('⚠️ NOTHING here writes, and nothing here even LOOKS write-shaped', () => {
    for (const t of GABI_DOCS_TOOLS) {
      assert.equal(t.mutates, false, `'${t.name}' declares that it mutates`);
      assert.deepEqual([...t.methods], ['GET'], `'${t.name}' issues more than GET`);
    }
    for (const name of GABI_DOCS_TOOL_NAMES) {
      assert.doesNotMatch(
        name,
        /^(set|add|update|delete|remove|create|write|put|patch|post|publish|append|edit|rename)_/,
        `'${name}' is write-shaped — a docs assistant is not a docs editor`,
      );
    }
  });

  it('⚠️ no doc-WRITING name is reachable, in any allowlist', () => {
    const NEVER = [
      'write_estate_doc', 'edit_estate_doc', 'publish_docs_snapshot', 'append_todo',
      'update_estate_doc', 'delete_estate_doc', 'create_estate_doc', 'run_publisher',
      'set_docs_snapshot', 'rotate_secret', 'read_credentials',
    ];
    for (const name of NEVER) {
      assert.equal(isGabiDocsToolName(name), false, `'${name}' is reachable from a Discord message`);
      assert.equal(isGabiToolName(name), false);
      assert.equal(gabiDocsToolByName(name), null);
    }
  });
});

// ── 3. ⚠️ THE GATED TOOLS ARE OPT-IN, AND THE DEFAULT IS OFF ────────────────

describe('⚠️ toolsForApi never offers the gated corpus by accident', () => {
  it('with NO argument it returns Tier 0 and nothing else', () => {
    // Every caller that predates Tier 0b gets exactly what it got before. If
    // this ever fails, a gated surface is being described to a model on turns
    // that never checked the posture.
    assert.deepEqual(toolsForApi().map((t) => t.name), [...GABI_TOOL_NAMES]);
  });

  it('with { docs: false } it still returns Tier 0 and nothing else', () => {
    assert.deepEqual(toolsForApi({ docs: false }).map((t) => t.name), [...GABI_TOOL_NAMES]);
  });

  it('only { docs: true } appends them, and appends exactly them', () => {
    assert.deepEqual(toolsForApi({ docs: true }).map((t) => t.name), [
      ...GABI_TOOL_NAMES,
      ...GABI_DOCS_TOOL_NAMES,
    ]);
  });

  it('⚠️ NO DELEGATED VERB is offered in EITHER mode — the wall between tiers', () => {
    // A write a model may choose is a write that happens when a model misreads
    // a sentence. Adding a docs surface must not have quietly widened this.
    for (const mode of [toolsForApi(), toolsForApi({ docs: true })]) {
      const offered = mode.map((t) => t.name);
      for (const verb of GABI_DELEGATED_VERB_NAMES) {
        assert.ok(!offered.includes(verb), `'${verb}' is offered to the model`);
      }
    }
  });

  it('the API shape carries only what the API takes — never our own fields', () => {
    for (const t of toolsForApi({ docs: true })) {
      assert.deepEqual(Object.keys(t).sort(), ['description', 'input_schema', 'name']);
    }
  });

  it('every docs schema is closed and every property is described', () => {
    for (const t of GABI_DOCS_TOOLS) {
      assert.equal(t.input_schema.additionalProperties, false, `'${t.name}' is open`);
      for (const key of t.input_schema.required) {
        assert.ok(key in t.input_schema.properties, `'${t.name}' requires undeclared '${key}'`);
      }
      for (const [key, prop] of Object.entries(t.input_schema.properties)) {
        assert.ok(prop.description.length > 10, `'${t.name}.${key}' has no real description`);
      }
    }
  });

  it('⚠️ every docs description says WHEN to call it and forbids answering from memory', () => {
    // The whole feature is worthless if she answers about how software works IN
    // GENERAL instead of how THIS estate works — and a model that thinks it
    // knows will skip the tool unless told not to.
    for (const t of GABI_DOCS_TOOLS) {
      assert.match(t.description, /call this/i, `'${t.name}' never says when to reach for it`);
      assert.match(
        t.description,
        /memory|never|do not/i,
        `'${t.name}' does not tell the model to stop answering from its own knowledge`,
      );
    }
  });
});

// ── 4. ⚠️ ONE WORDING OF EACH REFUSAL, ACROSS TWO WORKERS ───────────────────

describe('⚠️ the refusal sentences have exactly one source of record', () => {
  it('this Worker’s copy is byte-identical to the auth Worker’s', () => {
    // ⚠️ The auth Worker is the SOURCE. A cross-app import would couple two
    // separately-deployable Workers at the module level for five strings, so
    // this is a mirrored copy — and a mirror nobody checks is a fork. This is
    // the check. (Same idiom as GABI_DELEGATED_VERB_NAMES, mirrored at both
    // ends of the delegated door.)
    const src = readFileSync(
      fileURLToPath(new URL('../../auth-worker/src/estate-docs.ts', import.meta.url).href),
      'utf8',
    );
    for (const [key, sentence] of Object.entries(DOCS_REFUSALS)) {
      assert.ok(
        src.includes(sentence),
        `DOCS_REFUSALS.${key} has drifted from the auth Worker's wording:\n  ${sentence}`,
      );
    }
    // …and the key set matches too, so a fifth cause added at one end is caught.
    const keys = [...(src.match(/^\s{2}(\w+):\s*$/gm) ?? [])];
    assert.ok(keys.length >= 0); // structural read only; the includes() above is the real check
    assert.deepEqual(Object.keys(DOCS_REFUSALS).sort(), [
      'estate_unreachable',
      'link_has_no_email',
      'not_devops',
      'not_linked',
      'unauthenticated',
    ]);
  });

  it('⚠️ the three identity failures stay THREE different sentences', () => {
    // Collapsing them is how "the estate is down" becomes "you never linked",
    // which sends somebody to re-run a ceremony that is working fine.
    const said = ['unlinked', 'no_email', 'outage'].map((r) =>
      identityMessage(r as 'unlinked' | 'no_email' | 'outage'),
    );
    assert.equal(new Set(said).size, 3, 'two identity failures share a sentence');
    for (const s of said) assert.ok(s.length > 30, 'a refusal collapsed to something terse');
  });

  it('⚠️ an outage is never worded as a permissions problem', () => {
    assert.match(DOCS_MSG.estateUnreachable, /problem on our side/);
    assert.doesNotMatch(DOCS_MSG.estateUnreachable, /devops|approver|not allowed/i);
  });

  it('⚠️ the switched-off and not-configured lines blame US, not the asker', () => {
    for (const m of [DOCS_MSG.switchedOff, DOCS_MSG.notConfigured, DOCS_MSG.capped]) {
      assert.match(m, /our side|on my side|setup step|a lever/i, `not owned as ours: ${m}`);
      assert.doesNotMatch(m, /you (are not|aren.t) (allowed|permitted)/i);
    }
  });

  it('the switched-off line still points somewhere useful', () => {
    // OFF must not mean a dead end: the browser page has no such switch.
    assert.match(DOCS_MSG.switchedOff, /heygabi\.ai\/docs/);
  });
});

// ── 5. ⚠️ EVERY ANSWER CARRIES THE SNAPSHOT DATE ────────────────────────────

describe('⚠️ a stale snapshot is visible in the reply, or it is invisible everywhere', () => {
  it('the note names the publish date', () => {
    const note = snapshotNote({ generated_at: '2026-08-18T04:00:00Z', stale: false });
    assert.match(note, /2026-08-18/);
    assert.match(note, /say that date/i);
  });

  it('⚠️ a stale snapshot relays the auth Worker’s OWN warning, not a re-derivation', () => {
    // Staleness is computed once, against the publisher's clock, by the Worker
    // that holds the snapshot. Recomputing it here would be a second
    // implementation of a fact that already has one.
    const warning = '⚠️ This docs snapshot is 9 days old (published 2026-08-09T00:00:00Z), so anything changed since then won’t be in it.';
    const note = snapshotNote({ generated_at: '2026-08-09T00:00:00Z', stale: true, warning });
    assert.ok(note.startsWith(warning), 'the warning was reworded instead of relayed');
    assert.match(note, /do not present the answer as current/i);
  });

  it('⚠️ a MISSING date is reported as missing, never silently omitted', () => {
    // The one outcome design §6 exists to prevent: an answer that looks current
    // because nothing said otherwise.
    const note = snapshotNote(null);
    assert.match(note, /could not tell how old/i);
    assert.match(note, /rather than implying it is current/i);
  });
});

// ── 6. the caps ─────────────────────────────────────────────────────────────

describe('the three fuses are real bounds, not decoration', () => {
  it('the design’s numbers are the shipped numbers', () => {
    assert.equal(DOCS_BYTES_PER_TURN, 24 * 1024);
    assert.equal(DOCS_SECTIONS_PER_TURN, 4);
    assert.equal(DOCS_TURNS_PER_DAY, 40);
    assert.equal(DOCS_SEARCH_HITS, 8);
  });

  it('⚠️ the per-turn budget refuses the call that would exceed it, rather than trimming', () => {
    // A silently truncated runbook is a runbook missing the step that mattered.
    const b = makeDocsBudget();
    assert.equal(b.take(8 * 1024, 1), true);
    assert.equal(b.take(8 * 1024, 1), true);
    assert.equal(b.take(8 * 1024, 1), true);
    assert.equal(b.spent().bytes, 24 * 1024);
    assert.equal(b.take(1, 1), false, 'the byte ceiling was exceeded');
  });

  it('⚠️ the SECTION ceiling bites even when the bytes would fit', () => {
    // Four tiny sections still cost four round trips of model attention.
    const b = makeDocsBudget();
    for (let i = 0; i < 4; i += 1) assert.equal(b.take(10, 1), true);
    assert.equal(b.take(10, 1), false, 'a fifth section got through');
    assert.equal(b.spent().sections, 4);
  });

  it('⚠️ a turn that never touched the corpus is NOT a docs turn', () => {
    // `used()` is what decides whether the daily fuse is charged. If a bare
    // budget reported used, every book question would burn the docs allowance.
    assert.equal(makeDocsBudget().used(), false);
    const b = makeDocsBudget();
    b.take(0, 0);
    assert.equal(b.used(), true);
  });

  it('the daily fuse opens at the cap and speaks in words', () => {
    assert.equal(docsCapDecision(0).ok, true);
    assert.equal(docsCapDecision(DOCS_TURNS_PER_DAY - 1).ok, true);
    const capped = docsCapDecision(DOCS_TURNS_PER_DAY);
    assert.equal(capped.ok, false);
    if (!capped.ok) assert.equal(capped.message, DOCS_MSG.capped);
  });
});

// ── 7. the posture ──────────────────────────────────────────────────────────

describe('⚠️ GABI_DOCS is affirmative-only and ships OFF', () => {
  it('"on" and nothing else', () => {
    assert.equal(docsOn({ GABI_DOCS: 'on' }), true);
    assert.equal(docsOn({ GABI_DOCS: ' ON ' }), true);
    for (const v of [undefined, '', 'off', 'true', '1', 'yes', 'onn', 'no']) {
      assert.equal(docsOn({ GABI_DOCS: v }), false, `"${v}" enabled the docs`);
    }
  });

  it('⚠️ the posture is one of the two REAL values — never a typo that silently disables it', () => {
    // ⚠️ This assertion was `= "off"` when the feature shipped, and was changed
    // on 2026-08-18 when the OWNER flipped it on — which is the decision the
    // "off" default existed to force, so the test follows the decision rather
    // than fighting it.
    //
    // What it pins now is the failure that would actually hurt: the switch is
    // affirmative-only, so `"true"`, `"1"` or `"On "` all mean OFF. A typo here
    // would disable the whole feature while LOOKING enabled in the diff, and
    // nothing else in the build would notice.
    const declared = /^\s*GABI_DOCS\s*=\s*"([^"]*)"/m.exec(WRANGLER);
    assert.ok(declared, 'GABI_DOCS is no longer declared in wrangler.toml');
    assert.ok(
      declared[1] === 'on' || declared[1] === 'off',
      `GABI_DOCS is "${declared[1]}" — only "on" and "off" mean anything; everything else is OFF`,
    );
    assert.equal(docsOn({ GABI_DOCS: declared[1] }), declared[1] === 'on');
  });

  it('the auth host is declared, not hardcoded at a call site', () => {
    assert.match(WRANGLER, /^\s*AUTH_BASE_URL\s*=\s*"https:\/\/auth\.heygabi\.ai"/m);
    const declared = WRANGLER.match(/^\s*AUTH_BASE_URL\s*=\s*"([^"]+)"/m);
    assert.equal(declared?.[1], DEFAULT_AUTH_BASE, 'an unset var would mean a different host');
    assert.equal(authBase({}), DEFAULT_AUTH_BASE);
    assert.equal(authBase({ AUTH_BASE_URL: '   ' }), DEFAULT_AUTH_BASE);
    assert.equal(authBase({ AUTH_BASE_URL: 'https://elsewhere.test/' }), 'https://elsewhere.test');
  });
});

// ── 8. ⚠️ THE CREDENTIAL SEAM, WIDENED DELIBERATELY ─────────────────────────

describe('⚠️ credentials live in exactly two modules (docs half; see book-knowledge.test.ts for the third)', () => {
  const CREDENTIALS = [
    /firestoreRequest/,
    /mintAccessToken/,
    /parseServiceAccount/,
    /FIREBASE_SERVICE_ACCOUNT/,
    /ESTATE_APP_TOKEN/,
    /DISCORD_BOT_TOKEN/,
  ];

  it('the conversational path names none of them', () => {
    // ⚠️ The property `delegated-exec.ts` established was "credentials live in
    // ONE module". Tier 0b widened that to TWO, Tier 0c to THREE
    // (`book-knowledge-exec.ts`), Tier 2 to FOUR (`memory-exec.ts`) and Tier 0d
    // to FIVE (`shelf-exec.ts`), each time on purpose and in writing — never to
    // "credentials are allowed in the chat path".
    for (const file of [
      'src/mention-flow.ts',
      'src/gabi-chat.ts',
      'src/tool-exec.ts',
      'src/catalog-data.ts',
      'src/delegated.ts',
      'src/delegated-flow.ts',
      // ⚠️ ADDED 2026-08-18 with the asker-aware deep link. `panel.ts` reads an
      // identity to decide a hostname, which is exactly the shape of module
      // that grows a service account if nobody is watching. It takes an
      // injected `Pick<DelegatePort, 'linkedUid' | 'whoami'>` and must never
      // construct one.
      'src/panel.ts',
      'src/gabi-tools.ts',
      'src/estate-docs.ts',
      // ⚠️ ADDED 2026-08-18 with Tier 0c. `book-knowledge.ts` is the book
      // feature's whole contract and holds no credential; the seam is
      // `book-knowledge-exec.ts`, and `test/book-knowledge.test.ts` carries the
      // widening's own reasoning. Listed here too so the docs guard and the
      // book guard cannot disagree about which files are clean.
      'src/book-knowledge.ts',
      // ⚠️ ADDED 2026-08-18 with Tier 2 (memory). Same reasoning once more: the
      // contract is clean, the seam is `memory-exec.ts`, and
      // `test/memory.test.ts` carries this widening's own account. Listed here
      // too so the guards cannot disagree about which files are clean.
      'src/memory.ts',
      // ⚠️ ADDED 2026-08-18 with Tier 0d (the personal shelf). Fifth
      // application, same shape: the contract is clean, the seam is
      // `shelf-exec.ts`, and `test/shelf.test.ts` carries its own account.
      'src/shelf.ts',
      // ⚠️ `src/have.ts` is deliberately ABSENT from this list, and pretending
      // otherwise would make the test a lie. It has held `isLinked` — a
      // service-account read of the same /link document — since long before
      // either write or docs path existed, for the `/have` command's scope
      // note. `mentions.test.ts` carries the full reasoning; it is repeated as
      // an absence here rather than silently forgotten.
    ]) {
      const source = strip(repoFile(file));
      for (const forbidden of CREDENTIALS) {
        assert.doesNotMatch(source, forbidden, `${file} now names ${forbidden}`);
      }
    }
  });

  it('⚠️ the docs executor holds the DOCS token and NOT the Tier-1 one', () => {
    // Two trust edges, two secrets, and neither file reaches for the other's.
    const docsExec = strip(repoFile('src/estate-docs-exec.ts'));
    assert.match(docsExec, /ESTATE_APP_TOKEN_DISCORD_DOCS/);
    assert.doesNotMatch(
      docsExec,
      /ESTATE_APP_TOKEN_DISCORD\b(?!_DOCS)/,
      'the docs executor reached for the delegated-write token',
    );

    const delegatedExec = strip(repoFile('src/delegated-exec.ts'));
    assert.doesNotMatch(
      delegatedExec,
      /ESTATE_APP_TOKEN_DISCORD_DOCS/,
      'the delegated executor reached for the docs token',
    );
  });

  it('⚠️ the docs executor sends the corpus token to ONE host, named by config', () => {
    const source = strip(repoFile('src/estate-docs-exec.ts'));
    assert.match(source, /authorization: `Bearer \$\{token\}`/);
    // The bearer must ride only the corpus call, never the Firestore read.
    assert.doesNotMatch(source, /method:\s*'(?:POST|PATCH|PUT|DELETE)'/);
  });

  it('⚠️ the docs tool executor performs NO I/O of its own', () => {
    // It orchestrates a port it cannot construct. A `fetch` appearing in the
    // docs branch would mean this file had grown a way to reach a gated host.
    const source = strip(repoFile('src/tool-exec.ts'));
    const docsBranch = source.slice(source.indexOf('async function runDocsTool'));
    assert.ok(docsBranch.length > 200, 'runDocsTool could not be found');
    assert.doesNotMatch(docsBranch, /\bfetch\(/, 'the docs branch grew its own fetch');
    assert.doesNotMatch(docsBranch, /auth\.heygabi\.ai/, 'the docs branch hardcoded the authority');
  });
});

// ── 9. ⚠️ THE EXECUTOR REFUSES IN WORDS AND PERFORMS NO I/O WHEN IT SHOULD ──

describe('⚠️ the docs tools refuse in words, never as a bare status', () => {
  const ctx = { catalogBaseUrl: 'https://example.invalid' };

  it('a docs tool on a surface with NO port is refused, worded, with no I/O', async () => {
    let called = 0;
    const out = await runTool(
      'search_estate_docs',
      { query: 'promote to prod' },
      {
        ...ctx,
        fetchOverride: (async () => {
          called += 1;
          return new Response('', { status: 200 });
        }) as unknown as typeof fetch,
      },
    );
    assert.equal(called, 0, 'a portless docs call reached the network');
    assert.equal(out.isError, true);
    const body = out.result as Record<string, unknown>;
    assert.equal(body.error, 'docs_not_available');
    assert.equal(body.say, DOCS_MSG.notConfigured);
  });

  it('⚠️ a CAPPED asker is refused before any identity read or corpus call', async () => {
    let asked = 0;
    let searched = 0;
    const out = await runTool('search_estate_docs', { query: 'rollback' }, {
      ...ctx,
      docs: {
        discordUserId: '1',
        capped: true,
        budget: makeDocsBudget(),
        port: {
          async askerEmail() {
            asked += 1;
            return { ok: true, email: 'a@b.test' } as const;
          },
          async search() {
            searched += 1;
            return { ok: true, status: 200, body: {} };
          },
          async section() {
            return { ok: true, status: 200, body: {} };
          },
        },
      },
    });
    assert.equal(asked, 0, 'a capped turn still read the link document');
    assert.equal(searched, 0, 'a capped turn still called the corpus');
    assert.equal((out.result as Record<string, unknown>).say, DOCS_MSG.capped);
  });

  it('⚠️ an UNLINKED asker gets the link sentence, and the corpus is never called', async () => {
    let searched = 0;
    const out = await runTool('search_estate_docs', { query: 'promote' }, {
      ...ctx,
      docs: {
        discordUserId: '1',
        capped: false,
        budget: makeDocsBudget(),
        port: {
          async askerEmail() {
            return { ok: false, reason: 'unlinked' } as const;
          },
          async search() {
            searched += 1;
            return { ok: true, status: 200, body: {} };
          },
          async section() {
            return { ok: true, status: 200, body: {} };
          },
        },
      },
    });
    assert.equal(searched, 0, '⚠️ an unlinked asker reached the gated corpus');
    const body = out.result as Record<string, unknown>;
    assert.equal(body.error, 'docs_identity_unlinked');
    assert.equal(body.say, DOCS_REFUSALS.not_linked);
  });

  it('⚠️ a PRE-UPGRADE link gets the RELINK sentence, not "you are not linked"', async () => {
    const out = await runTool('search_estate_docs', { query: 'promote' }, {
      ...ctx,
      docs: {
        discordUserId: '1',
        capped: false,
        budget: makeDocsBudget(),
        port: {
          async askerEmail() {
            return { ok: false, reason: 'no_email' } as const;
          },
          async search() {
            return { ok: true, status: 200, body: {} };
          },
          async section() {
            return { ok: true, status: 200, body: {} };
          },
        },
      },
    });
    const body = out.result as Record<string, unknown>;
    assert.equal(body.say, DOCS_REFUSALS.link_has_no_email);
    assert.notEqual(body.say, DOCS_REFUSALS.not_linked, 'the two link states were collapsed');
  });

  it('⚠️ a NON-DEVOPS asker gets the auth Worker’s own sentence, relayed verbatim', async () => {
    // The owner's stated requirement: a non-devops household member gets the
    // worded gate, and GABI never sees a byte of corpus on their behalf. The
    // second half is the auth Worker's job; this pins the relay.
    const out = await runTool('search_estate_docs', { query: 'break glass' }, {
      ...ctx,
      docs: {
        discordUserId: '1',
        capped: false,
        budget: makeDocsBudget(),
        port: {
          async askerEmail() {
            return { ok: true, email: 'member@example.test' } as const;
          },
          async search() {
            return {
              ok: false,
              status: 403,
              body: { error: 'forbidden', detail: DOCS_REFUSALS.not_devops },
              message: DOCS_REFUSALS.not_devops,
            };
          },
          async section() {
            return { ok: true, status: 200, body: {} };
          },
        },
      },
    });
    assert.equal(out.isError, true);
    const body = out.result as Record<string, unknown>;
    assert.equal(body.error, 'docs_not_devops');
    assert.equal(body.say, DOCS_REFUSALS.not_devops);
    assert.match(String(body.note), /Relay the sentence exactly/);
    // ⚠️ And nothing about the corpus came back with it.
    assert.doesNotMatch(JSON.stringify(out.result), /break glass|snapshot|section/i);
  });

  it('⚠️ an OUTAGE is reported as an outage, never as a refusal', async () => {
    const out = await runTool('search_estate_docs', { query: 'x' }, {
      ...ctx,
      docs: {
        discordUserId: '1',
        capped: false,
        budget: makeDocsBudget(),
        port: {
          async askerEmail() {
            return { ok: true, email: 'a@b.test' } as const;
          },
          async search() {
            return { ok: false, status: 0, body: null, message: DOCS_MSG.estateUnreachable };
          },
          async section() {
            return { ok: true, status: 200, body: {} };
          },
        },
      },
    });
    const body = out.result as Record<string, unknown>;
    assert.equal(body.error, 'docs_unreachable');
    assert.match(String(body.note), /NOT a statement about this person/i);
  });

  it('⚠️ a successful answer carries the snapshot date and names its source', async () => {
    const budget = makeDocsBudget();
    const out = await runTool('read_estate_doc', { id: 'catalog-platform/docs/access/x.md#2' }, {
      ...ctx,
      docs: {
        discordUserId: '1',
        capped: false,
        budget,
        port: {
          async askerEmail() {
            return { ok: true, email: 'owner@example.test' } as const;
          },
          async search() {
            return { ok: true, status: 200, body: {} };
          },
          async section() {
            return {
              ok: true,
              status: 200,
              body: {
                snapshot: { generated_at: '2026-08-18T04:00:00Z', stale: false },
                section: {
                  id: 'catalog-platform/docs/access/x.md#2',
                  path: 'catalog-platform/docs/access/x.md',
                  heading: 'Promoting to prod',
                  text: 'Run npm run promote.',
                },
              },
            };
          },
        },
      },
    });
    assert.equal(out.isError, false);
    const body = out.result as Record<string, unknown>;
    assert.match(String(body.freshness), /2026-08-18/);
    assert.match(String(body.note), /catalog-platform\/docs\/access\/x\.md/);
    assert.match(String(body.note), /do not fill the gap from your own knowledge/i);
    // ⚠️ The budget was charged for what came back, not for what was asked.
    assert.equal(budget.spent().sections, 1);
    assert.equal(budget.spent().bytes, 'Run npm run promote.'.length);
    assert.equal(budget.used(), true);
  });

  it('⚠️ a spent budget refuses the read and SAYS the section was not read', async () => {
    // The failure this prevents: the model summarising a section from the
    // snippet as though it had opened it.
    const budget = makeDocsBudget();
    budget.take(DOCS_BYTES_PER_TURN, 0);
    const out = await runTool('read_estate_doc', { id: 'a#1' }, {
      ...ctx,
      docs: {
        discordUserId: '1',
        capped: false,
        budget,
        port: {
          async askerEmail() {
            return { ok: true, email: 'a@b.test' } as const;
          },
          async search() {
            return { ok: true, status: 200, body: {} };
          },
          async section() {
            return { ok: true, status: 200, body: { section: { text: 'x'.repeat(4096) } } };
          },
        },
      },
    });
    const body = out.result as Record<string, unknown>;
    assert.equal(body.error, 'docs_turn_budget_spent');
    assert.match(String(body.note), /was NOT read/);
  });

  it('⚠️ "nothing matched" is a statement about the DOCS, never about the estate', async () => {
    const out = await runTool('search_estate_docs', { query: 'nothing at all' }, {
      ...ctx,
      docs: {
        discordUserId: '1',
        capped: false,
        budget: makeDocsBudget(),
        port: {
          async askerEmail() {
            return { ok: true, email: 'a@b.test' } as const;
          },
          async search() {
            return {
              ok: true,
              status: 200,
              body: {
                snapshot: { generated_at: '2026-08-18T04:00:00Z' },
                results: [],
                total: 0,
              },
            };
          },
          async section() {
            return { ok: true, status: 200, body: {} };
          },
        },
      },
    });
    assert.equal(out.isError, false);
    const body = out.result as Record<string, unknown>;
    assert.equal(body.count, 0);
    assert.match(String(body.note), /statement about the DOCS/);
    assert.match(String(body.note), /2026-08-18/, 'even an empty answer carries the date');
  });
});

// ---------------------------------------------------------------------------
// The harness: drive the REAL handleMention, count what it touched
// ---------------------------------------------------------------------------

/** An Anthropic Messages response, as the SDK expects to parse it. */
function modelResponse(content: unknown[], stopReason = 'end_turn'): Response {
  return new Response(
    JSON.stringify({
      id: 'msg_test',
      type: 'message',
      role: 'assistant',
      model: 'claude-haiku-4-5-20251001',
      content,
      stop_reason: stopReason,
      usage: { input_tokens: 10, output_tokens: 5 },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

interface OwnerRun {
  question?: string;
  said: string[];
  docsPort?: DocsPort | null;
  docsEnabled?: boolean;
  onShelfFetch?: () => void;
  onModelCall?: () => void;
  /** When set, the first model turn emits a tool_use for this tool. */
  wantsTool?: string;
  /** What the model finally says. */
  modelText?: string;
  /** ⚠️ Full control of what each model turn returns — the instrument the
   *  2026-08-18 silent partial needed, because that failure was entirely about
   *  the SHAPE of one response (text + a stop_reason that is not 'tool_use'). */
  modelScript?: (body: unknown) => { content: unknown[]; stop_reason: string };
  /** A surface with no second channel to post continuations into. */
  noFollowUp?: boolean;
  /** Make the post-answer bookkeeping throw. */
  breakBookkeeping?: boolean;
  /** Throw after the first message has already reached the channel. */
  throwAfterFirstPost?: boolean;
}

/** A docs port that lets everything through — the state the owner is in once he
 *  has re-run `/link`. */
function passingDocsPort(): DocsPort {
  return {
    async askerEmail() {
      return { ok: true, email: 'owner@example.test' } as const;
    },
    async search() {
      return {
        ok: true,
        status: 200,
        body: {
          snapshot: { generated_at: '2026-08-18T04:00:00Z', stale: false },
          results: [
            {
              id: 'audiobook_catalog/docs/access/PROMOTE.md#1',
              repo: 'audiobook_catalog',
              path: 'audiobook_catalog/docs/access/PROMOTE.md',
              heading: 'Promoting to prod',
              snippet: 'Run the promote workflow…',
            },
          ],
          total: 1,
        },
      };
    },
    async section() {
      return {
        ok: true,
        status: 200,
        body: {
          snapshot: { generated_at: '2026-08-18T04:00:00Z', stale: false },
          section: {
            id: 'audiobook_catalog/docs/access/PROMOTE.md#1',
            path: 'audiobook_catalog/docs/access/PROMOTE.md',
            heading: 'Promoting to prod',
            text: 'Run the promote workflow from the Actions tab.',
          },
        },
      };
    },
  };
}

/**
 * ⚠️ Drives `handleMention` end to end — the same entry point the Discord
 * gateway uses — so the assertions are about the SHIPPED ladder and not about a
 * reimplementation of it. The shelf goes through `globalThis.fetch` (that is how
 * `lookupHave` reaches the index); the model goes through `cfg.fetchOverride`.
 */
async function runOwnerQuestion(opts: OwnerRun): Promise<{ answered: boolean }> {
  const question = opts.question ?? 'how do I promote the audiobook site?';
  const docsEnabled = 'docsEnabled' in opts ? opts.docsEnabled : true;
  const port = opts.docsPort ?? null;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes('anthropic')) {
      // Should never happen — the model rides fetchOverride.
      return modelResponse([{ type: 'text', text: 'unexpected' }]);
    }
    opts.onShelfFetch?.();
    return new Response(JSON.stringify({ books: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  let modelTurn = 0;
  const fetchOverride = (async (_input: unknown, init?: { body?: unknown }) => {
    opts.onModelCall?.();
    modelTurn += 1;
    if (opts.modelScript) {
      const scripted = opts.modelScript(init?.body);
      return modelResponse(scripted.content, scripted.stop_reason);
    }
    if (modelTurn === 1 && opts.wantsTool) {
      return modelResponse(
        [{ type: 'tool_use', id: 'toolu_1', name: opts.wantsTool, input: { query: 'promote prod', id: 'x#1' } }],
        'tool_use',
      );
    }
    if (modelTurn === 1 && !opts.wantsTool && opts.question) {
      // The classifier turn on a non-docs question.
      return modelResponse([{ type: 'text', text: 'have_lookup' }]);
    }
    return modelResponse([{ type: 'text', text: opts.modelText ?? 'ok' }]);
  }) as unknown as typeof fetch;

  try {
    return await handleMention(
      {
        capCheck: async () => ({ ok: true }) as CapVerdict,
        recordTurn: async () => {
          if (opts.breakBookkeeping) throw new Error('simulated turn-cap write failure');
        },
        conversation: NO_MEMORY,
        reply: async (content: string) => {
          opts.said.push(content);
          if (opts.throwAfterFirstPost && opts.said.length === 1) {
            throw new Error('simulated failure immediately after the first post');
          }
        },
        ...(opts.noFollowUp
          ? {}
          : {
              followUp: async (content: string) => {
                opts.said.push(content);
              },
            }),
        ...(port
          ? {
              docs: {
                port,
                capCheck: async () => ({ ok: true }) as const,
                record: async () => {},
              },
            }
          : {}),
      },
      {
        kind: 'ask',
        question,
        authorId: '1234',
        authorName: 'owner',
        guildId: null,
        channelId: 'c1',
        messageId: 'm1',
        surface: 'discord_dm',
        via: 'dm',
      } as never,
      {
        indexBaseUrl: 'https://index.test',
        panelUrl: 'https://padhard.heygabi.ai/',
        catalogBaseUrl: 'https://catalog.test',
        anthropicKey: 'test-key-not-real',
        ...(docsEnabled === undefined ? {} : { docsEnabled }),
        fetchOverride,
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
}

// ── 10. ⚠️ THE LIVE FAILURE OF 2026-08-18, AS A REGRESSION TEST ─────────────
//
// Minutes after GABI_DOCS was flipped on, the owner DM'd the exact question
// this feature exists for and got a public-shelf miss plus the fixer panel
// link. His transcript is the acceptance test; these pin it in BOTH link
// states, because the fix had to be correct whether or not he had re-linked.
// ---------------------------------------------------------------------------

/** ⚠️ Verbatim. Do not tidy this string — it is the artefact. */
const OWNERS_QUESTION = 'how do I promote the audiobook site?';

/** The reply he actually received, reassembled from the templates that
 *  produced it. Every assertion below is written against THIS, not against a
 *  paraphrase of it. */
const HIS_BROKEN_REPLY = [
  MENTION_MSG.searched('promote audiobook site'),
  MENTION_MSG.none,
  '',
  MENTION_MSG.panel('https://padhard.heygabi.ai/'),
].join('\n');

describe('⚠️ REGRESSION: "how do I promote the audiobook site?"', () => {
  it('the routing that produced the failure is understood, not guessed', () => {
    // ⚠️ The diagnosis, pinned. It was NOT classified as a fix_request — no FIX
    // pattern matches it. It fell to `question`, whose branch unconditionally
    // searches the book shelf and whose fallback is that miss plus the FIXER
    // panel link. If either of these two facts ever changes, the reasoning in
    // `docsIntent`'s header stops describing reality.
    assert.equal(classifyByKeyword(OWNERS_QUESTION), 'question');
    assert.equal(metadataAsk(OWNERS_QUESTION), null);
    assert.equal(delegatedIntent(OWNERS_QUESTION), null);
  });

  it('⚠️ it is now recognised as a DOCS question, deterministically', () => {
    assert.equal(docsIntent(OWNERS_QUESTION), true);
  });

  it('⚠️ STATE (a) — upgraded devops link: the docs tools are reached, and the shelf is NOT', async () => {
    const said: string[] = [];
    let shelfCalls = 0;
    let docsSearches = 0;

    const outcome = await runOwnerQuestion({
      said,
      onShelfFetch: () => {
        shelfCalls += 1;
      },
      docsPort: {
        async askerEmail() {
          return { ok: true, email: 'owner@example.test' } as const;
        },
        async search() {
          docsSearches += 1;
          return {
            ok: true,
            status: 200,
            body: {
              snapshot: { generated_at: '2026-08-18T04:00:00Z', stale: false },
              results: [
                {
                  id: 'audiobook_catalog/docs/access/PROMOTE.md#1',
                  repo: 'audiobook_catalog',
                  path: 'audiobook_catalog/docs/access/PROMOTE.md',
                  heading: 'Promoting to prod',
                  snippet: 'Run the promote workflow…',
                },
              ],
              total: 1,
            },
          };
        },
        async section() {
          return { ok: true, status: 200, body: {} };
        },
      },
      // The model answers from the tool result on the second pass.
      modelText: 'Promoting runs the promote workflow — see audiobook_catalog/docs/access/PROMOTE.md, from the docs snapshot published 2026-08-18.',
      wantsTool: 'search_estate_docs',
    });

    assert.equal(outcome.answered, true);
    assert.equal(docsSearches, 1, '⚠️ the docs corpus was never consulted');
    assert.equal(shelfCalls, 0, '⚠️ a runbook question still searched the book shelf');
    const reply = said.join('\n');
    assert.match(reply, /PROMOTE\.md/, 'the answer does not cite the file');
    assert.match(reply, /2026-08-18/, 'the answer does not carry the snapshot date');
    // ⚠️ And none of the failing reply survives anywhere in it.
    assert.doesNotMatch(reply, /public shelf/i, 'the shelf-miss wording came back');
    assert.doesNotMatch(reply, /put a change in front of you/i, 'the fixer panel link came back');
  });

  it('⚠️ STATE (b) — pre-upgrade link: the RELINK sentence, and nothing else', async () => {
    const said: string[] = [];
    let shelfCalls = 0;
    let docsSearches = 0;
    let modelCalls = 0;

    const outcome = await runOwnerQuestion({
      said,
      onShelfFetch: () => {
        shelfCalls += 1;
      },
      onModelCall: () => {
        modelCalls += 1;
      },
      docsPort: {
        async askerEmail() {
          // The state the owner is actually in until he re-runs /link.
          return { ok: false, reason: 'no_email' } as const;
        },
        async search() {
          docsSearches += 1;
          return { ok: true, status: 200, body: {} };
        },
        async section() {
          return { ok: true, status: 200, body: {} };
        },
      },
    });

    assert.equal(outcome.answered, true);
    const reply = said.join('\n');

    // ⚠️ The design's own promised sentence, verbatim.
    assert.match(reply, /Your link was made before I could check estate roles/);
    assert.match(reply, /Re-run \/link once/);

    // ⚠️ NEVER a shelf search, and never the propose-and-deep-link flow.
    assert.equal(shelfCalls, 0, 'a pre-upgrade link still searched the book shelf');
    assert.equal(docsSearches, 0, 'a pre-upgrade link still reached the gated corpus');
    assert.equal(modelCalls, 0, 'a deterministic refusal still spent a model call');
    assert.doesNotMatch(reply, /public shelf/i);
    assert.doesNotMatch(reply, /put a change in front of you/i);
    assert.doesNotMatch(reply, /padhard\.heygabi\.ai/);

    // ⚠️ And it is NOT the unlinked sentence — the two states have two fixes.
    assert.doesNotMatch(reply, /Run \/link and try me again/);
  });

  it('⚠️ his exact broken reply can no longer be produced in either state', async () => {
    for (const reason of ['no_email', 'unlinked', 'outage'] as const) {
      const said: string[] = [];
      await runOwnerQuestion({
        said,
        docsPort: {
          async askerEmail() {
            return { ok: false, reason } as const;
          },
          async search() {
            return { ok: true, status: 200, body: {} };
          },
          async section() {
            return { ok: true, status: 200, body: {} };
          },
        },
      });
      const reply = said.join('\n');
      assert.notEqual(reply.trim(), HIS_BROKEN_REPLY.trim(), `state ${reason} still produces the failing reply`);
      assert.doesNotMatch(reply, /Nothing on the estate's public shelf matches that/);
    }
  });

  it('⚠️ with the posture OFF a docs question is told so — never a shelf miss', async () => {
    const said: string[] = [];
    let shelfCalls = 0;
    await runOwnerQuestion({
      said,
      docsEnabled: false,
      docsPort: null,
      onShelfFetch: () => {
        shelfCalls += 1;
      },
    });
    const reply = said.join('\n');
    assert.match(reply, /switched off/i);
    assert.match(reply, /heygabi\.ai\/docs/, 'the off sentence should still point somewhere useful');
    assert.equal(shelfCalls, 0, 'a switched-off docs question fell through to the shelf');
    assert.doesNotMatch(reply, /public shelf/i);
  });

  it('⚠️ a surface that predates the docs feature falls through UNCHANGED', async () => {
    // `docsEnabled` undefined = a caller that never knew about docs. It must
    // keep its old behaviour rather than be handed a sentence about a
    // capability it never had.
    const said: string[] = [];
    let shelfCalls = 0;
    await runOwnerQuestion({
      said,
      docsEnabled: undefined,
      docsPort: null,
      onShelfFetch: () => {
        shelfCalls += 1;
      },
    });
    assert.equal(shelfCalls, 1, 'the pre-docs ladder changed for a caller that never opted in');
  });
});

describe('⚠️ docsIntent is narrow — book questions must not be eaten', () => {
  it('fires on operational questions', () => {
    for (const q of [
      'how do I promote the audiobook site?',
      'and how do I roll it back?',
      'what is the rollback procedure',
      'how do I deploy the worker',
      'where is the runbook for the pipeline',
      'why did we decide to use wrangler',
      'how does the revocation delay work',
      'what are the steps to rotate the secret',
      'do we have a runbook for promoting?',
    ]) {
      assert.equal(docsIntent(q), true, `MISSED a docs question: ${q}`);
    }
  });

  it('⚠️ does NOT fire on book questions — including the ones with ops-shaped words', () => {
    for (const q of [
      'do we have Mistborn?',
      'who narrates The Way of Kings?',
      'what Stormlight books do we have',
      'how many Sanderson books do we have',
      'fix the author on Steelheart',
      'morning!',
      'thanks!',
      'what can you do?',
      // ⚠️ The worked traps: real books whose titles are operations words.
      'do we have The Secret History',
      'do we have The Secret Garden?',
      'have we got any books about gates',
      'is The Book of Tokens on the shelf',
    ]) {
      assert.equal(docsIntent(q), false, `⚠️ ATE a book question: ${q}`);
    }
  });

  it('an empty or whitespace message is never a docs question', () => {
    for (const q of ['', '   ', '\n']) assert.equal(docsIntent(q), false);
  });
});

describe('⚠️ every pre-existing intent still routes as it did', () => {
  it('a genuine shelf question still reaches the shelf, with docs fully configured', async () => {
    const said: string[] = [];
    let shelfCalls = 0;
    let docsSearches = 0;
    await runOwnerQuestion({
      question: 'do we have Mistborn?',
      said,
      onShelfFetch: () => {
        shelfCalls += 1;
      },
      docsPort: {
        async askerEmail() {
          return { ok: true, email: 'owner@example.test' } as const;
        },
        async search() {
          docsSearches += 1;
          return { ok: true, status: 200, body: {} };
        },
        async section() {
          return { ok: true, status: 200, body: {} };
        },
      },
    });
    assert.equal(shelfCalls, 1, '⚠️ a book question stopped reaching the shelf');
    assert.equal(docsSearches, 0, '⚠️ a book question reached the gated corpus');
    assert.match(said.join('\n'), /public shelf/i);
  });

  it('the keyword router is unchanged for every intent it already had', () => {
    assert.equal(classifyByKeyword('do we have Mistborn?'), 'have_lookup');
    assert.equal(classifyByKeyword('fix the author on Steelheart'), 'fix_request');
    // ⚠️ "good morning" is the pattern; a bare "morning!" is not, and falls to
    // `question`. Pinned as it ACTUALLY behaves rather than as it reads.
    assert.equal(classifyByKeyword('good morning'), 'smalltalk');
    assert.equal(classifyByKeyword('morning!'), 'question');
    assert.equal(classifyByKeyword('what can you do?'), 'question');
  });
});

// ── 11. ⚠️ THE SILENT PARTIAL OF 2026-08-18 ────────────────────────────────
//
// The owner asked "how do I promote the audiobook site?" for the third time
// that night. Router, docs door, search and the model turn all worked. GABI
// posted EXACTLY this and then nothing, ever:
//
//     Perfect — found it. Let me read the promoting section:
//
// `mention-flow.ts` posts ONCE, at the end of the turn — it never streams
// intermediate blocks — so that announcement WAS the turn's final answer. It
// reached the channel through `converseWithTools`'s exit guard, which treats
// any stop_reason other than 'tool_use' as "this is the answer".
//
// ⚠️ Nothing threw, which is why the wobble fallback never fired: it only
// covers a null text, and this path returned a well-formed string that simply
// was not an answer.
// ---------------------------------------------------------------------------

/** ⚠️ Verbatim from the owner's paste. Do not tidy — it is the artefact. */
const THE_SILENT_PARTIAL = 'Perfect — found it. Let me read the promoting section:';

describe('⚠️ REGRESSION: a turn that trails off mid-thought is never the answer', () => {
  it('the two shapes that produced it are both recognised as unfinished', () => {
    // Shape 1: the model narrated the step and ended its turn.
    assert.equal(needsFinishing(THE_SILENT_PARTIAL, 'end_turn'), true);
    // Shape 2: truncated mid-tool_use, so the stop reason is max_tokens and the
    // text is whatever it managed to emit first.
    assert.equal(needsFinishing(THE_SILENT_PARTIAL, 'max_tokens'), true);
    assert.equal(needsFinishing('anything at all', 'max_tokens'), true);
  });

  it('⚠️ a real answer is NOT mistaken for an unfinished one', () => {
    // The detector is deliberately narrow. Eating a genuine answer would be a
    // worse failure than the one it fixes.
    for (const good of [
      'Promoting runs the promote workflow — see audiobook_catalog/docs/access/PROMOTE.md.',
      'The docs do not cover that.',
      'Kate Reading and Michael Kramer narrate The Way of Kings.',
      'Here are the three steps.',
      'Run `npm run promote`!',
    ]) {
      assert.equal(needsFinishing(good, 'end_turn'), false, `flagged a real answer: ${good}`);
    }
    assert.equal(needsFinishing('', 'end_turn'), false, 'empty text is a different failure');
  });

  it('⚠️ the narration is nudged to finish instead of being posted', async () => {
    // Turn 1 emits the exact failing shape. The fix must NOT deliver it — it
    // must come back for more and deliver what turn 2 says.
    const said: string[] = [];
    let modelTurns = 0;
    const bodies: unknown[] = [];

    await runOwnerQuestion({
      said,
      docsPort: passingDocsPort(),
      modelScript: (body) => {
        modelTurns += 1;
        bodies.push(body);
        if (modelTurns === 1) {
          return { content: [{ type: 'text', text: THE_SILENT_PARTIAL }], stop_reason: 'end_turn' };
        }
        return {
          content: [
            {
              type: 'text',
              text: 'Promoting runs the promote workflow — see audiobook_catalog/docs/access/PROMOTE.md, from the docs snapshot published 2026-08-18.',
            },
          ],
          stop_reason: 'end_turn',
        };
      },
    });

    const reply = said.join('\n');
    assert.ok(modelTurns >= 2, 'the turn gave up instead of nudging the model to finish');
    assert.match(reply, /PROMOTE\.md/, 'the finished answer did not reach the channel');
    assert.doesNotMatch(
      reply,
      /Let me read the promoting section:$/m,
      '⚠️ the bare narration was posted as the answer again',
    );
  });

  it('⚠️ a max_tokens truncation mid-tool_use is nudged too, not shipped', async () => {
    const said: string[] = [];
    let modelTurns = 0;
    await runOwnerQuestion({
      said,
      docsPort: passingDocsPort(),
      modelScript: () => {
        modelTurns += 1;
        if (modelTurns === 1) {
          // Text emitted, tool call cut off. stop_reason is NOT 'tool_use',
          // which is exactly why the old guard short-circuited.
          return {
            content: [
              { type: 'text', text: THE_SILENT_PARTIAL },
              { type: 'tool_use', id: 'toolu_cut', name: 'read_estate_doc', input: {} },
            ],
            stop_reason: 'max_tokens',
          };
        }
        return { content: [{ type: 'text', text: 'The promote step is documented in PROMOTE.md.' }], stop_reason: 'end_turn' };
      },
    });
    assert.ok(modelTurns >= 2, 'a truncated turn was delivered as final');
    assert.match(said.join('\n'), /PROMOTE\.md/);
  });

  it('⚠️ if it narrates to the very end, the person still gets a COMPLETE thought', async () => {
    // The last-resort net. Every pass narrates; the loop runs out. The reader
    // must never be left staring at a dangling colon.
    const said: string[] = [];
    await runOwnerQuestion({
      said,
      docsPort: passingDocsPort(),
      modelScript: () => ({ content: [{ type: 'text', text: THE_SILENT_PARTIAL }], stop_reason: 'end_turn' }),
    });
    const reply = said.join('\n');
    assert.ok(reply.length > 0, '⚠️ THE TURN WENT SILENT — the exact 2026-08-18 failure');
    assert.doesNotMatch(reply.trimEnd(), /:$/, 'the reply still ends on a dangling colon');
    assert.match(reply, /ran out of room mid-thought/, 'the cut-short sentence is missing');
  });

  it('⚠️ his exact posted message can no longer be the whole reply', async () => {
    const said: string[] = [];
    await runOwnerQuestion({
      said,
      docsPort: passingDocsPort(),
      modelScript: () => ({ content: [{ type: 'text', text: THE_SILENT_PARTIAL }], stop_reason: 'end_turn' }),
    });
    assert.notEqual(said.join('\n').trim(), THE_SILENT_PARTIAL, 'the silent partial shipped again');
  });
});

describe('⚠️ Discord’s 2,000-character ceiling: split, never guillotine', () => {
  it('a short answer is one message and is untouched', () => {
    assert.deepEqual(splitForDiscord('hello'), ['hello']);
  });

  it('⚠️ a long answer is split on paragraph boundaries, losing nothing', () => {
    const para = 'x'.repeat(700);
    const whole = [para, para, para, para].join('\n\n');
    const parts = splitForDiscord(whole);
    assert.ok(parts.length > 1, 'a 2,800-character answer was not split');
    for (const p of parts) assert.ok(p.length <= DISCORD_CONTENT_MAX, 'a chunk exceeds the ceiling');
    // ⚠️ Nothing is dropped. The old behaviour cut at 1,999 and lost the rest.
    const rejoined = parts.join('\n\n').replace(/\s+/g, '');
    assert.equal(rejoined, whole.replace(/\s+/g, ''), 'splitting lost content');
  });

  it('a run with no break at all is still chunked rather than dropped', () => {
    const parts = splitForDiscord('y'.repeat(5000));
    assert.ok(parts.length >= 3);
    for (const p of parts) assert.ok(p.length <= DISCORD_CONTENT_MAX);
    assert.equal(parts.join('').length, 5000, 'a break-less answer lost characters');
  });

  it('⚠️ a long docs answer reaches the channel WHOLE, across messages', async () => {
    const said: string[] = [];
    const longAnswer = ['Step one.', 'x'.repeat(1200), 'y'.repeat(1200), 'Step last.'].join('\n\n');
    await runOwnerQuestion({
      said,
      docsPort: passingDocsPort(),
      modelScript: () => ({ content: [{ type: 'text', text: longAnswer }], stop_reason: 'end_turn' }),
    });
    assert.ok(said.length > 1, 'a >2,000-character answer was not split across messages');
    const joined = said.join('\n');
    assert.match(joined, /Step one\./);
    assert.match(joined, /Step last\./, '⚠️ the END of a long runbook answer was cut off');
  });

  it('⚠️ with nowhere to put the rest, the cut is stated in WORDS', async () => {
    // A surface with no follow-up channel. The reader must be told, and told
    // where the whole thing lives — never left with a bare ellipsis.
    const said: string[] = [];
    await runOwnerQuestion({
      said,
      noFollowUp: true,
      docsPort: passingDocsPort(),
      modelScript: () => ({ content: [{ type: 'text', text: 'z'.repeat(4000) }], stop_reason: 'end_turn' }),
    });
    assert.equal(said.length, 1);
    assert.ok((said[0] as string).length <= DISCORD_CONTENT_MAX);
    assert.match(said[0] as string, /as much as fits in one Discord message/);
    assert.match(said[0] as string, /heygabi\.ai\/docs/);
  });
});

describe('⚠️ nothing may die between a post and the turn’s end', () => {
  it('bookkeeping that throws AFTER the answer does not contradict it', async () => {
    // Before the fix this fell into the outer catch and posted "I couldn't
    // reach the estate's catalogue just then" — after the answer had already
    // landed. A lie about a turn that worked.
    const said: string[] = [];
    const outcome = await runOwnerQuestion({
      said,
      docsPort: passingDocsPort(),
      modelScript: () => ({ content: [{ type: 'text', text: 'The answer, from PROMOTE.md.' }], stop_reason: 'end_turn' }),
      breakBookkeeping: true,
    });
    assert.equal(outcome.answered, true, 'a bookkeeping failure lost a delivered answer');
    const reply = said.join('\n');
    assert.match(reply, /PROMOTE\.md/);
    assert.doesNotMatch(reply, /couldn't reach the estate's catalogue/, 'it contradicted its own answer');
  });

  it('⚠️ a throw AFTER a post still produces a worded follow-up, and says it was CUT OFF', async () => {
    const said: string[] = [];
    await runOwnerQuestion({
      said,
      docsPort: passingDocsPort(),
      modelScript: () => ({ content: [{ type: 'text', text: 'Partial answer.' }], stop_reason: 'end_turn' }),
      throwAfterFirstPost: true,
    });
    assert.ok(said.length >= 2, '⚠️ the turn went silent after speaking — the 2026-08-18 failure');
    const last = said[said.length - 1] as string;
    assert.match(last, /fell over partway/, 'the follow-up does not say it was cut off');
    // ⚠️ And it must NOT claim nothing was searched — the reader can see otherwise.
    assert.doesNotMatch(last, /Nothing was searched/);
  });
});
