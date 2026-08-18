/**
 * estate-docs.ts — the docs corpus routes (GABI docs assistant, phase 2).
 *
 * Same stance as backups.test.ts and todo.test.ts on the GATE: `requireDevops()`
 * is NOT re-verified here, because `resolveIdentity()` needs a fully-configured
 * Firebase verifier context to fail the way production does, and a bare Hono
 * `.request()` with a stub env answers 500 misconfigured rather than 401/403.
 * The gate is proven LIVE by tools/estate-probes (tokenless -> 401) and by
 * every other requireDevops() route sharing the same middleware.
 *
 * What IS tested here is everything the gate does not decide: the routing
 * order that the whole feature silently depends on, the search and section
 * logic (pure, so exercised directly), the snapshot-staleness arithmetic, the
 * caps, and the privacy contract on snippets.
 */

import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { test } from 'node:test';
import { Hono } from 'hono';
import {
  DEFAULT_HITS,
  DOCS_REFUSALS,
  DocsStoreError,
  MAX_HITS,
  ON_BEHALF_OF_HEADER,
  RECEIPT_KEY,
  SECTION_MAX_BYTES,
  SNAPSHOT_KEY,
  SNIPPET_CHARS,
  STALE_AFTER_HOURS,
  __resetDocsCache,
  estateDocsRoutes,
  findSection,
  loadBundle,
  makeSnippet,
  parseSectionId,
  searchBundle,
  sectionBody,
  sectionId,
  snapshotMeta,
  tokenize,
  type DocsBucket,
  type DocsBundle,
} from '../src/estate-docs.js';
import { docsRoutes } from '../src/docs.js';
// ---------------------------------------------------------------------------
// ⚠️ A WORKERS-RUNTIME SHIM, AND WHY IT IS NOT THE TEST LYING
//
// `crypto.subtle.timingSafeEqual` is a Cloudflare Workers EXTENSION to
// WebCrypto — it does not exist in Node's `crypto.subtle`, so the estate's one
// bearer-comparison helper (`tokenMatches`, estate.ts) throws a TypeError under
// `node --test` and Hono turns that into a bare 500. Every door-B assertion
// below would then pass or fail for a reason that has nothing to do with the
// gate.
//
// This shim restores the FUNCTION, not the guarantee: it compares the same
// bytes and returns the same boolean, and it is deliberately NOT constant-time,
// because a test process has no attacker to defend against. Production keeps
// the real one. If this ever disappears and the door-B tests start 500ing, this
// comment is the answer.
// ---------------------------------------------------------------------------
const webcrypto = (globalThis as unknown as { crypto: Crypto }).crypto;
if (typeof (webcrypto.subtle as { timingSafeEqual?: unknown }).timingSafeEqual !== 'function') {
  (webcrypto.subtle as unknown as Record<string, unknown>).timingSafeEqual = (
    a: ArrayBufferView,
    b: ArrayBufferView,
  ): boolean => {
    const x = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
    const y = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
    if (x.byteLength !== y.byteLength) return false;
    let diff = 0;
    for (let i = 0; i < x.byteLength; i += 1) diff |= (x[i] as number) ^ (y[i] as number);
    return diff === 0;
  };
}


// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function section(i: number, heading: string, text: string, level = 2) {
  return { i, heading, level, bytes: Buffer.byteLength(text, 'utf8'), text };
}

function bundleFixture(generatedAt = '2026-08-18T00:00:00Z'): DocsBundle {
  const files = [
    {
      repo: 'catalog-platform',
      path: 'catalog-platform/docs/access/deploys.md',
      title: 'Deploys — Access Reference',
      bytes: 0,
      sections: [
        section(0, 'Deploys — Access Reference', 'Header block. Audience: Claude sessions.', 1),
        section(1, 'Promote to prod', 'Run promote.yml. The prod branch is the site root and promote.yml is its only writer.'),
        section(2, 'Rollback', 'Check out the prod-* tag and re-run the promote workflow.'),
      ],
    },
    {
      repo: 'library_catalog',
      path: 'library_catalog/docs/info/revocation.md',
      title: 'Revocation',
      bytes: 0,
      sections: [
        section(0, 'Revocation', 'How a revoked member loses access.', 1),
        section(1, 'Revocation delay', 'Consumers cache the directory answer for ten minutes, so a revocation takes effect within that window.'),
      ],
    },
  ];
  for (const f of files) f.bytes = f.sections.reduce((n, s) => n + s.bytes, 0);
  return {
    schema: 1,
    generated_at: generatedAt,
    corpus: { files: files.length, bytes: 0, sections: 5 },
    git: { 'catalog-platform': 'abc1234' },
    files,
  };
}

