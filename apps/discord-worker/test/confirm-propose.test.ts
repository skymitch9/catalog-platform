/**
 * THE T2 CONFIRM LANE — the PROPOSE trigger (`src/confirm-propose.ts`) and its
 * CALL SITE in `handleMention`.
 *
 * Three properties, in the order they matter:
 *
 *  1. ⚠️ **FLAG-OFF INERTNESS, AT THE CALL SITE.** With `GABI_CONFIRM_T2` off
 *     (or no proposer port) a fix message takes the exact pre-confirm path and
 *     the proposer is NEVER consulted. This is the safety property, and it is
 *     pinned at `handleMention` — not only on the pure function — because the
 *     estate has a documented bug class where the pure function was tested and
 *     the call site was not.
 *  2. **THE PARSE → RESOLVE → DRY-RUN SHAPE.** A fix parses to one book + one
 *     confirmable field + one editable shelf, the DRY-RUN reads `before`
 *     (nothing is applied), and a confirm card + a `confirm_change` pending come
 *     back. Every ambiguity defers to the site (design §4.3).
 *  3. **WHAT THE CALL SITE PASSES.** Flag on + a proposal → the reply carries
 *     the card and the saved pending is a `confirm_change`.
 *
 * The press half is `confirm.test.ts`; this file never re-tests it.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  matchWork,
  parseFixRequest,
  tryProposeWith,
  type ConfirmProposer,
  type ProposeOutcome,
  type ProposerDeps,
} from '../src/confirm-propose.js';
import { handleMention, type ConversationDeps, type MentionConfig, type MentionDeps } from '../src/mention-flow.js';
import { mentionTrigger, type GatewayMessage } from '../src/mentions.js';
import { buildConfirmProposal, type ConfirmChangePending } from '../src/conversation.js';
import type {
  BrowseWork,
  BrowseWorksAnswer,
  DelegatePort,
  FixFieldRequest,
  FixFieldResult,
  LibraryInstance,
  WhoAmI,
} from '../src/delegated.js';

const APP_ID = '1538775435880562758';
const MAIN: LibraryInstance = { app: 'library', label: 'the main library', baseUrl: 'https://library.heygabi.ai' };
const FRIEND: LibraryInstance = { app: 'library2', label: 'your own shelf', baseUrl: 'https://padhard.heygabi.ai' };

function work(id: string, title: string, authors: string | null = 'Brandon Sanderson'): BrowseWork {
  return { id, title, authors, formats: ['Hardcover'], url: `https://library.heygabi.ai/work/${id}` };
}

// ── matchWork — title → exactly one held work, or defer (design §4.3) ─────────

describe('matchWork — a confident single match, or it defers', () => {
  const rows = [work('1', 'Mistborn'), work('2', 'The Way of Kings'), work('3', 'Words of Radiance')];

  it('an exact (normalised) title match is the one', () => {
    const r = matchWork(rows, 'the way of KINGS!');
    assert.equal(r.kind, 'one');
    if (r.kind === 'one') assert.equal(r.work.id, '2');
  });

  it('⚠️ two exact matches are AMBIGUOUS — never a guess', () => {
    const dup = [work('4', 'Elantris'), work('5', 'Elantris')];
    assert.equal(matchWork(dup, 'elantris').kind, 'ambiguous');
  });

  it('a unique containment match (their words inside one title) is the one', () => {
    assert.equal(matchWork(rows, 'Radiance').kind, 'one');
  });

  it('⚠️ containment that hits more than one title is AMBIGUOUS', () => {
    // "of" is inside two titles → deferred, not a coin-flip.
    assert.equal(matchWork(rows, 'of').kind, 'ambiguous');
  });

  it('no match at all is none', () => {
    assert.equal(matchWork(rows, 'Dune').kind, 'none');
  });
});

// ── parseFixRequest — the model chooses a candidate, and defers on any doubt ──

/** A fake Anthropic Messages reply carrying `obj` as the assistant's text. */
function modelReply(text: string): Response {
  return new Response(
    JSON.stringify({
      id: 'm',
      type: 'message',
      role: 'assistant',
      model: 'test',
      content: [{ type: 'text', text }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 1 },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

/** A fake `fetch` that always answers the parse with `text`, and counts calls. */
function modelFetch(text: string): { fetch: typeof fetch; calls: () => number } {
  let n = 0;
  return {
    calls: () => n,
    fetch: (async () => {
      n += 1;
      return modelReply(text);
    }) as unknown as typeof fetch,
  };
}

const WHO = { discordUserId: '42', guildId: '100' };

describe('parseFixRequest — extracts a candidate, or null on every doubt', () => {
  it('pulls book + confirmable field + value out of a fix message', async () => {
    const m = modelFetch('{"book":"Mistborn","field":"series","value":"The Final Empire"}');
    const r = await parseFixRequest('key', 'fix the series on Mistborn to The Final Empire', WHO, { fetch: m.fetch });
    assert.deepEqual(r, { book: 'Mistborn', field: 'series', after: 'The Final Empire' });
  });

  it('maps a human field word (volume) onto the API name', async () => {
    const m = modelFetch('{"book":"Words of Radiance","field":"volume","value":"2"}');
    const r = await parseFixRequest('key', 'set volume to 2', WHO, { fetch: m.fetch });
    assert.equal(r?.field, 'seriesIndexDisplay');
  });

  it('⚠️ a key-moving field (author) is refused — null, deferred to the site', async () => {
    const m = modelFetch('{"book":"Mistborn","field":"author","value":"B. Sanderson"}');
    assert.equal(await parseFixRequest('key', 'fix the author', WHO, { fetch: m.fetch }), null);
  });

  it('a "none" verdict is null', async () => {
    const m = modelFetch('{"field":"none"}');
    assert.equal(await parseFixRequest('key', 'hello there', WHO, { fetch: m.fetch }), null);
  });

  it('⚠️ NO KEY parses nothing and makes no request (the ships-dark ladder)', async () => {
    const m = modelFetch('{"book":"x","field":"series","value":"y"}');
    assert.equal(await parseFixRequest(undefined, 'fix the series', WHO, { fetch: m.fetch }), null);
    assert.equal(m.calls(), 0);
  });

  it('an empty value is not a change anybody asked for → null', async () => {
    const m = modelFetch('{"book":"Mistborn","field":"series","value":""}');
    assert.equal(await parseFixRequest('key', 'fix the series on Mistborn', WHO, { fetch: m.fetch }), null);
  });

  it('a model that answered garbage is null, not a throw', async () => {
    const m = modelFetch('I could not do that');
    assert.equal(await parseFixRequest('key', 'fix the series', WHO, { fetch: m.fetch }), null);
  });
});

// ── tryProposeWith — parse → route → resolve → dry-run propose ────────────────

interface PortStub {
  port: Pick<DelegatePort, 'linkedUid' | 'whoami' | 'browseWorks' | 'fixField'>;
  calls: { linked: number; whoami: number; browse: number; fixField: FixFieldRequest[] };
}

function makePort(opts: {
  uid?: { ok: true; uid: string } | { ok: false; reason: 'unlinked' | 'outage' };
  /** editCatalog per instance app id. */
  editable?: Partial<Record<'library' | 'library2', boolean>>;
  rows?: BrowseWork[];
  browseNull?: boolean;
  fixField?: (req: FixFieldRequest) => FixFieldResult;
} = {}): PortStub {
  const calls = { linked: 0, whoami: 0, browse: 0, fixField: [] as FixFieldRequest[] };
  const editable = opts.editable ?? { library: true };
  return {
    calls,
    port: {
      async linkedUid() {
        calls.linked += 1;
        return opts.uid ?? { ok: true, uid: 'uid-1' };
      },
      async whoami(instance): Promise<WhoAmI | null> {
        calls.whoami += 1;
        return {
          app: instance.app,
          site: instance.baseUrl,
          known: true,
          capabilities: { editCatalog: Boolean(editable[instance.app]) },
        };
      },
      async browseWorks(instance): Promise<BrowseWorksAnswer | null> {
        calls.browse += 1;
        if (opts.browseNull) return null;
        const rows = opts.rows ?? [work('11', 'Mistborn')];
        return { app: instance.app, site: instance.baseUrl, total: rows.length, rows };
      },
      async fixField(_i, _u, req): Promise<FixFieldResult> {
        calls.fixField.push(req);
        return opts.fixField ? opts.fixField(req) : { kind: 'dryrun', before: { series: 'Old series' } };
      },
    },
  };
}

function deps(port: PortStub['port'], text: string, over: Partial<ProposerDeps> = {}): ProposerDeps {
  return {
    port,
    instances: [MAIN, FRIEND],
    keyMaterial: 'estate-app-token',
    apiKey: 'key',
    fetchOverride: modelFetch(text).fetch,
    ...over,
  };
}

const FIX_MSG = 'fix the series on Mistborn to The Final Empire';
const PARSE_OK = '{"book":"Mistborn","field":"series","value":"The Final Empire"}';

describe('tryProposeWith — the whole ladder, with a fake port and a fake model', () => {
  it('⚠️ the happy path: parse → ONE editable shelf → ONE match → dry-run → card', async () => {
    const { port, calls } = makePort();
    const out = await tryProposeWith(deps(port, PARSE_OK), FIX_MSG, WHO, [], null);
    assert.ok(out, 'a proposal should have been produced');
    if (!out) return;
    // ⚠️ The DRY-RUN ran and it was a dry-run — nothing applied.
    assert.equal(calls.fixField.length, 1);
    assert.equal(calls.fixField[0]!.dryRun, true);
    // A confirm_change pending was built, with `before` read from the dry-run
    // (never from the model) and `after` from what the person typed.
    assert.equal(out.pending?.kind, 'confirm_change');
    assert.equal(out.pending?.changes[0]!.field, 'series');
    assert.equal(out.pending?.changes[0]!.before, 'Old series');
    assert.equal(out.pending?.changes[0]!.after, 'The Final Empire');
    assert.equal(out.pending?.instance, 'library');
    // The card carries buttons.
    assert.ok(Array.isArray(out.components));
  });

  it('⚠️ parse fails → null, and NO library call is made (cheap bail)', async () => {
    const { port, calls } = makePort();
    const out = await tryProposeWith(deps(port, '{"field":"none"}'), 'hi there', WHO, [], null);
    assert.equal(out, null);
    assert.equal(calls.linked, 0);
    assert.equal(calls.whoami, 0);
    assert.equal(calls.fixField.length, 0);
  });

  it('⚠️ editable on BOTH shelves → routing is not "one" → defer to the site (null)', async () => {
    const { port, calls } = makePort({ editable: { library: true, library2: true } });
    assert.equal(await tryProposeWith(deps(port, PARSE_OK), FIX_MSG, WHO, [], null), null);
    assert.equal(calls.fixField.length, 0); // never reached the dry-run
  });

  it('⚠️ two title matches → AMBIGUOUS → defer (never a disambiguation inside a confirm)', async () => {
    const { port, calls } = makePort({ rows: [work('11', 'Mistborn'), work('12', 'Mistborn')] });
    assert.equal(await tryProposeWith(deps(port, PARSE_OK), FIX_MSG, WHO, [], null), null);
    assert.equal(calls.fixField.length, 0);
  });

  it('no held work matches the title → defer (null)', async () => {
    const { port } = makePort({ rows: [work('11', 'Dune', 'Herbert')] });
    assert.equal(await tryProposeWith(deps(port, PARSE_OK), FIX_MSG, WHO, [], null), null);
  });

  it('an unlinked asker defers to the panel-link answer (null)', async () => {
    const { port, calls } = makePort({ uid: { ok: false, reason: 'unlinked' } });
    assert.equal(await tryProposeWith(deps(port, PARSE_OK), FIX_MSG, WHO, [], null), null);
    assert.equal(calls.whoami, 0);
  });

  it('the shelf could not be listed → defer (null)', async () => {
    const { port } = makePort({ browseNull: true });
    assert.equal(await tryProposeWith(deps(port, PARSE_OK), FIX_MSG, WHO, [], null), null);
  });

  it('⚠️ capability refused AT the dry-run relays the destination refusal, no button, no pending', async () => {
    const { port } = makePort({
      fixField: () => ({ kind: 'refused', message: 'Your account on library is reader, editing needs editCatalog.' }),
    });
    const out = await tryProposeWith(deps(port, PARSE_OK), FIX_MSG, WHO, [], null);
    assert.ok(out);
    if (!out) return;
    assert.match(out.content, /needs editCatalog/);
    assert.equal(out.pending, null);
    assert.equal(out.components, undefined);
  });
});

// ── THE CALL SITE — handleMention, flag off vs on ────────────────────────────

function msg(content: string): GatewayMessage {
  return {
    id: '900',
    channel_id: '500',
    guild_id: '100',
    type: 0,
    content,
    author: { id: '42', bot: false, username: 'sam', global_name: 'Sam' },
    mentions: [{ id: APP_ID }],
  };
}

/** A conversation stub that captures the last save. */
function convo(pending: ConfirmChangePending | null = null): {
  deps: ConversationDeps;
  saved: () => { pending: unknown } | null;
} {
  let saved: { pending: unknown } | null = null;
  return {
    saved: () => saved,
    deps: {
      async load() {
        return { turns: [], pending };
      },
      async save(entry) {
        saved = entry;
      },
    },
  };
}

/** A spy proposer that records its calls and returns a canned outcome. */
function spyProposer(outcome: ProposeOutcome | null): {
  proposer: ConfirmProposer;
  calls: { question: string; currentPending: ConfirmChangePending | null }[];
} {
  const calls: { question: string; currentPending: ConfirmChangePending | null }[] = [];
  return {
    calls,
    proposer: {
      async tryPropose(question, _who, _history, currentPending) {
        calls.push({ question, currentPending });
        return outcome;
      },
    },
  };
}

async function runFix(
  opts: { confirmT2?: boolean; proposer?: ReturnType<typeof spyProposer>; convo?: ReturnType<typeof convo> },
): Promise<{ said: string[]; components: unknown[] | undefined; embeds: unknown[] | undefined }> {
  const trigger = mentionTrigger(msg(`<@${APP_ID}> please fix the series on Mistborn to The Final Empire`), APP_ID);
  if (trigger.kind !== 'ask') throw new Error('fixture is not a question');
  const said: string[] = [];
  let components: unknown[] | undefined;
  let embeds: unknown[] | undefined;
  const c = opts.convo ?? convo();

  // The panel-link fallback does a public-shelf lookup; keep it offline.
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ books: [] }), { headers: { 'content-type': 'application/json' } })) as typeof fetch;
  try {
    const deps: MentionDeps = {
      capCheck: async () => ({ ok: true }),
      recordTurn: async () => {},
      conversation: c.deps,
      reply: async (content, extra) => {
        said.push(content);
        if (extra?.components) components = extra.components;
        if (extra?.embeds) embeds = extra.embeds;
      },
      ...(opts.proposer ? { confirm: opts.proposer.proposer } : {}),
    };
    const cfg: MentionConfig = {
      indexBaseUrl: 'https://index.example',
      panelUrl: 'https://panel.example/',
      ...(opts.confirmT2 !== undefined ? { confirmT2: opts.confirmT2 } : {}),
    };
    await handleMention(deps, trigger, cfg);
  } finally {
    globalThis.fetch = originalFetch;
  }
  return { said, components, embeds };
}

