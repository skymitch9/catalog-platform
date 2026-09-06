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
 *
 * ⚠️ **UPDATED 2026-09-05 — a fifth failure, the same bug half a step behind.**
 * The 2026-08-18 fix routed *linked* askers and left the FALLBACK on the pilot
 * host, because ~~"the main library has the panel off by decision 8"~~. That was
 * already false: `library_catalog` `34f1301` (2026-08-17) turned the main
 * catalog's panel ON, and both instances measured `gabi.panel: true` on
 * 2026-09-05. `DEFAULT_PANEL_BASE` is now `library.heygabi.ai`.
 *
 * ⚠️ **That change WEAKENED two tests, and both were repaired rather than left
 * green.** "the link is `library.heygabi.ai`" stopped being evidence that the
 * resolution ran, because the fallback now says the same thing. The routing
 * cases in §4 and §5 therefore pass a **sentinel** fallback (`panel.example`)
 * that no resolution can produce, and §4 gained a mirror case that resolves
 * somebody onto `padhard` — a host the fallback can no longer reach.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DEFAULT_PANEL_BASE,
  MAIN_LIBRARY_CATALOG_ID,
  PANEL_PREFILL_MAX,
  PANEL_PREFILL_PARAM,
  PANEL_REGISTRY_TTL_MS,
  choosePanelBase,
  mainLibraryBaseFrom,
  panelBase,
  panelDeepLink,
  panelLinkFor,
  panelRegistryOn,
  resetPanelRegistryCache,
  resolveAskerPanelBase,
  resolvePanelBase,
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
    // ⚠️ CHANGED 2026-09-05 — the static fallback is the MAIN library now
    // (`library_catalog` `34f1301` turned its panel on 2026-08-17; the constant
    // did not move until today). This assertion is about the PATH, not the host.
    assert.equal(url.origin + url.pathname, 'https://library.heygabi.ai/');
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

  it('an ACCOUNT but no capability still beats the static fallback', () => {
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
  /**
   * Runs one `/gabi` turn against stubbed everything and returns what it said.
   *
   * ⚠️ **`fallback` is a parameter, and that is load-bearing since 2026-09-05.**
   * The static fallback became `library.heygabi.ai` that day, which is also the
   * instance a main-library asker resolves TO — so a test that leaves the
   * fallback at its default cannot tell "the resolution ran" from "the
   * resolution never happened". The routing tests pass a SENTINEL host that no
   * resolution can produce; the fallback tests pass the real default.
   */
  async function runGabi(
    panel?: {
      port: PanelIdentityPort;
      instances: readonly LibraryInstance[];
    },
    fallback: string = FALLBACK,
  ): Promise<string> {
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
        panelUrl: fallback,
        discordUserId: 'd1',
        ...(panel ? { panel } : {}),
      });
    } finally {
      globalThis.fetch = original;
    }
    return said;
  }

  /** ⚠️ A host NO resolution can ever return. Every routing assertion below is
   *  written against this, so "the link is the main library" cannot be
   *  satisfied by the fallback quietly doing nothing. */
  const SENTINEL = 'https://panel.example/';

  it('with an identity port: HIS shelf, and the question in the URL', async () => {
    const port = portFor({ ok: true, uid: 'uid-1234567' }, (instance) =>
      instance.app === 'library' ? researcher() : stranger(),
    );
    // ⚠️ The fallback is the SENTINEL, not the default. Since 2026-09-05 the
    // default fallback IS `library.heygabi.ai`, so matching that host proves
    // nothing unless the fallback is somewhere else entirely.
    const said = await runGabi({ port, instances: INSTANCES }, SENTINEL);

    assert.match(said, /library\.heygabi\.ai/, '⚠️ the resolution did not run');
    assert.doesNotMatch(said, /panel\.example/, '⚠️ it fell back instead of resolving');
    assert.doesNotMatch(said, /padhard\.heygabi\.ai/);
    // The question, encoded into the link — the whole point of the prefill.
    assert.match(said, /gabi=fix\+the\+author|gabi=fix%20the%20author/);
  });

  it('⚠️ and HER shelf when she is the one asking — routing, not a constant', async () => {
    // The mirror of the test above, and the half that survives any future move
    // of the default: `padhard` is now reachable ONLY by resolving somebody
    // onto it. If the resolution stops running, this fails and that one might
    // not.
    const port = portFor({ ok: true, uid: 'uid-7654321' }, (instance) =>
      instance.app === 'library2' ? researcher() : stranger(),
    );
    const said = await runGabi({ port, instances: INSTANCES }, SENTINEL);

    assert.match(said, /padhard\.heygabi\.ai/, 'this asker genuinely IS on that shelf');
    assert.doesNotMatch(said, /panel\.example/);
    assert.doesNotMatch(said, /library\.heygabi\.ai/);
  });

  it('WITHOUT a port it behaves exactly as it did — static link, same words', async () => {
    // ⚠️ A real production state, not just a test one: the port is null on any
    // Worker whose app token or service account is unset. Asker-awareness that
    // broke the command when it was unavailable would be worse than the bug.
    const said = await runGabi();
    assert.match(said, /library\.heygabi\.ai/);
    assert.doesNotMatch(said, /padhard\.heygabi\.ai/, '⚠️ the pilot default came back');
    assert.match(said, /GABI can dig deeper/);
  });

  it('an unlinked asker gets the MAIN LIBRARY AND the /link nudge', async () => {
    // ⚠️ CHANGED 2026-09-05 — this used to say "keeps the pilot default", and
    // the pilot default was a second household's shelf. `library_catalog`
    // `34f1301` (2026-08-17) turned the main catalog's panel on; both instances
    // measured `panel: true` on 2026-09-05.
    const port = portFor({ ok: false, reason: 'unlinked' }, () => null);
    const said = await runGabi({ port, instances: INSTANCES });
    assert.match(said, /library\.heygabi\.ai/);
    assert.doesNotMatch(said, /padhard\.heygabi\.ai/);
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
    assert.match(said, /library\.heygabi\.ai/);
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

  /** ⚠️ `fallback` defaults to the real static default, but the ROUTING cases
   *  below pass a sentinel — since 2026-09-05 the default fallback is
   *  `library.heygabi.ai`, so "the link is the main library" is only evidence of
   *  resolution when the fallback is somewhere a resolution cannot reach. */
  async function runMention(
    delegate: PanelIdentityPort | null,
    fallback: string = FALLBACK,
  ): Promise<string> {
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
          panelUrl: fallback,
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
    // ⚠️ The fallback is a SENTINEL. Without it this test would pass on a
    // Worker whose resolution never ran at all, because since 2026-09-05 the
    // static fallback is `library.heygabi.ai` too.
    const reply = await runMention(port, 'https://panel.example/');
    assert.match(reply, /library\.heygabi\.ai/);
    assert.doesNotMatch(reply, /panel\.example/, '⚠️ it fell back instead of resolving');
    assert.doesNotMatch(reply, /padhard\.heygabi\.ai/, "⚠️ the owner's exact complaint came back");
  });

  it('with no identity port the surface is unchanged — the static link, and it works', async () => {
    // ⚠️ CHANGED 2026-09-05: the static link is the MAIN library now, not the
    // pilot host — `library_catalog` `34f1301` turned its panel on 2026-08-17.
    const reply = await runMention(null);
    assert.match(reply, /library\.heygabi\.ai/);
    assert.doesNotMatch(reply, /padhard\.heygabi\.ai/);
    assert.match(reply, new RegExp(`${PANEL_PREFILL_PARAM}=`), 'the prefill needs no port');
  });
});

