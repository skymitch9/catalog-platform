/**
 * ⚠️ **THE OWNER'S LIVE BUG OF 2026-08-18, AS A REGRESSION SUITE.**
 *
 * He asked GABI for a fix and was handed a link to `padhard.heygabi.ai` — the
 * pilot host, hard-coded in `GABI_PANEL_URL` since the days when it was the only
 * instance with the panel switched on. Verbatim: *"why is it showing padhard and
 * not the generic site"*.
 *
 * Four failures are pinned here, and no other test in this repo can see any of
 * them:
 *
 *  1. **The link ignores who is asking.** A person with an account on the main
 *     library is sent to somebody else's shelf, where the panel will not open
 *     for them — a locked door with no sign on it.
 *  2. **The apex is treated as a destination.** `heygabi.ai` runs no panel, so
 *     "point at the generic site" read literally is the same dead end.
 *  3. **The link arrives empty**, so the question just typed in Discord is
 *     retyped in the browser.
 *  4. **An outage moves the link.** A `whoami` that could not be reached is not
 *     evidence that somebody has no account there, and must never re-route them.
 *
 * Everything below runs with no network and no secret: the identity port is an
 * interface, which is the entire reason it is one.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DEFAULT_PANEL_BASE,
  PANEL_PREFILL_MAX,
  PANEL_PREFILL_PARAM,
  choosePanelBase,
  panelDeepLink,
  panelLinkFor,
  resolveAskerPanelBase,
  type PanelAnswer,
  type PanelIdentityPort,
} from '../src/panel.js';
import {
  DEFAULT_LIBRARY_FRIEND,
  DEFAULT_LIBRARY_MAIN,
  libraryInstances,
  type LibraryInstance,
  type WhoAmI,
} from '../src/delegated.js';
import { processGabi } from '../src/gabi.js';
import { handleMention, NO_MEMORY } from '../src/mention-flow.js';
import { mentionTrigger } from '../src/mentions.js';

const INSTANCES = libraryInstances({});
const MAIN = INSTANCES.find((i) => i.app === 'library')!;
const FRIEND = INSTANCES.find((i) => i.app === 'library2')!;

const FALLBACK = `${DEFAULT_PANEL_BASE}/`;

const who = (over: Partial<WhoAmI> = {}): WhoAmI => ({
  app: 'library',
  site: 'the main library',
  known: true,
  ...over,
});

const researcher = (): WhoAmI => who({ capabilities: { runResearch: true } });
const member = (): WhoAmI => who({ capabilities: { runResearch: false } });
const stranger = (): WhoAmI => who({ known: false });

const answers = (main: WhoAmI | null, friend: WhoAmI | null): PanelAnswer[] => [
  { instance: MAIN, who: main },
  { instance: FRIEND, who: friend },
];

// ---------------------------------------------------------------------------
// 1. The prefill — the question, carried
// ---------------------------------------------------------------------------

describe('⚠️ the link carries the question the panel will prefill', () => {
  it('uses `?gabi=`, and NOT the `?q=` the design first named', () => {
    // ⚠️ MEASURED, not chosen. `q` is the library app's own collection search
    // on `/` — the exact path this link points at — so `?q=` would filter the
    // book list to the question as well: an empty catalogue under a floating
    // panel, the link looking broken at the moment it worked.
    assert.equal(PANEL_PREFILL_PARAM, 'gabi');
    const url = new URL(panelDeepLink(DEFAULT_PANEL_BASE, 'fix the author on Mistborn'));
    assert.equal(url.searchParams.get('gabi'), 'fix the author on Mistborn');
    assert.equal(url.searchParams.get('q'), null);
    assert.equal(url.origin + url.pathname, 'https://padhard.heygabi.ai/');
  });

  it('encodes what people actually type — ampersands, hashes, quotes, accents', () => {
    // Every one of these would truncate or corrupt the prefill unencoded, and
    // `#` in particular would silently drop the whole tail into a fragment.
    const raw = 'fix "Kings & Queens" #2 — Håkan Nesser, 100% of it?';
    const url = new URL(panelDeepLink(DEFAULT_PANEL_BASE, raw));
    assert.equal(url.searchParams.get(PANEL_PREFILL_PARAM), raw);
    assert.equal(url.hash, '');
  });

  it('collapses the newlines a Discord message has and a query string does not', () => {
    const url = new URL(panelDeepLink(DEFAULT_PANEL_BASE, '  fix\n\nmy   missing\tdetails  '));
    assert.equal(url.searchParams.get(PANEL_PREFILL_PARAM), 'fix my missing details');
  });

  it('⚠️ truncates to the panel\'s cap HERE rather than being dropped THERE', () => {
    // A link that promises more than the box will hold is a link that lies
    // about what it carried. Cap the TEXT, not the encoded bytes — the panel's
    // limit is on characters.
    const long = 'a'.repeat(PANEL_PREFILL_MAX + 250);
    const value = new URL(panelDeepLink(DEFAULT_PANEL_BASE, long)).searchParams.get(
      PANEL_PREFILL_PARAM,
    );
    assert.equal(value?.length, PANEL_PREFILL_MAX);
    assert.equal(PANEL_PREFILL_MAX, 500);
  });

  it('⚠️ what we send is BYTE-FOR-BYTE what the panel will hold', () => {
    // The panel's own reader, MEASURED off the deployed bundle 2026-08-18
    // (`/assets/index-rvJiy8K2.js`, identical on both instances). Reproduced
    // here so a drift in either direction fails the build rather than showing
    // somebody a link whose text quietly shrinks on arrival.
    const panelWouldRead = (raw: string): string | null => {
      const n = raw.replace(/\s+/g, ' ').trim();
      if (!n) return null;
      return n.length > 500 ? n.slice(0, 500).trimEnd() : n;
    };
    for (const raw of [
      'fix the author on Mistborn',
      '  fix\n\nmy   missing details ',
      `${'word '.repeat(120)}tail`,
      'a'.repeat(499) + ' ' + 'b'.repeat(40),
    ]) {
      const sent = new URL(panelDeepLink(DEFAULT_PANEL_BASE, raw)).searchParams.get(
        PANEL_PREFILL_PARAM,
      );
      assert.equal(sent, panelWouldRead(raw), `the panel would not hold what we sent for: ${raw.slice(0, 40)}`);
    }
  });

  it('an absent or blank question yields the bare link, never a dangling param', () => {
    assert.equal(panelDeepLink(DEFAULT_PANEL_BASE), FALLBACK);
    assert.equal(panelDeepLink(DEFAULT_PANEL_BASE, ''), FALLBACK);
    assert.equal(panelDeepLink(DEFAULT_PANEL_BASE, '   \n\t '), FALLBACK);
  });

  it('a base that is already a finished link round-trips', () => {
    // ⚠️ Callers pass `cfg.panelUrl` — a built link — as the fallback BASE. If
    // this ever doubled a slash the fallback would 404 while every other test
    // still passed.
    assert.equal(panelDeepLink(FALLBACK), FALLBACK);
    assert.equal(new URL(panelDeepLink(FALLBACK, 'hello')).pathname, '/');
  });
});

// ---------------------------------------------------------------------------
// 2. The decision table — whose panel is it
// ---------------------------------------------------------------------------

describe('⚠️ the destination is the ASKER\'S shelf, not the pilot host', () => {
  it('the capability on exactly one instance → that instance', () => {
    assert.equal(choosePanelBase(answers(researcher(), stranger()), FALLBACK), DEFAULT_LIBRARY_MAIN);
    assert.equal(
      choosePanelBase(answers(stranger(), researcher()), FALLBACK),
      DEFAULT_LIBRARY_FRIEND,
    );
  });

  it('⚠️ the capability on BOTH → the main library, never a coin toss', () => {
    // The opposite decision from Tier 1's, on purpose: a WRITE to the wrong
    // shelf is a tidy-up somebody has to notice first, so that path asks. A
    // LINK to the wrong shelf costs one click.
    assert.equal(
      choosePanelBase(answers(researcher(), researcher()), FALLBACK),
      DEFAULT_LIBRARY_MAIN,
    );
  });

  it('an ACCOUNT but no capability still beats the pilot default', () => {
    // The panel may not open — that is the destination's call and this end
    // cannot see the posture — but it is at least their own site, where signing
    // in means something.
    assert.equal(choosePanelBase(answers(stranger(), member()), FALLBACK), DEFAULT_LIBRARY_FRIEND);
    assert.equal(choosePanelBase(answers(member(), member()), FALLBACK), DEFAULT_LIBRARY_MAIN);
  });

  it('capability outranks a bare account, whichever shelf holds which', () => {
    assert.equal(choosePanelBase(answers(member(), researcher()), FALLBACK), DEFAULT_LIBRARY_FRIEND);
  });

  it('no account anywhere → the configured fallback, which is a REAL panel', () => {
    // ⚠️ Not the apex. `heygabi.ai` runs no panel, so "the generic site" read
    // literally would be the same dead end wearing a friendlier hostname.
    assert.equal(choosePanelBase(answers(stranger(), stranger()), FALLBACK), FALLBACK);
    assert.equal(choosePanelBase([], FALLBACK), FALLBACK);
  });

  it('⚠️ an UNREACHABLE shelf never re-routes anybody', () => {
    // `null` is an outage, not "it does not know you". Conflating them would
    // move somebody's link on the strength of a 503.
    assert.equal(choosePanelBase(answers(null, null), FALLBACK), FALLBACK);
    // The one reachable shelf still decides — that is a fact, not a guess.
    assert.equal(choosePanelBase(answers(null, researcher()), FALLBACK), DEFAULT_LIBRARY_FRIEND);
    assert.equal(choosePanelBase(answers(researcher(), null), FALLBACK), DEFAULT_LIBRARY_MAIN);
  });
});

// ---------------------------------------------------------------------------
// 3. The port, the fallbacks, and the subrequest discipline
// ---------------------------------------------------------------------------

/** A port that counts what it was asked, so "cheap" is measured. */
function portFor(
  link: Awaited<ReturnType<PanelIdentityPort['linkedUid']>>,
  answer: (instance: LibraryInstance) => WhoAmI | null,
): PanelIdentityPort & { linkReads: number; whoamis: number } {
  const counts = { linkReads: 0, whoamis: 0 };
  return {
    get linkReads() {
      return counts.linkReads;
    },
    get whoamis() {
      return counts.whoamis;
    },
    async linkedUid() {
      counts.linkReads += 1;
      return link;
    },
    async whoami(instance) {
      counts.whoamis += 1;
      return answer(instance);
    },
  };
}