/** A fake R2 bucket serving a gzipped bundle, counting reads so the caching
 *  claim is measured rather than asserted. */
class FakeBucket implements DocsBucket {
  gets = 0;
  heads = 0;
  constructor(private objects: Record<string, Buffer | undefined>, public etag = 'v1') {}
  async get(key: string) {
    this.gets += 1;
    const buf = this.objects[key];
    if (!buf) return null;
    return {
      body: new Blob([buf]).stream() as unknown as ReadableStream,
      etag: this.etag,
    };
  }
  async head(key: string) {
    this.heads += 1;
    return this.objects[key] ? { etag: this.etag } : null;
  }
}

function bucketWith(bundle: DocsBundle, receipt?: object) {
  return new FakeBucket({
    [SNAPSHOT_KEY]: gzipSync(Buffer.from(JSON.stringify(bundle), 'utf8')),
    [RECEIPT_KEY]: receipt ? Buffer.from(JSON.stringify(receipt), 'utf8') : undefined,
  });
}

// ---------------------------------------------------------------------------
// ⚠️ THE ROUTING ORDER — the failure that would be hardest to diagnose
// ---------------------------------------------------------------------------

test('⚠️ /estate/docs/search reaches the CORPUS route, not docs.ts’s :slug route', async () => {
  // docs.ts owns GET /estate/docs/:slug and SLUG_RE ([a-z0-9-]{1,64}) matches
  // "search" perfectly. Mounted the wrong way round, this whole feature would
  // answer 404 not_found — a KV miss, which reads as "that document has not
  // been written yet" and nothing like a routing bug. This composes the two
  // routers in index.ts's exact order and proves a real request lands here.
  const app = new Hono();
  app.route('/api', estateDocsRoutes);
  app.route('/api', docsRoutes);

  for (const path of ['/api/estate/docs/search', '/api/estate/docs/section', '/api/estate/docs/receipt']) {
    const res = await app.request(path, {}, { OWNER_EMAILS: '' } as never);
    const body = (await res.json()) as { error?: string };
    // Whatever the gate decides, it must NOT be docs.ts's KV miss.
    assert.notEqual(body.error, 'not_found', `${path} fell through to the :slug route`);
  }
});

test('the :slug route still answers for a real slug when mounted second', async () => {
  const app = new Hono();
  app.route('/api', estateDocsRoutes);
  app.route('/api', docsRoutes);
  const res = await app.request('/api/estate/docs/shelf-server', {}, { OWNER_EMAILS: '' } as never);
  // Reaching the gate (any 4xx/5xx) rather than a 404 route miss is the point:
  // the corpus mount must not shadow arbitrary slugs.
  assert.ok(res.status >= 400);
});

// ---------------------------------------------------------------------------
// Loading + caching
// ---------------------------------------------------------------------------

test('loadBundle: one R2 GET per isolate, then served from module scope', async () => {
  __resetDocsCache();
  const bucket = bucketWith(bundleFixture());
  const t0 = Date.parse('2026-08-18T00:00:00Z');
  await loadBundle(bucket, t0);
  await loadBundle(bucket, t0 + 1000);
  await loadBundle(bucket, t0 + 60_000);
  assert.equal(bucket.gets, 1, 'the corpus was re-downloaded inside the cache window');
  assert.equal(bucket.heads, 0);
});

test('loadBundle: past the revalidate window an unchanged etag costs one HEAD, not a download', async () => {
  // ⚠️ Without this, a long-lived isolate serves a snapshot the staleness
  // warning would still call fresh — the warning would be reporting the
  // publisher's clock while the reader sees the isolate's.
  __resetDocsCache();
  const bucket = bucketWith(bundleFixture());
  const t0 = Date.parse('2026-08-18T00:00:00Z');
  await loadBundle(bucket, t0);
  await loadBundle(bucket, t0 + 10 * 60_000);
  assert.equal(bucket.gets, 1);
  assert.equal(bucket.heads, 1);
});