// ---------------------------------------------------------------------------
// ⚠️ §5 — THE REGISTRY LOOKUP (2026-09-05, survey §3.4's remaining half)
// ---------------------------------------------------------------------------
//
// The 2026-09-05 morning fix moved `DEFAULT_PANEL_BASE` off the pilot host and
// onto the main library. `multi-library-survey-2026-09-05.md` §3.4 recorded
// what it did NOT do, in as many words:
//
//   > ✅ the hard-coded HOST is fixed … ⚠️ **The registry work is NOT done — it
//   > is still a literal, not a lookup.**
//
// It is a lookup now: `GET {INDEX_BASE_URL}/api/catalogs`, the row whose `id`
// is `library`, and its `host`. What these tests exist to keep true:
//
//  1. ⚠️ **THE POSTURE IS FAIL-CLOSED AND OFF IS SILENT.** Anything but the
//     exact word `on` means the pre-registry behaviour, and — asserted, not
//     assumed — makes NO subrequest at all. That is why the other 1,200 tests
//     in this package touch no network.
//  2. ⚠️ **EVERY FAILURE FALLS BACK, and none of them throws.** A dead
//     directory, a 503, a malformed row, a host with a scheme in it: each ends
//     at the configured base, so a link can never get WORSE than it was.
//  3. ⚠️ **IT SENDS NO CREDENTIAL.** The route's anonymous branch is names-only
//     and this end must keep it that way — no Authorization header, ever.
//  4. **The memo is real**, because a directory read per turn would turn a
//     directory outage into a latency outage.
//
// ⚠️ The honest limit: these prove the RESOLUTION. Whether the panel opens for
// the person who follows the link is the destination site's own Firebase
// sign-in and `runResearch` check, and nothing here can or should assert it.