describe('the resolver is cheap, and every failure lands on the fallback', () => {
  it('⚠️ ONE link read and TWO whoamis per turn, however many links are built', async () => {
    // The memo is the whole subrequest budget. A fix-shaped answer that
    // resolved the asker twice would double the cost of the commonest turn.
    const port = portFor({ ok: true, uid: 'uid-1234567' }, () => researcher());
    const link = panelLinkFor({ port, instances: INSTANCES, discordUserId: 'd1' }, FALLBACK);

    const first = await link('fix my missing details');
    const second = await link('and the sequel?');

    assert.equal(port.linkReads, 1);
    assert.equal(port.whoamis, 2);
    // ⚠️ The BASE is memoised, not the finished link: two prefills, one identity.
    assert.equal(new URL(first).origin, DEFAULT_LIBRARY_MAIN);
    assert.equal(new URL(second).origin, DEFAULT_LIBRARY_MAIN);
    assert.equal(new URL(second).searchParams.get(PANEL_PREFILL_PARAM), 'and the sequel?');
  });

  it('no port at all — a test, or a Worker with no Tier-1 wiring — costs NOTHING', async () => {
    const link = panelLinkFor(null, FALLBACK);
    assert.equal(await link(), FALLBACK);
    assert.equal(new URL(await link('hello')).origin, DEFAULT_PANEL_BASE);
  });

  it('unlinked and link-outage both fall back, and neither is dialled further', async () => {
    for (const reason of ['unlinked', 'outage'] as const) {
      const port = portFor({ ok: false, reason }, () => researcher());
      const link = panelLinkFor({ port, instances: INSTANCES, discordUserId: 'd1' }, FALLBACK);
      assert.equal(new URL(await link('anything')).origin, DEFAULT_PANEL_BASE);
      // ⚠️ No uid means no honest question to ask a shelf. Asking anyway would
      // spend two subrequests to learn nothing.
      assert.equal(port.whoamis, 0);
    }
  });

  it('⚠️ a THROWING port is a fallback, never an unhandled rejection', async () => {
    // This runs inside a Durable Object's socket handler, where a rejection is
    // a silent nothing — the worst failure for a bot somebody just spoke to.
    const exploding: PanelIdentityPort = {
      async linkedUid() {
        throw new Error('firestore said no');
      },
      async whoami() {
        return null;
      },
    };
    const link = panelLinkFor({ port: exploding, instances: INSTANCES, discordUserId: 'd1' }, FALLBACK);
    assert.equal(await link(), FALLBACK);

    const halfExploding: PanelIdentityPort = {
      async linkedUid() {
        return { ok: true, uid: 'uid-1234567' };
      },
      async whoami() {
        throw new Error('the shelf fell over');
      },
    };
    assert.equal(
      await resolveAskerPanelBase(halfExploding, INSTANCES, 'uid-1234567', FALLBACK),
      FALLBACK,
    );
  });

  it('an empty instance list falls back without dialling anything', async () => {
    const port = portFor({ ok: true, uid: 'uid-1234567' }, () => researcher());
    const link = panelLinkFor({ port, instances: [], discordUserId: 'd1' }, FALLBACK);
    assert.equal(await link(), FALLBACK);
    assert.equal(port.whoamis, 0);
  });
});