test('loadBundle: a CHANGED etag does pay for a fresh download', async () => {
  __resetDocsCache();
  const bucket = bucketWith(bundleFixture());
  const t0 = Date.parse('2026-08-18T00:00:00Z');
  await loadBundle(bucket, t0);
  bucket.etag = 'v2';
  await loadBundle(bucket, t0 + 10 * 60_000);
  assert.equal(bucket.gets, 2);
});

test('loadBundle: an absent object is snapshot_absent, NOT an empty corpus', async () => {
  // "Nothing published yet" and "published and empty" have different fixes,
  // so they must never answer alike.
  __resetDocsCache();
  const bucket = new FakeBucket({});
  await assert.rejects(
    () => loadBundle(bucket, Date.now()),
    (err: unknown) => err instanceof DocsStoreError && err.code === 'snapshot_absent',
  );
});

test('loadBundle: a corrupt object is snapshot_unreadable, NOT snapshot_absent', async () => {
  __resetDocsCache();
  const bucket = new FakeBucket({ [SNAPSHOT_KEY]: Buffer.from('not gzip at all') });
  await assert.rejects(
    () => loadBundle(bucket, Date.now()),
    (err: unknown) => err instanceof DocsStoreError && err.code === 'snapshot_unreadable',
  );
});

// ---------------------------------------------------------------------------
// ⚠️ Staleness — "a snapshot has an age, and a stale one is not evidence"
// ---------------------------------------------------------------------------

test('⚠️ the stale threshold is exactly 72 hours, and every answer carries the date', () => {
  assert.equal(STALE_AFTER_HOURS, 72);
  const at = '2026-08-18T00:00:00Z';
  const fresh = snapshotMeta(bundleFixture(at), Date.parse(at) + 3600_000);
  assert.equal(fresh.generated_at, at, 'the publish date must ride on every answer');
  assert.equal(fresh.stale, false);
  assert.equal(fresh.warning, undefined, 'a fresh snapshot must carry no warning at all');
});

test('⚠️ past the threshold the answer says so UNPROMPTED, in words, with the age', () => {
  const at = '2026-08-01T00:00:00Z';
  const meta = snapshotMeta(bundleFixture(at), Date.parse(at) + 9 * 24 * 3600_000);
  assert.equal(meta.stale, true);
  assert.equal(meta.age_hours, 216);
  assert.match(meta.warning ?? '', /9 days old/);
  assert.match(meta.warning ?? '', /won’t be in it/);
});

test('snapshotMeta: an unparseable date reports null age rather than pretending freshness', () => {
  const meta = snapshotMeta(bundleFixture('not a date'), Date.now());
  assert.equal(meta.age_hours, null);
  assert.equal(meta.stale, false);
});

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

test('search: returns SECTIONS, never whole files', () => {
  const r = searchBundle(bundleFixture(), 'promote prod', 8);
  assert.ok(r.hits.length > 0);
  const top = r.hits[0]!;
  assert.equal(top.heading, 'Promote to prod');
  assert.equal(top.path, 'catalog-platform/docs/access/deploys.md');
  // Section-level is the whole reason this works — the corpus's four largest
  // files are 778 KB between them, and a file-level answer to one question
  // would be tens of thousands of tokens of archive.
  assert.ok(top.bytes < 500);
});

test('search: a heading hit outranks a body hit', () => {
  const r = searchBundle(bundleFixture(), 'rollback', 8);
  assert.equal(r.hits[0]!.heading, 'Rollback');
});

test('search: the owner’s own review phrase finds the file AND the section', () => {
  // The design's review instruction, exactly: "type a phrase you know is in a
  // runbook (e.g. revocation delay) and check that the result names the file
  // AND the section".
  const r = searchBundle(bundleFixture(), 'revocation delay', 8);
  assert.equal(r.matched, 'all');
  assert.equal(r.hits[0]!.path, 'library_catalog/docs/info/revocation.md');
  assert.equal(r.hits[0]!.heading, 'Revocation delay');
});

test('search: every token must match before the loose pass is tried, and the pass is REPORTED', () => {
  // A loose match presented as an exact one is how a docs assistant answers
  // confidently from the wrong page. The caller has to be able to tell.
  const r = searchBundle(bundleFixture(), 'rollback bananas', 8);
  assert.equal(r.matched, 'any', 'the all-tokens pass should have found nothing here');
  assert.ok(r.hits.length > 0);

  const exact = searchBundle(bundleFixture(), 'promote prod', 8);
  assert.equal(exact.matched, 'all');
});