const REGISTRY_BODY = {
  ok: true,
  catalogs: [
    {
      id: 'audiobook',
      push_source: 'audiobook',
      kind: 'audio',
      label: 'Shared audiobooks',
      owner: null,
      holding: 'digital',
      shared: true,
      host: 'audiobooks.heygabi.ai',
    },
    {
      id: MAIN_LIBRARY_CATALOG_ID,
      push_source: 'library',
      kind: 'books',
      label: 'the main library',
      owner: 'Skylar',
      holding: 'physical',
      shared: false,
      host: 'shelf.example.test',
    },
    {
      id: 'library2',
      push_source: 'library2',
      kind: 'books',
      label: 'the other shelf',
      owner: 'Samantha',
      holding: 'physical',
      shared: false,
      host: 'padhard.heygabi.ai',
    },
  ],
  counts: 'none',
};

/** A fetch that records what it was asked and answers `body` with `status`. */
function registrySaid(
  body: unknown,
  status = 200,
): { fetch: typeof fetch; calls: { url: string; init?: RequestInit }[] } {
  const calls: { url: string; init?: RequestInit }[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), ...(init ? { init } : {}) });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { fetch: impl, calls };
}

/** ⚠️ A SENTINEL, not a stub: any call at all fails the test that installed it. */
const neverCalled = (async () => {
  throw new Error('the registry was read when it must not have been');
}) as unknown as typeof fetch;

describe('⚠️ panelRegistryOn — affirmative-only, and OFF is the pre-registry bot', () => {
  it('only the exact word turns it on; case and whitespace are forgiven', () => {
    assert.equal(panelRegistryOn({ GABI_PANEL_REGISTRY: 'on' }), true);
    assert.equal(panelRegistryOn({ GABI_PANEL_REGISTRY: '  ON  ' }), true);
  });

  it('⚠️ everything else is OFF — absent, empty, affirmative-looking, a typo', () => {
    // ⚠️ `"true"`, `"1"` and `"yes"` are the dangerous ones: they are what
    // somebody who knows this Worker's other postures would type, and guessing
    // them into `on` would start a subrequest by typo rather than by decision.
    for (const raw of [undefined, '', '   ', 'true', '1', 'yes', 'enabled', 'On!', 'registry']) {
      assert.equal(
        panelRegistryOn({ GABI_PANEL_REGISTRY: raw }),
        false,
        `"${String(raw)}" must coerce to off`,
      );
    }
  });

  it('⚠️ wrangler.toml declares it, and declares it ON', async () => {
    // If this goes red somebody pinned the host back to the literal. That may
    // well be right — it is one word and a deploy, exactly as designed — but it
    // is a DECISION and it should be visible in a diff rather than discovered
    // by a link pointing at yesterday's hostname.
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const toml = readFileSync(fileURLToPath(new URL('../wrangler.toml', import.meta.url)), 'utf8');
    assert.match(toml, /^GABI_PANEL_REGISTRY = "on"$/m);
  });
});

