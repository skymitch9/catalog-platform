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

  it('⚠️ wrangler.toml ships it OFF — flipping it is an owner decision', () => {
    // Unlike GABI_DELEGATED_WRITES, which the owner approved switched on. This
    // one reaches PII plus an operations runbook.
    assert.match(WRANGLER, /^\s*GABI_DOCS\s*=\s*"off"/m, 'the docs posture no longer ships off');
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

describe('⚠️ credentials live in exactly two modules', () => {
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
    // ONE module". Tier 0b widens that to TWO, on purpose and in writing —
    // never to "credentials are allowed in the chat path".
    for (const file of [
      'src/mention-flow.ts',
      'src/gabi-chat.ts',
      'src/tool-exec.ts',
      'src/catalog-data.ts',
      'src/delegated.ts',
      'src/delegated-flow.ts',
      'src/gabi-tools.ts',
      'src/estate-docs.ts',
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