test('search: nothing matched is reported as nothing matched', () => {
  const r = searchBundle(bundleFixture(), 'quokka', 8);
  assert.deepEqual(r.hits, []);
  assert.equal(r.total, 0);
});

test('search: an empty or punctuation-only query returns nothing rather than everything', () => {
  assert.deepEqual(searchBundle(bundleFixture(), '', 8).hits, []);
  assert.deepEqual(searchBundle(bundleFixture(), '!!! ?', 8).hits, []);
});

test('search: results are stable across identical queries', () => {
  const a = searchBundle(bundleFixture(), 'the', 25).hits.map((h) => h.id);
  const b = searchBundle(bundleFixture(), 'the', 25).hits.map((h) => h.id);
  assert.deepEqual(a, b);
});

test('⚠️ caps: 8 hits by default, 25 the ceiling, 400-char snippets', () => {
  assert.equal(DEFAULT_HITS, 8);
  assert.equal(MAX_HITS, 25);
  assert.equal(SNIPPET_CHARS, 400);
  assert.equal(SECTION_MAX_BYTES, 8192);
});

test('snippets are clipped and are PLAIN TEXT — never assembled markup', () => {
  const long = `${'lorem ipsum '.repeat(300)}needle${' dolor sit '.repeat(300)}`;
  const snip = makeSnippet(long, ['needle']);
  assert.ok(snip.length <= SNIPPET_CHARS + 10, `snippet was ${snip.length} chars`);
  assert.ok(snip.includes('needle'));
  // ⚠️ Highlighting is the PAGE's job, from `terms`. Markup built here would
  // have to be trusted by every consumer — including a Discord message, where
  // it renders as literal tags.
  assert.ok(!/<\/?[a-z]/i.test(snip), 'the snippet carried markup');
});

test('⚠️ a snippet does not repeat the heading rendered directly above it', () => {
  // Seen live on /docs (2026-08-18): every snippet opened by echoing its own
  // heading, raw `###` markers and all, so the first line of every result was
  // noise and the 400-character budget bought ~340 of real document.
  const s = section(0, 'Auto-promote', '## Auto-promote\n\nBook commits flow to prod with no human step.');
  const body = sectionBody(s);
  assert.ok(!body.startsWith('#'), 'the raw heading markers survived into the snippet');
  assert.ok(body.startsWith('Book commits flow'));
});

test('sectionBody: a continuation or a DIFFERENT first heading keeps its text whole', () => {
  // A hard-split continuation carries no heading line of its own, and a first
  // line that happens to be another heading is real content — dropping either
  // would delete document text, which is strictly worse than a tidy snippet.
  const cont = section(3, 'Big section (cont. 4)', 'the middle of a long list\nand more');
  assert.equal(sectionBody(cont), cont.text);
  const other = section(1, 'Deploys', '### Something else entirely\n\nbody');
  assert.equal(sectionBody(other), other.text);
});

test('sectionBody is a DISPLAY change only — a heading match still outranks a body match', () => {
  // Scoring runs over the full text on purpose. If this ever regresses, a
  // search for a word that appears ONLY in a heading would find nothing.
  const r = searchBundle(bundleFixture(), 'rollback', 8);
  assert.equal(r.hits[0]!.heading, 'Rollback');
});

test('tokenize: bounded, deduped, and drops one-character noise', () => {
  assert.deepEqual(tokenize('Promote  to PROD promote'), ['promote', 'to', 'prod']);
  assert.equal(tokenize('a b c d e f g h i j k l m n').length <= 8, true);
});

// ---------------------------------------------------------------------------
// Section ids + read
// ---------------------------------------------------------------------------

test('section ids round-trip, including paths that contain a #', () => {
  const id = sectionId('catalog-platform/docs/a#b.md', 4);
  assert.deepEqual(parseSectionId(id), { path: 'catalog-platform/docs/a#b.md', i: 4 });
});

test('a malformed section id is rejected rather than guessed at', () => {
  assert.equal(parseSectionId('no-hash'), null);
  assert.equal(parseSectionId('#3'), null);
  assert.equal(parseSectionId('path#notanumber'), null);
  assert.equal(parseSectionId('path#-1'), null);
});