describe('⚠️ resolvePanelBase — the registry answers, the constant catches', () => {
  it('⚠️ posture OFF makes NO subrequest and returns the configured base', async () => {
    resetPanelRegistryCache();
    assert.equal(await resolvePanelBase({}, { fetch: neverCalled }), DEFAULT_PANEL_BASE);
    assert.equal(
      await resolvePanelBase({ GABI_PANEL_URL: 'https://pinned.example' }, { fetch: neverCalled }),
      'https://pinned.example',
    );
  });

  it('posture ON: the main library’s host comes from the registry', async () => {
    resetPanelRegistryCache();
    const { fetch: f, calls } = registrySaid(REGISTRY_BODY);
    const base = await resolvePanelBase(
      { GABI_PANEL_REGISTRY: 'on', INDEX_BASE_URL: 'https://index.example' },
      { fetch: f },
    );
    // ⚠️ A host NO constant in this repo contains, deliberately: since the
    // 2026-09-05 morning fix the literal is `library.heygabi.ai` too, so a test
    // asserting that would pass on a Worker whose lookup never ran.
    assert.equal(base, 'https://shelf.example.test');
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.url, 'https://index.example/api/catalogs');
  });

  it('⚠️ and it sends NO credential — the anonymous, names-only branch', async () => {
    resetPanelRegistryCache();
    const { fetch: f, calls } = registrySaid(REGISTRY_BODY);
    await resolvePanelBase({ GABI_PANEL_REGISTRY: 'on' }, { fetch: f });
    const headers = (calls[0]?.init?.headers ?? {}) as Record<string, string>;
    for (const key of Object.keys(headers)) {
      assert.doesNotMatch(key, /authorization|cookie|x-api-key/i, `the registry read sent ${key}`);
    }
    assert.equal(JSON.stringify(calls[0]?.init?.body ?? null), 'null', 'it must be a GET with no body');
  });

  it('the registry never overrides its own default when it is unreachable', async () => {
    resetPanelRegistryCache();
    const dead = (async () => {
      throw new Error('connect ECONNREFUSED');
    }) as unknown as typeof fetch;
    assert.equal(
      await resolvePanelBase(
        { GABI_PANEL_REGISTRY: 'on', GABI_PANEL_URL: 'https://pinned.example' },
        { fetch: dead },
      ),
      'https://pinned.example',
    );
  });

  it('a refusal, an empty body and a missing row all fall back — none of them throw', async () => {
    for (const [label, body, status] of [
      ['HTTP 503', { error: 'no directory' }, 503],
      ['no catalogs key', { ok: true }, 200],
      ['catalogs is not an array', { catalogs: 'library' }, 200],
      ['no library row', { catalogs: [{ id: 'games', host: 'boardgames.heygabi.ai' }] }, 200],
    ] as [string, unknown, number][]) {
      resetPanelRegistryCache();
      const { fetch: f } = registrySaid(body, status);
      assert.equal(
        await resolvePanelBase({ GABI_PANEL_REGISTRY: 'on' }, { fetch: f }),
        DEFAULT_PANEL_BASE,
        `${label} did not fall back`,
      );
    }
  });

  it('⚠️ the memo means one read per isolate, and it expires', async () => {
    resetPanelRegistryCache();
    let clock = 1_000_000;
    const { fetch: f, calls } = registrySaid(REGISTRY_BODY);
    const env = { GABI_PANEL_REGISTRY: 'on' };
    const deps = { fetch: f, now: () => clock };

    assert.equal(await resolvePanelBase(env, deps), 'https://shelf.example.test');
    assert.equal(await resolvePanelBase(env, deps), 'https://shelf.example.test');
    assert.equal(calls.length, 1, 'a second turn read the directory again');

    // ⚠️ And it expires. A host edited in D1 must eventually reach a link —
    // "cached forever" would be a different bug wearing this fix's clothes.
    clock += PANEL_REGISTRY_TTL_MS + 1;
    await resolvePanelBase(env, deps);
    assert.equal(calls.length, 2, 'the memo never expired');
  });

  it('⚠️ a failure is remembered too — an outage must not become a latency outage', async () => {
    resetPanelRegistryCache();
    const clock = 2_000_000;
    let reads = 0;
    const dead = (async () => {
      reads += 1;
      throw new Error('connect ECONNREFUSED');
    }) as unknown as typeof fetch;
    const env = { GABI_PANEL_REGISTRY: 'on' };
    const deps = { fetch: dead, now: () => clock };
    assert.equal(await resolvePanelBase(env, deps), DEFAULT_PANEL_BASE);
    assert.equal(await resolvePanelBase(env, deps), DEFAULT_PANEL_BASE);
    assert.equal(reads, 1, 'the outage was retried inside the TTL');
  });
});

