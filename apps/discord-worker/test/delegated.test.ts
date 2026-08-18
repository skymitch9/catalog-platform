/**
 * ⚠️ **THE BUILD-FAILING GUARD ON GABI'S FIRST WRITE PATH.**
 *
 * Tier 1 (owner-approved 2026-08-17: *"Can I dm her an isbn or a photo and she
 * adds it to the catalog?"* → *"that looks good, start with that"* → *"all of
 * it"*). Five failures, and no other test in this repo can see any of them:
 *
 *  1. **She adds a book she was not asked to add.** A phone number, an order id
 *     or a year passing as an ISBN. The check digit is what stops it, so the
 *     check digit is what is pinned — including a real ISBN with ONE digit
 *     changed, which is the shape of the mistake that actually happens.
 *  2. **She writes to the wrong household's catalog.** Somebody with a role on
 *     both shelves must be ASKED, never guessed at — a wrong guess is a tidy-up
 *     somebody has to notice first.
 *  3. **An outage is worded as a permissions problem**, sending people to ask
 *     for access they already hold. Reachable-but-says-no and unreachable are
 *     different facts and must never collapse into one sentence.
 *  4. **The fuse blows after the thing it protects.** The write cap has to be
 *     checked before the link read, before any site is dialled.
 *  5. **A credential escapes its module.** Pinned in `mentions.test.ts` beside
 *     the property it replaced; the routing and wording live here.
 *
 * Everything below runs with no network, no Durable Object and no secret — the
 * port is an interface, which is the entire reason it is one.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DELEGATE_MSG,
  USER_WRITES_PER_DAY,
  capabilityFor,
  chooseInstances,
  delegatedIntent,
  delegatedWritesOn,
  findIsbn,
  isbn10Valid,
  isbn13Valid,
  libraryInstances,
  wantsDetailsSweep,
  writeCapDecision,
  type DelegatePort,
  type LibraryInstance,
  type WhoAmI,
} from '../src/delegated.js';
import { instancePick, resumeDelegated, runDelegated } from '../src/delegated-flow.js';

// ---------------------------------------------------------------------------
// 1. Detection — a checksummed number, never a model's opinion
// ---------------------------------------------------------------------------

describe('⚠️ she only acts on a number that passes its own check digit', () => {
  it('accepts a real ISBN-13, hyphenated or bare', () => {
    // Mistborn (Tor). ⚠️ Both spellings must fold to the same answer, because
    // people type the hyphens off the back of the book.
    assert.equal(findIsbn('9780765311788'), '9780765311788');
    assert.equal(findIsbn('978-0-7653-1178-8'), '9780765311788');
    assert.equal(findIsbn('add 978 0 765 31178 8 please'), '9780765311788');
  });

  it('⚠️ REJECTS a real ISBN with one digit changed — the mistake that happens', () => {
    // The whole reason the checksum is here. A transposed or mistyped digit is
    // the ordinary human error, and adding a confidently-wrong book from it
    // would be worse than adding nothing (isbn-ladder.md §2: a wrong ISBN
    // resolves to a real, different book, with a cover).
    assert.equal(findIsbn('9780765311789'), null);
    assert.equal(findIsbn('9780765311878'), null);
  });

  it('rejects the things a 13-digit run usually is', () => {
    assert.equal(findIsbn('call me on 07700 900123'), null);
    assert.equal(findIsbn('order 1234567890123'), null);
    assert.equal(findIsbn('at 1755432000000 epoch'), null);
    assert.equal(findIsbn('in 2011'), null, 'a year is not an identifier');
  });

  it('accepts an ISBN-10 only when its mod-11 check passes', () => {
    // ⚠️ `076531178X` — and the X is why this test earns its keep. Mistborn's
    // ISBN-10 ends in a check character, not a digit, and a validator that
    // treated the last position as numeric would reject a real book off the
    // back cover. (`0765311788` is that same number with the check character
    // guessed as an 8, and it is correctly refused.)
    assert.equal(isbn10Valid('076531178X'), true);
    assert.equal(findIsbn('076531178X'), '076531178X');
    assert.equal(findIsbn('0765311788'), null);
    assert.equal(isbn10Valid('043942089X'), true);
  });

  it('the checksums themselves are right in both directions', () => {
    assert.equal(isbn13Valid('9780765311788'), true);
    assert.equal(isbn13Valid('978076531178'), false, 'twelve digits is not an ISBN-13');
    assert.equal(isbn13Valid('abcdefghijklm'), false);
    assert.equal(isbn10Valid('07653117'), false);
  });

  it('⚠️ "fix all my missing details" is matched; "fix the author on X" is NOT', () => {
    // The line between T1 and T2, and it is a real one: filling a blank is
    // additive and auto-applies; changing a recorded value is a mutation that
    // needs a confirm button this build does not have.
    assert.equal(wantsDetailsSweep('fix all my missing details'), true);
    assert.equal(wantsDetailsSweep('can you fill in my missing stuff please'), true);
    assert.equal(wantsDetailsSweep('sort out the blank fields on my books'), true);
    assert.equal(wantsDetailsSweep('run the details sweep'), false, 'no repairing verb, no sweep');

    assert.equal(wantsDetailsSweep('fix the author on Mistborn'), false);
    assert.equal(wantsDetailsSweep('the narrator is wrong'), false);
    assert.equal(wantsDetailsSweep('who narrates The Way of Kings?'), false);
    assert.equal(wantsDetailsSweep('do we have any Sanderson?'), false);
  });

  it('an ISBN beats a sweep request in the same message', () => {
    // "can you fix my missing 9780765311788" means that book, not the catalog.
    assert.deepEqual(delegatedIntent('can you fix my missing 9780765311788'), {
      verb: 'add-isbn',
      isbn: '9780765311788',
    });
    assert.deepEqual(delegatedIntent('fix all my missing details'), { verb: 'run-details' });
    assert.equal(delegatedIntent('morning!'), null, 'small talk starts nothing');
    assert.equal(delegatedIntent('who narrates Way of Kings?'), null);
  });
});

// ---------------------------------------------------------------------------
// 2. The posture
// ---------------------------------------------------------------------------

describe('the kill switch is affirmative-only', () => {
  it('"on" and nothing else', () => {
    assert.equal(delegatedWritesOn({ GABI_DELEGATED_WRITES: 'on' }), true);
    assert.equal(delegatedWritesOn({ GABI_DELEGATED_WRITES: ' ON ' }), true);
    for (const v of ['true', '1', 'yes', 'enabled', '', undefined]) {
      assert.equal(delegatedWritesOn({ GABI_DELEGATED_WRITES: v }), false, `'${v}' must mean OFF`);
    }
  });

  it('the instances default to the two live hostnames and drop trailing slashes', () => {
    const [main, friend] = libraryInstances({});
    assert.equal(main!.baseUrl, 'https://library.heygabi.ai');
    assert.equal(friend!.baseUrl, 'https://padhard.heygabi.ai');
    assert.equal(
      libraryInstances({ LIBRARY_MAIN_URL: 'https://x.test/' })[0]!.baseUrl,
      'https://x.test',
      'a trailing slash would produce //api/... on every call',
    );
  });

  it('the write cap is its own fuse, and refuses in words', () => {
    assert.equal(writeCapDecision(0).ok, true);
    assert.equal(writeCapDecision(USER_WRITES_PER_DAY - 1).ok, true);
    const capped = writeCapDecision(USER_WRITES_PER_DAY);
    assert.equal(capped.ok, false);
    assert.match(capped.ok === false ? capped.message : '', /cap on my side/i);
  });

  it('the capability a verb borrows is read off the allowlist, not repeated', () => {
    assert.equal(capabilityFor('add-isbn'), 'editCatalog');
    assert.equal(capabilityFor('run-details'), 'runResearch');
  });
});

// ---------------------------------------------------------------------------
// 3. Routing — the wrong-household failure
// ---------------------------------------------------------------------------

const MAIN: LibraryInstance = { app: 'library', label: 'the main library', baseUrl: 'https://main.test' };
const FRIEND: LibraryInstance = { app: 'library2', label: 'your own shelf', baseUrl: 'https://friend.test' };

const who = (over: Partial<WhoAmI> = {}): WhoAmI => ({
  app: 'library',
  site: 'main.test',
  known: true,
  role: 'contributor',
  capabilities: { editCatalog: true, runResearch: false },
  ...over,
});

describe('⚠️ instance routing — never guess which household', () => {
  it('one shelf with the capability: go', () => {
    const routing = chooseInstances(
      [
        { instance: MAIN, who: who() },
        { instance: FRIEND, who: who({ known: false }) },
      ],
      'editCatalog',
    );
    assert.deepEqual(routing, { kind: 'one', instance: MAIN });
  });

  it('BOTH shelves: ask, and write nothing', () => {
    const routing = chooseInstances(
      [
        { instance: MAIN, who: who() },
        { instance: FRIEND, who: who() },
      ],
      'editCatalog',
    );
    assert.equal(routing.kind, 'ask');
    assert.deepEqual(routing.kind === 'ask' ? routing.instances : [], [MAIN, FRIEND]);
  });

  it('known but not permitted: relay THAT SITE\'S refusal rather than authoring one', () => {
    // ⚠️ The destination is the authority on why. A bot-authored "you can't"
    // would be a second copy of a role matrix, and the second copy is always
    // the one that goes stale.
    const routing = chooseInstances(
      [
        { instance: MAIN, who: who({ capabilities: { editCatalog: false } }) },
        { instance: FRIEND, who: who({ known: false }) },
      ],
      'editCatalog',
    );
    assert.deepEqual(routing, { kind: 'relay', instance: MAIN });
  });

  it('⚠️ unreachable is NOT "you have no account" — the two must never collapse', () => {
    const nobody = chooseInstances(
      [
        { instance: MAIN, who: who({ known: false }) },
        { instance: FRIEND, who: who({ known: false }) },
      ],
      'editCatalog',
    );
    assert.deepEqual(nobody, { kind: 'none', unreachable: false });

    const down = chooseInstances(
      [
        { instance: MAIN, who: null },
        { instance: FRIEND, who: who({ known: false }) },
      ],
      'editCatalog',
    );
    assert.deepEqual(down, { kind: 'none', unreachable: true });
  });

  it('the capability asked about is the one that decides', () => {
    // A contributor may add but not spend. The same person, the same shelf, two
    // different answers — which is the whole point of gating per verb.
    const answers = [{ instance: MAIN, who: who() }, { instance: FRIEND, who: who({ known: false }) }];
    assert.equal(chooseInstances(answers, 'editCatalog').kind, 'one');
    assert.equal(chooseInstances(answers, 'runResearch').kind, 'relay');
  });
});

// ---------------------------------------------------------------------------
// 4. The flow, end to end, with a fake port
// ---------------------------------------------------------------------------

interface Recorder {
  port: DelegatePort;
  calls: { app: string; verb: string; body?: Record<string, unknown> }[];
}

function fakePort(opts: {
  uid?: string | null;
  outage?: boolean;
  whoami?: (i: LibraryInstance) => WhoAmI | null;
  reply?: string;
}): Recorder {
  const calls: Recorder['calls'] = [];
  return {
    calls,
    port: {
      async linkedUid() {
        if (opts.outage) return { ok: false, reason: 'outage' };
        return opts.uid ? { ok: true, uid: opts.uid } : { ok: false, reason: 'unlinked' };
      },
      async whoami(instance) {
        return opts.whoami ? opts.whoami(instance) : who();
      },
      async call(instance, verb, _uid, body) {
        calls.push({ app: instance.app, verb, ...(body ? { body } : {}) });
        return {
          ok: true,
          status: 200,
          message: opts.reply ?? `pretend ${verb} on ${instance.app}`,
          instance,
        };
      },
    },
  };
}

function deps(port: DelegatePort, writesToday = 0) {
  const written: string[] = [];
  return {
    written,
    deps: {
      delegate: port,
      writeCapCheck: async () => writeCapDecision(writesToday + written.length),
      recordWrite: async (id: string) => void written.push(id),
    },
  };
}

describe('the delegated flow', () => {
  it('adds the book and relays the destination’s own report', async () => {
    const rec = fakePort({
      uid: 'uid-1',
      // One shelf knows them; the other does not. The ordinary household case.
      whoami: (i) => (i.app === 'library' ? who() : who({ known: false })),
      reply: 'Added **Mistborn** by Brandon Sanderson.',
    });
    const d = deps(rec.port);
    const out = await runDelegated(
      { verb: 'add-isbn', isbn: '9780765311788' },
      { discordUserId: '42' },
      d.deps,
      [MAIN, FRIEND],
    );
    assert.match(out.content, /Added \*\*Mistborn\*\*/);
    assert.deepEqual(rec.calls, [
      { app: 'library', verb: 'add-isbn', body: { isbn: '9780765311788' } },
    ]);
    assert.deepEqual(d.written, ['42'], 'the write is counted against the daily fuse');
    assert.equal(out.followUp, undefined, 'an add is fast — there is nothing to report later');
  });

  it('⚠️ the sweep says "on it" FIRST and reports in a second message', async () => {
    const rec = fakePort({
      uid: 'uid-1',
      whoami: () => who({ capabilities: { editCatalog: true, runResearch: true } }),
      reply: 'I filled 1 of the 2 books I looked at.',
    });
    const d = deps(rec.port);
    const out = await runDelegated({ verb: 'run-details' }, { discordUserId: '42' }, d.deps, [MAIN]);

    assert.match(out.content, /On it/i);
    assert.equal(rec.calls.length, 0, 'nothing has been asked of the catalog yet');
    assert.ok(out.followUp, 'the slow verb must hand back something to await');

    const report = await out.followUp!();
    assert.match(report, /<@42>/, 'the report pings the asker — the owner’s own shape for it');
    assert.match(report, /filled 1 of the 2/);
    assert.deepEqual(rec.calls, [{ app: 'library', verb: 'run-details' }]);
  });

  it('⚠️ BOTH shelves: she asks, and NOTHING is called or counted', async () => {
    const rec = fakePort({ uid: 'uid-1' });
    const d = deps(rec.port);
    const out = await runDelegated(
      { verb: 'add-isbn', isbn: '9780765311788' },
      { discordUserId: '42' },
      d.deps,
      [MAIN, FRIEND],
    );
    assert.match(out.content, /not going to guess/i);
    assert.equal(out.pending?.kind, 'instance_pick');
    assert.deepEqual(rec.calls, [], 'a question must write nothing');
    assert.deepEqual(d.written, [], 'and must not spend the fuse either');
    // ⚠️ The verb and the ISBN ride the pending record, so the press performs
    // the request that was OFFERED rather than one re-parsed later.
    const pending = out.pending as Extract<typeof out.pending, { kind: 'instance_pick' }>;
    assert.equal(pending.verb, 'add-isbn');
    assert.equal(pending.isbn, '9780765311788');
    assert.deepEqual(pending.options.map((o) => o.instance), ['library', 'library2']);
  });

  it('answering "which shelf?" writes to the shelf that was chosen', async () => {
    const rec = fakePort({ uid: 'uid-1' });
    const d = deps(rec.port);
    const pending = instancePick({ verb: 'add-isbn', isbn: '9780765311788' }, [MAIN, FRIEND], Date.now());
    const out = await resumeDelegated(
      pending,
      pending.options[1]!,
      { discordUserId: '42' },
      d.deps,
      [MAIN, FRIEND],
    );
    assert.deepEqual(rec.calls, [
      { app: 'library2', verb: 'add-isbn', body: { isbn: '9780765311788' } },
    ]);
    assert.match(out.content, /pretend add-isbn on library2/);
  });

  it('a chosen shelf this deployment no longer offers is stale, not an error', async () => {
    const rec = fakePort({ uid: 'uid-1' });
    const d = deps(rec.port);
    const pending = instancePick({ verb: 'run-details' }, [MAIN, FRIEND], Date.now());
    const out = await resumeDelegated(pending, pending.options[1]!, { discordUserId: '42' }, d.deps, [MAIN]);
    assert.equal(out.content, DELEGATE_MSG.shelfChoiceStale);
    assert.deepEqual(rec.calls, []);
  });

  it('⚠️ the write fuse blows BEFORE the link read and before any site is dialled', async () => {
    let linkReads = 0;
    const rec = fakePort({ uid: 'uid-1' });
    const port: DelegatePort = {
      ...rec.port,
      linkedUid: async (id) => {
        linkReads += 1;
        return rec.port.linkedUid(id);
      },
    };
    const d = deps(port, USER_WRITES_PER_DAY);
    const out = await runDelegated(
      { verb: 'add-isbn', isbn: '9780765311788' },
      { discordUserId: '42' },
      d.deps,
      [MAIN],
    );
    assert.match(out.content, /cap on my side/i);
    assert.equal(linkReads, 0, 'a fuse that blows after the read it protects is decoration');
    assert.deepEqual(rec.calls, []);
  });

  it('an unlinked person is told how to link — never guessed at from a Discord name', async () => {
    const rec = fakePort({ uid: null });
    const d = deps(rec.port);
    const out = await runDelegated({ verb: 'run-details' }, { discordUserId: '42' }, d.deps, [MAIN]);
    assert.match(out.content, /\/link/);
    assert.doesNotMatch(out.content, /permission/i, 'not linked is not a permissions problem');
    assert.deepEqual(rec.calls, []);
  });

  it('⚠️ a link-read OUTAGE is worded as an outage, not as "you are not linked"', async () => {
    const rec = fakePort({ outage: true });
    const d = deps(rec.port);
    const out = await runDelegated({ verb: 'run-details' }, { discordUserId: '42' }, d.deps, [MAIN]);
    assert.equal(out.content, DELEGATE_MSG.linkOutage);
    assert.match(out.content, /NOT a permissions one/);
    assert.doesNotMatch(out.content, /\/link/, 'telling somebody to re-link would be wrong advice');
  });

  it('no account anywhere says where to sign in, and blames nobody', async () => {
    const rec = fakePort({ uid: 'uid-1', whoami: () => who({ known: false }) });
    const d = deps(rec.port);
    const out = await runDelegated(
      { verb: 'add-isbn', isbn: '9780765311788' },
      { discordUserId: '42' },
      d.deps,
      [MAIN, FRIEND],
    );
    assert.match(out.content, /Sign in once/i);
    assert.match(out.content, /library\.heygabi\.ai/);
    assert.deepEqual(rec.calls, []);
  });

  it('every site unreachable is our problem, said as ours', async () => {
    const rec = fakePort({ uid: 'uid-1', whoami: () => null });
    const d = deps(rec.port);
    const out = await runDelegated({ verb: 'run-details' }, { discordUserId: '42' }, d.deps, [MAIN, FRIEND]);
    assert.match(out.content, /outage on our side/i);
    // ⚠️ It may only mention an account to DENY being about one. What it must
    // never do is send somebody off to fix an account that is perfectly fine.
    assert.doesNotMatch(out.content, /sign in|no account|\/link|permission/i);
  });

  it('a port that throws is caught — a Durable Object must never see a rejection', async () => {
    const d = deps({
      linkedUid: async () => {
        throw new Error('boom');
      },
      whoami: async () => null,
      call: async () => {
        throw new Error('boom');
      },
    });
    const out = await runDelegated(
      { verb: 'add-isbn', isbn: '9780765311788' },
      { discordUserId: '42' },
      d.deps,
      [MAIN],
    );
    assert.match(out.content, /outage on our side/i);
  });
});