test('findSection: an unknown path or index is null, never the wrong section', () => {
  const b = bundleFixture();
  assert.equal(findSection(b, 'nope.md', 0), null);
  assert.equal(findSection(b, 'catalog-platform/docs/access/deploys.md', 99), null);
  assert.equal(findSection(b, 'catalog-platform/docs/access/deploys.md', 1)!.section.heading, 'Promote to prod');
});

// ---------------------------------------------------------------------------
// Refusal copy — one implementation, so phases 3/4 cannot invent a fifth
// ---------------------------------------------------------------------------

test('⚠️ all four §4.5 refusal causes have their OWN sentence, and the outage is not a permission failure', () => {
  const values = Object.values(DOCS_REFUSALS);
  assert.equal(new Set(values).size, values.length, 'two causes share one sentence');
  for (const s of values) assert.ok(s.length > 40, `too terse to be a refusal: ${s}`);
  // The row most easily mislabelled: a 502 is an outage, and saying "you lack
  // permission" sends the owner hunting for a grant he already holds.
  assert.match(DOCS_REFUSALS.estate_unreachable, /not your permissions/);
  assert.match(DOCS_REFUSALS.not_devops, /deliberate line, not a glitch/);
  assert.match(DOCS_REFUSALS.not_linked, /\/link/);
  assert.match(DOCS_REFUSALS.link_has_no_email, /Re-run \/link/);
});

// ---------------------------------------------------------------------------
// Route-level config failure (no identity involved)
// ---------------------------------------------------------------------------

test('⚠️ an EMPTY query is the starting state, not an error — 200 carrying the snapshot', async () => {
  // Found live on /docs's first signed-in run (2026-08-18): with an empty `q`
  // answering 400, the page had no snapshot date to show until someone typed,
  // and its own footer referred to "the date above" while no date was on
  // screen. The 200 is what lets the page prime its freshness strip — and it
  // is also the earliest moment a signed-in NON-devops visitor can be refused
  // in words, instead of being handed a box that silently does nothing.
  __resetDocsCache();
  const bundle = bundleFixture();
  const bucket = bucketWith(bundle);
  const loaded = await loadBundle(bucket, Date.parse(bundle.generated_at) + 3600_000);
  const meta = snapshotMeta(loaded, Date.parse(bundle.generated_at) + 3600_000);
  // The envelope the empty-query branch sends is exactly this metadata plus an
  // empty result set — asserted through the pure pieces, since the route
  // itself cannot get past requireDevops() with a stub env (see this file's
  // header). The status is pinned by the probe suite live.
  assert.equal(meta.generated_at, bundle.generated_at);
  assert.equal(meta.files, 2);
  assert.deepEqual(searchBundle(loaded, '', 8).hits, []);
});

test('the routes never crash bare on a stub env — every path is a worded 4xx/5xx', async () => {
  for (const path of ['/estate/docs/search?q=x', '/estate/docs/section?id=a%230', '/estate/docs/receipt']) {
    const res = await estateDocsRoutes.request(
      path,
      { headers: { authorization: 'Bearer whatever' } },
      { OWNER_EMAILS: '', DB: undefined as unknown } as never,
    );
    assert.ok(res.status >= 400 && res.status < 600, `${path} -> ${res.status}`);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(typeof body.error, 'string', `${path} answered without an error code`);
  }
});

// ---------------------------------------------------------------------------
// ⚠️ DOOR B — the Discord door (phase 3)
//
// Unlike door A, this one IS exercisable in-process: it needs no Firebase
// verifier context, only the app token, OWNER_EMAILS and a D1 stub. So the
// gate's decision is TESTED here rather than reasoned about — which matters,
// because this is the first door onto the corpus that a person never touches,
// and because §10.8 recorded the non-devops path as asserted-in-code-only.
// ---------------------------------------------------------------------------

const DOCS_TOKEN = 'door-b-token-for-tests-only-not-a-real-secret';

/** A D1 stub narrow enough that `getUserByEmail` is the only thing it serves.
 *  `throws` models the outage path, which must never be worded as a refusal. */
function dbWith(row: Record<string, unknown> | null, opts: { throws?: boolean } = {}) {
  return {
    prepare() {
      return {
        bind() {
          return {
            async first() {
              if (opts.throws) throw new Error('D1_ERROR: no such table');
              return row;
            },
          };
        },
      };
    },
  } as unknown as D1Database;
}