describe('mainLibraryBaseFrom — validated, never repaired', () => {
  it('reads the library row and nobody else’s', () => {
    assert.equal(mainLibraryBaseFrom(REGISTRY_BODY), 'https://shelf.example.test');
  });

  /** A COMPLETE registry row. ⚠️ Complete on purpose since 2026-09-06: the
   *  parser is shared with the rest of the Worker now and refuses a partial
   *  row outright, so a `{ id, host }` fixture would pass these tests for the
   *  wrong reason — "the row was malformed" rather than "the host was". */
  const row = (over: Record<string, unknown>) => ({
    ...REGISTRY_BODY.catalogs[1],
    ...over,
  });

  it('⚠️ a host that is not a bare hostname is REFUSED, not fixed', () => {
    // A "corrected" host is a guess, and this one ends up in a link somebody
    // presses. Every one of these returns null so the caller falls back.
    for (const host of [
      '',
      '   ',
      'https://shelf.example.test',
      'shelf.example.test/panel',
      'shelf.example.test:8443',
      'evil@shelf.example.test',
      'shelf example test',
      'shelf.example.test?next=x',
      'shelf.example.test#f',
    ]) {
      assert.equal(
        mainLibraryBaseFrom({ catalogs: [row({ id: MAIN_LIBRARY_CATALOG_ID, host })] }),
        null,
        `"${host}" was accepted`,
      );
    }
  });

  it('a non-object, a null and a string body are all null rather than a throw', () => {
    for (const body of [null, undefined, 'library.heygabi.ai', 42, []]) {
      assert.equal(mainLibraryBaseFrom(body), null);
    }
  });

  it('⚠️ it reads `library`, never `library2` — that is the original bug', () => {
    // Sending an unplaceable stranger to Samantha's shelf is the exact
    // complaint this whole file was written to end ("why is it showing padhard
    // and not the generic site"). A registry answer with only her row in it
    // must fall back, not resolve.
    const onlyFriend = { catalogs: [row({ id: 'library2', host: 'padhard.heygabi.ai' })] };
    assert.equal(mainLibraryBaseFrom(onlyFriend), null);
  });
});

describe('panelBase is unchanged — the sync reader the pin still means', () => {
  it('the configured var, else the constant', () => {
    assert.equal(panelBase({}), DEFAULT_PANEL_BASE);
    assert.equal(panelBase({ GABI_PANEL_URL: '   ' }), DEFAULT_PANEL_BASE);
    assert.equal(panelBase({ GABI_PANEL_URL: 'https://example.test' }), 'https://example.test');
  });
});