// ---------------------------------------------------------------------------
// 4. `/gabi` — the command whose whole point is the link
// ---------------------------------------------------------------------------

describe('⚠️ /gabi answers with the asker\'s own panel, loaded with their question', () => {
  /** Runs one `/gabi` turn against stubbed everything and returns what it said. */
  async function runGabi(panel?: {
    port: PanelIdentityPort;
    instances: readonly LibraryInstance[];
  }): Promise<string> {
    const original = globalThis.fetch;
    let said = '';
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : String(input);
      if (url.includes('discord.com')) {
        said = JSON.stringify(JSON.parse(String(init?.body ?? '{}')));
        return new Response('{}', { status: 200 });
      }
      // The index — one hit, so the nibble is the ordinary shape.
      return new Response(JSON.stringify({ query: 'mistborn', scope: ['audiobook'], books: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    try {
      await processGabi({
        question: 'fix the author on Mistborn',
        applicationId: 'app',
        interactionToken: 'tok',
        indexBaseUrl: 'https://index.test',
        panelUrl: FALLBACK,
        discordUserId: 'd1',
        ...(panel ? { panel } : {}),
      });
    } finally {
      globalThis.fetch = original;
    }
    return said;
  }

  it('with an identity port: HIS shelf, and the question in the URL', async () => {
    const port = portFor({ ok: true, uid: 'uid-1234567' }, (instance) =>
      instance.app === 'library' ? researcher() : stranger(),
    );
    const said = await runGabi({ port, instances: INSTANCES });

    assert.match(said, /library\.heygabi\.ai/, '⚠️ the pilot host came back');
    assert.doesNotMatch(said, /padhard\.heygabi\.ai/);
    // The question, encoded into the link — the whole point of the prefill.
    assert.match(said, /gabi=fix\+the\+author|gabi=fix%20the%20author/);
  });

  it('WITHOUT a port it behaves exactly as it did — static link, same words', async () => {
    // ⚠️ A real production state, not just a test one: the port is null on any
    // Worker whose app token or service account is unset. Asker-awareness that
    // broke the command when it was unavailable would be worse than the bug.
    const said = await runGabi();
    assert.match(said, /padhard\.heygabi\.ai/);
    assert.match(said, /GABI can dig deeper/);
  });

  it('an unlinked asker keeps the pilot default AND the /link nudge', async () => {
    const port = portFor({ ok: false, reason: 'unlinked' }, () => null);
    const said = await runGabi({ port, instances: INSTANCES });
    assert.match(said, /padhard\.heygabi\.ai/);
    // ⚠️ The wording is unchanged: somebody with no account anywhere gets a
    // real panel that will ask them to sign in, plus the sentence that tells
    // them how to link. Neither half is a dead end.
    assert.match(said, /not linked to an estate identity/);
  });

  it('⚠️ an OUTAGE never says "you are not linked"', async () => {
    const port = portFor({ ok: false, reason: 'outage' }, () => null);
    const said = await runGabi({ port, instances: INSTANCES });
    assert.doesNotMatch(said, /not linked to an estate identity/);
    assert.doesNotMatch(said, /\/link. connects them/);
    assert.match(said, /padhard\.heygabi\.ai/);
  });
});

// ---------------------------------------------------------------------------
// 5. ⚠️ THE MESSAGE HE ACTUALLY SENT — a fix-shaped ask in a channel
// ---------------------------------------------------------------------------

describe('⚠️ REGRESSION: a fix-shaped ask points at the asker\'s shelf', () => {
  const APP_ID = '1538775435880562758';
  /** ⚠️ Fix-shaped, but NOT a Tier-1 sweep and NOT a docs question — the exact
   *  lane that produced the padhard link. */
  const HIS_SHAPE = 'the author on Mistborn is wrong';

  async function runMention(delegate: PanelIdentityPort | null): Promise<string> {
    const trigger = mentionTrigger(
      {
        id: '900',
        channel_id: '500',
        guild_id: '100',
        type: 0,
        content: `<@${APP_ID}> ${HIS_SHAPE}`,
        author: { id: '42', bot: false, username: 'sam', global_name: 'Sam' },
        mentions: [{ id: APP_ID }],
      } as never,
      APP_ID,
    );
    assert.equal(trigger.kind, 'ask');
    if (trigger.kind !== 'ask') throw new Error('unreachable');

    const said: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ books: [] }), {
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch;
    try {
      const out = await handleMention(
        {
          capCheck: async () => ({ ok: true }),
          recordTurn: async () => {},
          conversation: NO_MEMORY,
          reply: async (content) => void said.push(content),
          ...(delegate
            ? {
                delegated: {
                  delegate: {
                    ...delegate,
                    // ⚠️ Present so the port stays COMPLETE. A panel link never
                    // browses the print shelf; a stub that lies about the shape
                    // is how a port grows a hole.
                    browseWorks: async () => null,
                    fixField: async () => ({ kind: 'unreachable' as const }),
                    // ⚠️ Never reached by a link resolution. If it ever is, the
                    // read path grew a write and this test says so.
                    call: async () => {
                      throw new Error('a deep link must never call a write verb');
                    },
                  },
                  writeCapCheck: async () => ({ ok: true }) as const,
                  recordWrite: async () => {},
                },
              }
            : {}),
        },
        trigger,
        {
          indexBaseUrl: 'https://index.test',
          panelUrl: FALLBACK,
          instances: INSTANCES,
          // ⚠️ WRITES OFF. Resolving where a link points is a READ, and turning
          // Tier 1 off must not send everybody back to the pilot host.
          delegatedWrites: false,
        },
      );
      assert.equal(out.intent, 'fix_request', 'the lane under test moved');
    } finally {
      globalThis.fetch = original;
    }
    return said.join('\n');
  }

  it('his own shelf, with what he typed already in the box', async () => {
    const port = portFor({ ok: true, uid: 'uid-1234567' }, (instance) =>
      instance.app === 'library2' ? researcher() : stranger(),
    );
    const reply = await runMention(port);

    assert.match(reply, /padhard\.heygabi\.ai/, 'this asker genuinely IS on that shelf');
    assert.match(reply, new RegExp(`${PANEL_PREFILL_PARAM}=`), 'the link arrived empty');
    assert.match(reply, /author/, 'the prefill lost the question');
    // ⚠️ Still the sentence the docs regression suite matches on.
    assert.match(reply, /put a change in front of you/);
  });

  it('⚠️ THE BUG: a main-library asker is no longer sent to the pilot host', async () => {
    const port = portFor({ ok: true, uid: 'uid-1234567' }, (instance) =>
      instance.app === 'library' ? researcher() : stranger(),
    );
    const reply = await runMention(port);
    assert.match(reply, /library\.heygabi\.ai/);
    assert.doesNotMatch(reply, /padhard\.heygabi\.ai/, "⚠️ the owner's exact complaint came back");
  });

  it('with no identity port the surface is unchanged — the static link, and it works', async () => {
    const reply = await runMention(null);
    assert.match(reply, /padhard\.heygabi\.ai/);
    assert.match(reply, new RegExp(`${PANEL_PREFILL_PARAM}=`), 'the prefill needs no port');
  });
});