/** An approved devops row. Everything the gate does not read is inert. */
function userRow(over: Record<string, unknown> = {}) {
  return {
    id: 7,
    email: 'devops@example.test',
    firebase_uid: null,
    display_name: null,
    status: 'approved',
    is_approver: 0,
    is_devops: 1,
    dev_access: 0,
    origin: 'manual',
    note: null,
    first_seen_at: '2026-08-01T00:00:00Z',
    decided_at: null,
    decided_by: null,
    vis_audiobook: 1,
    vis_library: 1,
    vis_games: 1,
    vis_library2: 0,
    vis_ebooks: 0,
    ...over,
  };
}

function doorB(
  path: string,
  headers: Record<string, string>,
  env: Record<string, unknown>,
): Promise<Response> {
  return Promise.resolve(estateDocsRoutes.request(path, { headers }, {
    OWNER_EMAILS: '',
    ESTATE_APP_TOKEN_DISCORD_DOCS: DOCS_TOKEN,
    ...env,
  } as never));
}

/** Past the gate, the next thing that can fail on a stub env is the unbound
 *  bucket. So `docs_store_unbound` IS the "the gate let this caller through"
 *  signal — and it is a signal no refusal can counterfeit. */
const THROUGH = 'docs_store_unbound';

test('⚠️ door B: an approved DEVOPS row gets through to the route', async () => {
  const res = await doorB(
    '/estate/docs/receipt',
    { authorization: `Bearer ${DOCS_TOKEN}`, 'x-estate-on-behalf-of': 'devops@example.test' },
    { DB: dbWith(userRow()) },
  );
  const body = (await res.json()) as { error?: string };
  assert.equal(body.error, THROUGH, `door B refused a devops caller: ${body.error}`);
  assert.equal(res.status, 503);
});

test('⚠️ door B: an APPROVER gets through too — approvers hold devops implicitly', async () => {
  const res = await doorB(
    '/estate/docs/receipt',
    { authorization: `Bearer ${DOCS_TOKEN}`, 'x-estate-on-behalf-of': 'approver@example.test' },
    { DB: dbWith(userRow({ is_devops: 0, is_approver: 1 })) },
  );
  assert.equal(((await res.json()) as { error?: string }).error, THROUGH);
});

test('⚠️ door B: an OWNER with no directory row gets through (break-glass)', async () => {
  const res = await doorB(
    '/estate/docs/receipt',
    { authorization: `Bearer ${DOCS_TOKEN}`, 'x-estate-on-behalf-of': 'owner@example.test' },
    { DB: dbWith(null), OWNER_EMAILS: 'owner@example.test' },
  );
  assert.equal(((await res.json()) as { error?: string }).error, THROUGH);
});

test('⚠️ door B: an approved NON-devops member is refused, in the design own words', async () => {
  // The case §10.8 recorded as never having been OBSERVED on any door — only
  // asserted in code and in copy. It is observed here: a real row, approved,
  // no operator flag, refused 403 with the one canonical sentence.
  const res = await doorB(
    '/estate/docs/search?q=revocation',
    { authorization: `Bearer ${DOCS_TOKEN}`, 'x-estate-on-behalf-of': 'member@example.test' },
    { DB: dbWith(userRow({ is_devops: 0, is_approver: 0 })) },
  );
  assert.equal(res.status, 403);
  const body = (await res.json()) as { error?: string; detail?: string };
  assert.equal(body.error, 'forbidden');
  assert.equal(body.detail, DOCS_REFUSALS.not_devops, 'a fifth wording of the refusal appeared');
});

test('⚠️ door B: a REVOKED devops row is refused — the flag must not outlive the status', async () => {
  const res = await doorB(
    '/estate/docs/receipt',
    { authorization: `Bearer ${DOCS_TOKEN}`, 'x-estate-on-behalf-of': 'ex@example.test' },
    { DB: dbWith(userRow({ status: 'revoked', is_devops: 1 })) },
  );
  assert.equal(res.status, 403);
  assert.equal(((await res.json()) as { detail?: string }).detail, DOCS_REFUSALS.not_devops);
});

test('⚠️ door B: a PENDING devops row is refused — approval is not implied by a flag', async () => {
  const res = await doorB(
    '/estate/docs/receipt',
    { authorization: `Bearer ${DOCS_TOKEN}`, 'x-estate-on-behalf-of': 'new@example.test' },
    { DB: dbWith(userRow({ status: 'pending', is_devops: 1 })) },
  );
  assert.equal(res.status, 403);
});