const CARD: ProposeOutcome = (() => {
  const built = buildConfirmProposal({
    askerId: '42',
    instance: 'library',
    subject: { entity: 'work', id: '11', label: 'Mistborn by Brandon Sanderson' },
    fields: [{ field: 'series', before: 'Old', after: 'The Final Empire' }],
    nonce: 'abc123',
    now: 1_700_000_000_000,
  });
  if (!built.ok) throw new Error('fixture proposal failed to build');
  return {
    content: "Here's exactly what I'll change on the main library.",
    embeds: [{ title: 'Mistborn by Brandon Sanderson' }],
    components: [{ type: 1, components: [{ custom_id: 'gc2|ok|abc123|x|y' }] }],
    pending: built.pending,
  };
})();

describe('⚠️ the CALL SITE — flag-off inertness, and what it passes on', () => {
  it('⚠️ FLAG OFF: the proposer is NEVER consulted, and the fix defers to the panel', async () => {
    const spy = spyProposer(CARD);
    const out = await runFix({ confirmT2: false, proposer: spy });
    assert.equal(spy.calls.length, 0, 'the proposer must not be touched with the flag off');
    assert.match(out.said[0]!, /changing something already recorded is a job for the site/i);
    assert.match(out.said[0]!, /https:\/\/panel\.example\//);
    assert.equal(out.components, undefined, 'no confirm buttons when dark');
  });

  it('⚠️ default (flag unset) is OFF too — an omitted posture never proposes', async () => {
    const spy = spyProposer(CARD);
    await runFix({ proposer: spy }); // no confirmT2 in cfg
    assert.equal(spy.calls.length, 0);
  });

  it('⚠️ flag ON but NO proposer port (ships-dark wiring): still the panel answer', async () => {
    const out = await runFix({ confirmT2: true }); // no proposer in deps
    assert.match(out.said[0]!, /job for the site/i);
    assert.equal(out.components, undefined);
  });

  it('FLAG ON + a proposal: the reply carries the card and the saved pending is a confirm_change', async () => {
    const spy = spyProposer(CARD);
    const c = convo();
    const out = await runFix({ confirmT2: true, proposer: spy, convo: c });
    assert.equal(spy.calls.length, 1, 'the proposer IS consulted with the flag on');
    assert.match(out.said[0]!, /exactly what I'll change/);
    assert.ok(out.components, 'the confirm buttons ride the reply');
    assert.ok(out.embeds, 'the confirm embed rides the reply');
    // ⚠️ WHAT THE CALL SITE PERSISTS — the proposal is stored as the pending
    // slot the press will load.
    const saved = c.saved();
    assert.equal((saved?.pending as ConfirmChangePending | null)?.kind, 'confirm_change');
  });

  it('FLAG ON but the proposer defers (null): falls through to the panel answer', async () => {
    const spy = spyProposer(null);
    const out = await runFix({ confirmT2: true, proposer: spy });
    assert.equal(spy.calls.length, 1);
    assert.match(out.said[0]!, /job for the site/i);
    assert.equal(out.components, undefined);
  });

  it('⚠️ the call site hands the proposer the LOADED pending (for the "replaced" note)', async () => {
    const prior = buildConfirmProposal({
      askerId: '42', instance: 'library',
      subject: { entity: 'work', id: '9', label: 'Prior' },
      fields: [{ field: 'description', before: 'a', after: 'b' }],
      nonce: 'zzz', now: 1_700_000_000_000,
    });
    assert.ok(prior.ok);
    if (!prior.ok) return;
    const spy = spyProposer(null);
    await runFix({ confirmT2: true, proposer: spy, convo: convo(prior.pending) });
    assert.equal(spy.calls[0]!.currentPending?.kind, 'confirm_change');
  });
});