test('⚠️ door B: an unknown email is refused', async () => {
  const res = await doorB(
    '/estate/docs/receipt',
    { authorization: `Bearer ${DOCS_TOKEN}`, 'x-estate-on-behalf-of': 'stranger@example.test' },
    { DB: dbWith(null) },
  );
  assert.equal(res.status, 403);
});

test('⚠️ door B: the app token with NO proven email gets the RELINK sentence, not a bare 400', async () => {
  const res = await doorB(
    '/estate/docs/receipt',
    { authorization: `Bearer ${DOCS_TOKEN}` },
    { DB: dbWith(userRow()) },
  );
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error?: string; detail?: string };
  assert.equal(body.error, 'no_proven_email');
  assert.equal(body.detail, DOCS_REFUSALS.link_has_no_email);
});

test('door B: a header that is not an email shape is refused the same way', async () => {
  for (const bad of ['', '   ', 'not-an-email', 'a'.repeat(400)]) {
    const res = await doorB(
      '/estate/docs/receipt',
      { authorization: `Bearer ${DOCS_TOKEN}`, 'x-estate-on-behalf-of': bad },
      { DB: dbWith(userRow()) },
    );
    assert.equal(res.status, 400, `"${bad.slice(0, 12)}" was admitted`);
  }
});

test('⚠️ door B: the email is normalised, so casing and padding cannot dodge the gate', async () => {
  const res = await doorB(
    '/estate/docs/receipt',
    { authorization: `Bearer ${DOCS_TOKEN}`, 'x-estate-on-behalf-of': '  OWNER@Example.TEST  ' },
    { DB: dbWith(null), OWNER_EMAILS: 'owner@example.test' },
  );
  assert.equal(((await res.json()) as { error?: string }).error, THROUGH);
});

test('⚠️ door B: an UNREACHABLE directory is an outage, never a permission failure', async () => {
  // The single most mislabelled state in the whole design (§4.5's last row).
  const res = await doorB(
    '/estate/docs/receipt',
    { authorization: `Bearer ${DOCS_TOKEN}`, 'x-estate-on-behalf-of': 'devops@example.test' },
    { DB: dbWith(null, { throws: true }) },
  );
  assert.equal(res.status, 503);
  const body = (await res.json()) as { error?: string; detail?: string };
  assert.equal(body.error, 'directory_unreachable');
  assert.equal(body.detail, DOCS_REFUSALS.estate_unreachable);
  assert.match(body.detail ?? '', /problem on our side/);
});

test('⚠️ door B does not exist while the secret is unset — everything falls through to door A', async () => {
  // The ships-dark property. Even presenting the bearer that WOULD be the token
  // must not open a door nobody configured.
  const res = await estateDocsRoutes.request(
    '/estate/docs/receipt',
    { headers: { authorization: `Bearer ${DOCS_TOKEN}`, 'x-estate-on-behalf-of': 'devops@example.test' } },
    { OWNER_EMAILS: '', DB: dbWith(userRow()) } as never,
  );
  assert.notEqual(((await res.json()) as { error?: string }).error, THROUGH, 'door B opened with no token set');
});

test('⚠️ door B: a WRONG bearer never opens it, and never says which door it missed', async () => {
  for (const bearer of ['Bearer wrong', 'Bearer ', `Bearer ${DOCS_TOKEN}x`, `Bearer ${DOCS_TOKEN.slice(0, -1)}`]) {
    const res = await doorB(
      '/estate/docs/receipt',
      { authorization: bearer, 'x-estate-on-behalf-of': 'devops@example.test' },
      { DB: dbWith(userRow()) },
    );
    const body = (await res.json()) as { error?: string };
    assert.notEqual(body.error, THROUGH, `"${bearer}" opened door B`);
    assert.notEqual(body.error, 'no_proven_email');
    assert.notEqual(body.error, 'forbidden');
  }
});

test('⚠️ the proven-email header name is pinned — both ends must agree on it', async () => {
  // The discord-worker sends this exact header. A rename on one side alone is a
  // silent 400 on every docs question, so the string is asserted, not assumed.
  assert.equal(ON_BEHALF_OF_HEADER, 'x-estate-on-behalf-of');
  assert.equal(ON_BEHALF_OF_HEADER, ON_BEHALF_OF_HEADER.toLowerCase());
});
