/**
 * The estate docs CORPUS — search and read, devops-gated, through BOTH doors
 * (design phases 2 and 3). Design of record:
 * docs/info/gabi-docs-assistant-design.md.
 *
 * ⚠️ Door A (a signed-in browser, Firebase ID token) landed 2026-08-18 with
 * phase 2. **Door B (the Discord Worker, app token + a proven email) landed
 * with phase 3** — see `docsGate()` below, which is the whole of it. Both end
 * at the same `devopsAllows()`.
 *
 * Owner brief, verbatim (2026-08-17): *"let's make sure GABI can read all of
 * our docs and stuff so she can even help me if needed for let's say I don't
 * have a Claude code session open."*
 *
 *   GET /api/estate/docs/search?q=…   -> matching SECTIONS, ranked, snippeted
 *   GET /api/estate/docs/section?id=… -> one bounded section, whole
 *   GET /api/estate/docs/receipt      -> the published-file audit list
 *
 * ⚠️ THREE THINGS TO KNOW BEFORE EDITING THIS FILE.
 *
 * 1. ⚠️ THESE ROUTES MUST BE MOUNTED BEFORE `docsRoutes` (src/index.ts), and
 *    that ordering is load-bearing, not stylistic. `docs.ts` owns
 *    `GET /estate/docs/:slug` and its SLUG_RE (`[a-z0-9-]{1,64}`) happily
 *    matches "search", "section" and "receipt". If the slug route wins, this
 *    whole feature answers `404 not_found` — a KV miss — which looks exactly
 *    like "the document has not been written yet" and nothing like a routing
 *    bug. `test/estate-docs.test.ts` pins the order by composing the two
 *    routers in index.ts's order and asserting a real request reaches HERE.
 *
 * 2. ⚠️ THE CORPUS IS NOT PUBLIC AND CANNOT BECOME PUBLIC BY ACCIDENT. It
 *    carries secret NAMES and where they live, deploy and rollback levers,
 *    break-glass SQL, R2 bucket names, the /admin grant grammar, and
 *    household members' email addresses and role assignments. That is PII
 *    plus an operations runbook. The bucket `estate-docs-gated` has no public
 *    r2.dev URL and no custom domain (verified 2026-08-18: "Public access via
 *    the r2.dev URL is disabled") and must never get one — same reasoning
 *    `ebooks-gate.md` §7 gives about `audiobook-covers`. This Worker binding
 *    is the only way in, and `docsGate()` is the only way through it.
 *
 * 3. **`dev_access` IS NOT THE GATE.** `devopsAllows()` (devops OR approver
 *    OR owner, and `status='approved'` when the answer comes from the row) is —
 *    reached through `requireDevops()` on door A and directly on door B.
 *    `estate-auth.md` §10 calls `dev_access` *"a curtain, not a lock"*; a
 *    member handed dev access to preview an ebook page has no business
 *    reading break-glass SQL. Widening this to `devAccessAllows()` would admit
 *    exactly the people the gate exists for.
 *
 * THE SNAPSHOT, AND WHY EVERY ANSWER CARRIES ITS DATE
 * ---------------------------------------------------
 * One gzipped object holds the whole corpus (measured 2026-08-18: 119 markdown
 * files, 3,105,573 raw bytes, 1,413 sections, 1,248,434 gzipped — one R2 GET,
 * and a literal substring scan over 3 MB is milliseconds of Worker CPU). No
 * inverted index, no D1 FTS5, no embeddings: at this size each would be more
 * machinery than the numbers justify, and FTS5 in particular would mean a
 * second write path into the estate's database from a local machine with a
 * non-atomic publish. The publisher's own §5.4 tripwire (WARN 10 MB, REFUSE
 * 25 MB) is what says when that stops being true.
 *
 * ⚠️ **A snapshot has an age, and a stale one is not evidence.** Every answer
 * from these routes carries `snapshot.generated_at`, `age_hours` and a
 * `stale` boolean, and past `STALE_AFTER_HOURS` it also carries a WORDED
 * warning. That is not decoration: the publisher rides the 8-hourly audiobook
 * pipeline (design §2.2 STEP 9), and that pipeline can be paused, disabled, or
 * exit early on a quiet cycle. When it does, this corpus silently stops
 * refreshing, and the ONLY place anyone would notice is the reply.
 *
 * EVERY FAILURE STATE IS DISTINGUISHABLE, AND WORDED
 * --------------------------------------------------
 * `docs_store_unbound` (our setup) / `snapshot_absent` (nothing published yet)
 * / `snapshot_unreadable` (published but corrupt) / `no_match` (a real "I
 * don't know") / the gate's own refusals. ⚠️ The one that gets mislabelled is
 * the outage: an unreachable bucket is NOT a permission failure, and calling
 * it one sends the owner hunting for a grant he already has. Each answers
 * with a `detail` sentence — never a bare status, per the estate's standing
 * rule — and `DOCS_REFUSALS` below is the single copy of the four gate
 * sentences, exported so phases 3-4 (Discord) reuse them rather than inventing
 * a fifth wording.
 */

import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
import type { AppBindings, EstateUserRow } from './env.js';
import { parseOwnerEmails } from './env.js';
import { getUserByEmail } from './estate-db.js';
import { tokenMatches } from './estate.js';
import { devopsAllows, requireDevops } from './middleware/auth.js';

export const SNAPSHOT_KEY = 'snapshot.json.gz';
export const RECEIPT_KEY = 'receipt.json';

/** Caps (design §5.3). Each is its own fuse; none replaces another. */
export const SNIPPET_CHARS = 400;
export const DEFAULT_HITS = 8;
/** Door A is a browser page a person scrolls, so it may ask for more than
 *  GABI's 8 — but never unbounded, and never more sections than one screenful
 *  of judgement. GABI's tool keeps the default. */
export const MAX_HITS = 25;
/** The publisher GUARANTEES this ceiling by splitting, so nothing is truncated
 *  here. The check below is a belt-and-braces assertion, not a trimmer. */
export const SECTION_MAX_BYTES = 8 * 1024;

/**
 * ⚠️ Reasoned threshold, not measured. The publisher rides an 8-hourly
 * pipeline, so 72 hours is roughly nine consecutive missed cycles — well past
 * noise, and short enough that a paused pipeline is noticed within a working
 * day or two rather than a fortnight.
 */
export const STALE_AFTER_HOURS = 72;

/**
 * The four refusal sentences of design §4.5, in one place.
 *
 * ⚠️ Only two of the four are reachable through DOOR A (a browser has either a
 * verified token or none). The other two are Discord's, and they are written
 * here anyway, deliberately: phase 3/4 must reuse this copy rather than author
 * a fifth wording of the same refusal. Four causes, four sentences, because
 * the FIXES differ — and the last one is the one that gets mislabelled.
 */
export const DOCS_REFUSALS = {
  unauthenticated:
    "The estate docs are devops-only, so I need to know who you are first. Sign in and try again.",
  not_devops:
    "The estate docs are limited to devops-class members, and your account isn’t one. Ask an approver in /admin if you need it — that’s a deliberate line, not a glitch.",
  not_linked:
    "I can’t tell who you are on the estate yet — the docs are devops-only, so I need the link first. Run /link and try me again.",
  link_has_no_email:
    "Your link was made before I could check estate roles. Re-run /link once and I’ll be able to answer this.",
  estate_unreachable:
    "I couldn’t reach the estate to check your access — that’s a problem on our side, not your permissions. Try again in a minute.",
} as const;

// ---------------------------------------------------------------------------
// The bundle
// ---------------------------------------------------------------------------

export interface DocSection {
  i: number;
  heading: string;
  level: number;
  bytes: number;
  text: string;
}

export interface DocFile {
  repo: string;
  path: string;
  title: string;
  bytes: number;
  sections: DocSection[];
}

export interface DocsBundle {
  schema: number;
  generated_at: string;
  corpus: { files: number; bytes: number; sections: number };
  git: Record<string, string>;
  files: DocFile[];
}

/** The narrow surface these routes need off R2Bucket — narrow on purpose so a
 *  fake in tests never implements more than this. */
export interface DocsBucket {
  get(key: string): Promise<{ body: ReadableStream | null; etag?: string } | null>;
  head?(key: string): Promise<{ etag?: string } | null>;
}

interface CacheEntry {
  bundle: DocsBundle;
  etag: string | undefined;
  loadedAtMs: number;
}

/**
 * ⚠️ MODULE SCOPE, ON PURPOSE — one fetch per isolate, not one per request.
 * A 1.2 MB R2 GET plus a gunzip plus a JSON.parse on every question would be
 * absurd, and the platform's 50-subrequest ceiling (application map §4.4) is
 * real. The revalidation below is the one deliberate departure from the
 * design's flat "once per isolate": after REVALIDATE_AFTER_MS a cheap `head()`
 * compares etags and only a CHANGED etag pays for a re-download. Without it a
 * long-lived isolate serves a snapshot that the staleness warning would call
 * fresh — the warning would be reporting the publisher's clock while the
 * reader saw the isolate's, which is the silent-staleness trap in a new hat.
 */
let CACHE: CacheEntry | null = null;
export const REVALIDATE_AFTER_MS = 5 * 60_000;

/** Test seam: drop the module-scope cache. */
export function __resetDocsCache(): void {
  CACHE = null;
}

export class DocsStoreError extends Error {
  constructor(readonly code: 'snapshot_absent' | 'snapshot_unreadable', message: string) {
    super(message);
  }
}

export async function loadBundle(bucket: DocsBucket, nowMs: number): Promise<DocsBundle> {
  if (CACHE && nowMs - CACHE.loadedAtMs < REVALIDATE_AFTER_MS) return CACHE.bundle;

  if (CACHE && bucket.head) {
    // Cheap: one HEAD, no body. An unchanged etag renews the lease and costs
    // nothing else.
    try {
      const head = await bucket.head(SNAPSHOT_KEY);
      if (head && head.etag && head.etag === CACHE.etag) {
        CACHE = { ...CACHE, loadedAtMs: nowMs };
        return CACHE.bundle;
      }
    } catch {
      // A failed HEAD is not evidence of anything — fall through to the GET.
    }
  }

  const obj = await bucket.get(SNAPSHOT_KEY);
  if (!obj || !obj.body) {
    throw new DocsStoreError(
      'snapshot_absent',
      'The docs snapshot has not been published yet — run the publisher on the home machine.',
    );
  }

  let bundle: DocsBundle;
  try {
    const stream = obj.body.pipeThrough(new DecompressionStream('gzip'));
    bundle = (await new Response(stream).json()) as DocsBundle;
  } catch (err) {
    throw new DocsStoreError(
      'snapshot_unreadable',
      `The published snapshot could not be decompressed or parsed: ${(err as Error).message}`,
    );
  }
  if (!bundle || !Array.isArray(bundle.files)) {
    throw new DocsStoreError('snapshot_unreadable', 'The published snapshot has no file list.');
  }

  CACHE = { bundle, etag: obj.etag, loadedAtMs: nowMs };
  return bundle;
}

// ---------------------------------------------------------------------------
// Snapshot metadata — attached to EVERY answer
// ---------------------------------------------------------------------------

export interface SnapshotMeta {
  generated_at: string;
  age_hours: number | null;
  stale: boolean;
  files: number;
  sections: number;
  /** ⚠️ Present ONLY when stale, and worded — the model relays it verbatim, and
   *  a person reads it. A missing warning must be indistinguishable from a
   *  fresh snapshot, which is why this is undefined rather than empty. */
  warning?: string;
}

export function snapshotMeta(bundle: DocsBundle, nowMs: number): SnapshotMeta {
  const ms = Date.parse(bundle.generated_at);
  const ageHours = Number.isFinite(ms) ? (nowMs - ms) / 3600_000 : null;
  const stale = ageHours !== null && ageHours > STALE_AFTER_HOURS;
  const meta: SnapshotMeta = {
    generated_at: bundle.generated_at,
    age_hours: ageHours === null ? null : Math.round(ageHours * 10) / 10,
    stale,
    files: bundle.corpus?.files ?? bundle.files.length,
    sections: bundle.corpus?.sections ?? bundle.files.reduce((n, f) => n + f.sections.length, 0),
  };
  if (stale && ageHours !== null) {
    const days = Math.floor(ageHours / 24);
    meta.warning =
      `⚠️ This docs snapshot is ${days} day${days === 1 ? '' : 's'} old ` +
      `(published ${bundle.generated_at}), so anything changed since then won’t be in it.`;
  }
  return meta;
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export interface SearchHit {
  id: string;
  repo: string;
  path: string;
  title: string;
  heading: string;
  level: number;
  bytes: number;
  snippet: string;
  score: number;
}

/** `path#index` — human-readable on purpose, so a broken id is debuggable by
 *  reading it rather than by decoding it. Stable within a snapshot; a section
 *  that moves between publishes gets a new one, which is correct: it is a
 *  different section. */
export function sectionId(path: string, i: number): string {
  return `${path}#${i}`;
}

export function parseSectionId(id: string): { path: string; i: number } | null {
  const at = id.lastIndexOf('#');
  if (at <= 0) return null;
  const i = Number(id.slice(at + 1));
  if (!Number.isInteger(i) || i < 0) return null;
  return { path: id.slice(0, at), i };
}

/** Lowercased tokens, deduped, ≥2 chars, at most 8 — a query is a question,
 *  not a payload, and an unbounded token list is an unbounded scan. */
export function tokenize(q: string): string[] {
  const seen = new Set<string>();
  for (const raw of q.toLowerCase().split(/[^a-z0-9_./-]+/)) {
    const t = raw.trim();
    if (t.length >= 2 && !seen.has(t)) seen.add(t);
    if (seen.size >= 8) break;
  }
  return [...seen];
}

function countOccurrences(haystack: string, needle: string, cap = 5): number {
  let n = 0;
  let at = haystack.indexOf(needle);
  while (at !== -1 && n < cap) {
    n += 1;
    at = haystack.indexOf(needle, at + needle.length);
  }
  return n;
}

/**
 * Build a snippet centred on the first token hit, clipped to SNIPPET_CHARS and
 * nudged to word boundaries. Returns PLAIN TEXT — never HTML. The page
 * highlights client-side from `terms`, which is the escaping boundary: markup
 * assembled here would have to be trusted by every consumer, including a
 * Discord message where it would render as literal tags.
 */
export function makeSnippet(text: string, tokens: string[]): string {
  const lower = text.toLowerCase();
  let at = -1;
  for (const t of tokens) {
    const found = lower.indexOf(t);
    if (found !== -1 && (at === -1 || found < at)) at = found;
  }
  if (at === -1) at = 0;

  let start = Math.max(0, at - Math.floor(SNIPPET_CHARS / 3));
  let end = Math.min(text.length, start + SNIPPET_CHARS);
  if (start > 0) {
    const sp = text.indexOf(' ', start);
    if (sp !== -1 && sp < start + 30) start = sp + 1;
  }
  if (end < text.length) {
    const sp = text.lastIndexOf(' ', end);
    if (sp > start + SNIPPET_CHARS - 60) end = sp;
  }
  const body = text.slice(start, end).replace(/\s+/g, ' ').trim();
  return `${start > 0 ? '…' : ''}${body}${end < text.length ? '…' : ''}`;
}

/**
 * A section's text WITHOUT its own heading line.
 *
 * ⚠️ Seen live on /docs (2026-08-18) and worth a route change: every snippet
 * opened by repeating the heading that was already rendered in bold directly
 * above it — with its raw `###` markers still attached — so the first line of
 * every result was noise, and the 400 characters bought roughly 340 of actual
 * document. Dropped only when the first line genuinely IS the heading the
 * publisher named, so a hard-split continuation ("… (cont. 3)", which carries
 * no heading line of its own) and a section whose first line happens to be a
 * different heading both keep their text untouched.
 *
 * Scoring still runs over the FULL text — a heading match must still count as
 * a heading match. This only changes what the reader is shown.
 */
export function sectionBody(section: DocSection): string {
  const nl = section.text.indexOf('\n');
  const first = (nl === -1 ? section.text : section.text.slice(0, nl)).trim();
  const m = /^#{1,6}\s+(.*?)\s*#*$/.exec(first);
  if (!m || (m[1] ?? '').trim() !== section.heading.trim()) return section.text;
  return nl === -1 ? '' : section.text.slice(nl + 1).replace(/^\s+/, '');
}

export interface SearchResult {
  hits: SearchHit[];
  /** 'all' = every token matched (the primary pass). 'any' = the fallback, so
   *  a caller can say "closest matches" rather than implying an exact answer. */
  matched: 'all' | 'any';
  /** Sections examined — the honest denominator behind `hits.length`. */
  scanned: number;
  total: number;
}

/**
 * Score by HEADING hits > PATH hits > TITLE hits > BODY hits, then return
 * SECTIONS, never files. Section-level is not a refinement — it is the whole
 * reason this works: the four largest documents in the corpus are 778 KB
 * between them, and a whole-file answer to one question would be tens of
 * thousands of tokens of archive.
 *
 * Two passes. The first requires EVERY token (precision, which is what a
 * person typing three words wants). Only if that finds nothing does the second
 * accept any token — and the result says which pass answered, so a caller
 * never presents a loose match as an exact one.
 */
export function searchBundle(bundle: DocsBundle, query: string, limit: number): SearchResult {
  const tokens = tokenize(query);
  let scanned = 0;

  const score = (
    file: DocFile,
    section: DocSection,
    require: 'all' | 'any',
  ): number => {
    const heading = section.heading.toLowerCase();
    const path = file.path.toLowerCase();
    const title = file.title.toLowerCase();
    const body = section.text.toLowerCase();

    let total = 0;
    let matchedTokens = 0;
    for (const t of tokens) {
      let s = 0;
      if (heading.includes(t)) s += 8;
      if (path.includes(t)) s += 4;
      if (title.includes(t)) s += 3;
      const inBody = countOccurrences(body, t);
      s += inBody;
      if (s > 0) matchedTokens += 1;
      total += s;
    }
    if (require === 'all' && matchedTokens < tokens.length) return 0;
    if (matchedTokens === 0) return 0;
    return total;
  };

  const run = (require: 'all' | 'any'): SearchHit[] => {
    const out: SearchHit[] = [];
    for (const file of bundle.files) {
      for (const section of file.sections) {
        if (require === 'all') scanned += 1;
        const s = score(file, section, require);
        if (s <= 0) continue;
        out.push({
          id: sectionId(file.path, section.i),
          repo: file.repo,
          path: file.path,
          title: file.title,
          heading: section.heading,
          level: section.level,
          bytes: section.bytes,
          // The heading is already rendered above the snippet by every
          // consumer — see sectionBody()'s header for why it is dropped here.
          snippet: makeSnippet(sectionBody(section) || section.text, tokens),
          score: s,
        });
      }
    }
    // Ties broken by path then section order, so identical queries answer
    // identically — a search that reshuffles equal hits looks broken.
    out.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path) || a.id.localeCompare(b.id));
    return out;
  };

  if (tokens.length === 0) return { hits: [], matched: 'all', scanned: 0, total: 0 };

  let all = run('all');
  let matched: 'all' | 'any' = 'all';
  if (all.length === 0 && tokens.length > 1) {
    all = run('any');
    matched = 'any';
  }
  return { hits: all.slice(0, limit), matched, scanned, total: all.length };
}

export function findSection(
  bundle: DocsBundle,
  path: string,
  index: number,
): { file: DocFile; section: DocSection } | null {
  const file = bundle.files.find((f) => f.path === path);
  if (!file) return null;
  const section = file.sections.find((s) => s.i === index);
  if (!section) return null;
  return { file, section };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * ⚠️ WORDS ON THE GATE'S REFUSALS, WITHOUT TOUCHING THE GATE.
 *
 * `requireDevops()` is the estate's shared security decision and this feature
 * deliberately does not fork, wrap or weaken it (design §4.1: "nothing new,
 * nothing weaker"). But its 401 body is `{error:'unauthenticated'}` with no
 * sentence, and the estate's standing rule is that a person never sees a bare
 * status: every refusal must say what happened, what it needs, and how to get
 * it. So this middleware runs BEFORE the gate, awaits it, and — only when the
 * gate refused and left no `detail` — re-writes the body with the matching
 * sentence from DOCS_REFUSALS. It adds a field; it never changes a status,
 * never turns a refusal into an allow, and cannot run at all on a 200.
 */
function wordTheRefusal(): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
    await next();
    const status = c.res.status;
    if (status !== 401 && status !== 403) return;
    let body: Record<string, unknown>;
    try {
      body = (await c.res.clone().json()) as Record<string, unknown>;
    } catch {
      return;
    }
    if (typeof body.detail === 'string' && body.detail.length > 0) return;
    body.detail =
      status === 401 ? DOCS_REFUSALS.unauthenticated : DOCS_REFUSALS.not_devops;
    c.res = new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json; charset=UTF-8' },
    });
  };
}

/**
 * ⚠️ **DOOR B — the header that carries the asker's PROVEN email.**
 *
 * Lowercase by convention (HTTP headers are case-insensitive; Hono lowercases
 * on lookup). Named as a header rather than a query parameter or a body field
 * on purpose: it must not land in an access log's URL, and the docs routes are
 * GETs whose query string is the QUESTION, which is a different kind of thing
 * from an identity.
 */
export const ON_BEHALF_OF_HEADER = 'x-estate-on-behalf-of';

/**
 * ⚠️ **THE TWO DOORS ONTO THE SAME ROUTES (design §4.3), and the reason this is
 * one middleware rather than two mounted routers.**
 *
 * | Door | Caller | Proof |
 * |---|---|---|
 * | **A — site** | a signed-in browser on `heygabi.ai/docs/` | Firebase ID token |
 * | **B — Discord** | `apps/discord-worker`, on a linked asker's behalf | `ESTATE_APP_TOKEN_DISCORD_DOCS` **plus** `X-Estate-On-Behalf-Of` |
 *
 * ⚠️ **BOTH DOORS END AT THE SAME PREDICATE.** Door A runs `requireDevops()`;
 * door B resolves the asserted email against the directory and calls
 * `devopsAllows(row, isOwner)` — the *same* exported function that middleware
 * uses. There is no second copy of the decision and no weaker variant, which is
 * what keeps design §4.1's promise ("nothing new, nothing weaker") and what
 * makes revoking someone's devops in `/admin` shut both doors at once.
 *
 * ⚠️ **DOOR B IS TRIED FIRST, AND ONLY EXISTS WHEN THE SECRET IS SET.** With
 * `ESTATE_APP_TOKEN_DISCORD_DOCS` unset no comparison happens at all and every
 * request falls through to door A — the ships-dark state, and the state this
 * Worker was in before phase 3. A bearer that is neither the app token nor a
 * valid Firebase token falls through to door A and is refused there with the
 * worded 401, so a wrong guess learns nothing about which door it missed.
 *
 * ⚠️ **THE TRUST BOUNDARY, STATED PLAINLY BECAUSE IT IS THE WHOLE DESIGN.** The
 * holder of the app token can name ANY email and this Worker will answer for
 * that person's standing. That is deliberate (design §4.4) and it is safe only
 * because of what sits on the other end: the discord-worker can send exactly one
 * email — the one `link.ts` proved server-side, through the person's own Discord
 * OAuth *and* their own Firebase sign-in, and persisted on the
 * `discord_links/{id}` document. ⚠️ **A future caller must never pass a
 * user-supplied string here.** If a second consumer ever needs door B, it gets
 * its own token pair and its own review of how it proves an email — not a copy
 * of this one.
 *
 * ⚠️ **NO `actor` IS SET AND NO ROW IS MATERIALIZED.** `requireDevops()`
 * materializes a row for an OWNER_EMAILS caller who has none, so `decided_by`
 * has an id to stamp. Nothing in these three read-only handlers reads
 * `c.get('actor')`, and a Discord docs question is not a reason to write a row
 * into the directory — a read must not have a write as a side effect.
 */
function docsGate(): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
    const appToken = c.env.ESTATE_APP_TOKEN_DISCORD_DOCS;
    if (!appToken || !(await tokenMatches(c.req.header('authorization'), appToken))) {
      // Not door B. Door A owns this request, whole.
      return requireDevops()(c, next);
    }

    const email = (c.req.header(ON_BEHALF_OF_HEADER) ?? '').trim().toLowerCase();
    if (email.length < 3 || email.length > 320 || !email.includes('@')) {
      // ⚠️ The bot proved it is the bot but named nobody. In practice that is a
      // PRE-UPGRADE LINK — a `discord_links` document written before `link.ts`
      // persisted the email — which is why this reuses the relink sentence
      // rather than inventing a fifth wording. It is 400 rather than 401: the
      // caller authenticated fine, the request is incomplete.
      return c.json({ error: 'no_proven_email', detail: DOCS_REFUSALS.link_has_no_email }, 400);
    }

    let row: EstateUserRow | null;
    try {
      row = await getUserByEmail(c.env.DB, email);
    } catch (err) {
      // ⚠️ D1 did not answer. That is an OUTAGE and is worded as one — calling
      // it a permission failure sends the owner hunting for a grant he already
      // holds, which is the exact mislabelling design §4.5's last row names.
      console.error('estate docs door B: directory read failed:', (err as Error).message);
      return c.json({ error: 'directory_unreachable', detail: DOCS_REFUSALS.estate_unreachable }, 503);
    }

    const isOwner = parseOwnerEmails(c.env.OWNER_EMAILS).includes(email);
    if (!devopsAllows(row, isOwner)) {
      return c.json({ error: 'forbidden', detail: DOCS_REFUSALS.not_devops }, 403);
    }

    // ⚠️ One line, no email and no token. The corpus's audience is narrower than
    // this log stream's, and an access log that names who asked what about the
    // estate's runbooks is a second copy of the thing the gate protects.
    console.log(JSON.stringify({ evt: 'estate_docs_door_b', route: c.req.path, at: new Date().toISOString() }));
    await next();
  };
}

/** Resolve the bucket, or the WORDED config failure. Never lets "our setup is
 *  wrong" and "you may not read this" wear the same clothes — the
 *  app_tokens_unset idiom every other route in this Worker uses. */
function resolveBucket(
  c: Parameters<MiddlewareHandler<AppBindings>>[0],
): { bucket: DocsBucket } | { response: Response } {
  const bucket = c.env.ESTATE_DOCS as unknown as DocsBucket | undefined;
  if (!bucket) {
    return {
      response: c.json(
        {
          error: 'docs_store_unbound',
          detail:
            'The estate docs store is not wired up on this Worker — that is our configuration, not your access.',
          fix: 'add the ESTATE_DOCS r2_buckets binding (bucket estate-docs-gated)',
        },
        503,
      ),
    };
  }
  return { bucket };
}

function storeErrorResponse(c: Parameters<MiddlewareHandler<AppBindings>>[0], err: unknown) {
  if (err instanceof DocsStoreError) {
    return c.json(
      {
        error: err.code,
        detail:
          err.code === 'snapshot_absent'
            ? 'No docs snapshot has been published yet, so there is nothing to search. Run the publisher on the home machine (python -m scripts.publish_docs_snapshot).'
            : `${err.message} The previous snapshot, if any, is what is serving.`,
      },
      503,
    );
  }
  // ⚠️ An unreachable bucket is an OUTAGE, not a permission failure. Labelling
  // it one sends the owner hunting for a grant he already holds.
  return c.json(
    {
      error: 'docs_store_unreachable',
      detail:
        'The docs store did not answer — that is a problem on our side, not your permissions. Try again in a minute.',
    },
    502,
  );
}

export const estateDocsRoutes = new Hono<AppBindings>();

estateDocsRoutes.get('/estate/docs/search', wordTheRefusal(), docsGate(), async (c) => {
  const resolved = resolveBucket(c);
  if ('response' in resolved) return resolved.response;
  const bucket = resolved.bucket;

  const q = (c.req.query('q') ?? '').trim();
  const limitRaw = Number(c.req.query('limit') ?? DEFAULT_HITS);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(1, Math.floor(limitRaw)), MAX_HITS) : DEFAULT_HITS;

  let bundle: DocsBundle;
  try {
    bundle = await loadBundle(bucket, Date.now());
  } catch (err) {
    return storeErrorResponse(c, err);
  }

  const snapshot = snapshotMeta(bundle, Date.now());

  if (q.length === 0) {
    // ⚠️ 200, NOT 400 — an empty query is the STARTING STATE, not a mistake.
    // Found live on the first signed-in run of /docs (2026-08-18): the page
    // had no snapshot date to show until someone typed, so its own footer
    // ("anything written since the date above…") referred to a date that was
    // not on screen. This is the one cheap call that primes it, and it doubles
    // as the earliest possible moment a non-devops visitor can be told so —
    // before, the gate only spoke after they had typed into a box that
    // silently did nothing.
    return c.json({
      ok: true,
      snapshot,
      query: '',
      terms: [],
      matched: 'all',
      empty_query: true,
      count: 0,
      total: 0,
      results: [],
      detail: 'Type something and I’ll search the estate’s docs section by section.',
    });
  }

  const result = searchBundle(bundle, q, limit);
  return c.json({
    ok: true,
    snapshot,
    query: q,
    terms: tokenize(q),
    matched: result.matched,
    count: result.hits.length,
    total: result.total,
    results: result.hits,
    // ⚠️ ABSENCE IS REPORTED AS ABSENCE. "Nothing in the snapshot" is a real
    // answer and must never be dressed up, or answered from general knowledge.
    // Same rule /have already carries for the catalogue.
    detail:
      result.hits.length === 0
        ? 'I don’t have anything on that in the docs snapshot — that means it is not in the estate’s docs, not that it is not true.'
        : undefined,
  });
});

estateDocsRoutes.get('/estate/docs/section', wordTheRefusal(), docsGate(), async (c) => {
  const resolved = resolveBucket(c);
  if ('response' in resolved) return resolved.response;
  const bucket = resolved.bucket;

  let bundle: DocsBundle;
  try {
    bundle = await loadBundle(bucket, Date.now());
  } catch (err) {
    return storeErrorResponse(c, err);
  }
  const snapshot = snapshotMeta(bundle, Date.now());

  const id = c.req.query('id');
  const path = c.req.query('path');
  const heading = c.req.query('heading');

  let found: { file: DocFile; section: DocSection } | null = null;

  if (id) {
    const parsed = parseSectionId(id);
    if (!parsed) {
      return c.json({ error: 'bad_section_id', detail: 'A section id looks like `<repo>/docs/<file>.md#<n>`.', snapshot }, 400);
    }
    found = findSection(bundle, parsed.path, parsed.i);
  } else if (path) {
    const file = bundle.files.find((f) => f.path === path);
    if (file) {
      const section = heading
        ? file.sections.find((s) => s.heading.toLowerCase() === heading.toLowerCase())
        : file.sections[0];
      if (section) found = { file, section };
    }
  } else {
    return c.json(
      { error: 'no_target', detail: 'Name the section: either `id`, or `path` plus an optional `heading`.', snapshot },
      400,
    );
  }

  if (!found) {
    return c.json(
      {
        error: 'section_not_found',
        detail:
          'That section is not in this snapshot. It may have been renamed or removed since the id was issued — search again.',
        snapshot,
      },
      404,
    );
  }

  // The publisher guarantees the ceiling by splitting, so this should never
  // fire. If it does, the bundle was written by something that does not honour
  // the contract — say so rather than silently serving 300 KB.
  const oversized = found.section.bytes > SECTION_MAX_BYTES;

  return c.json({
    ok: true,
    snapshot,
    section: {
      id: sectionId(found.file.path, found.section.i),
      repo: found.file.repo,
      path: found.file.path,
      title: found.file.title,
      heading: found.section.heading,
      level: found.section.level,
      bytes: found.section.bytes,
      of_sections: found.file.sections.length,
      text: oversized ? found.section.text.slice(0, SECTION_MAX_BYTES) : found.section.text,
      truncated: oversized,
    },
  });
});

estateDocsRoutes.get('/estate/docs/receipt', wordTheRefusal(), docsGate(), async (c) => {
  const resolved = resolveBucket(c);
  if ('response' in resolved) return resolved.response;
  const bucket = resolved.bucket;

  let obj;
  try {
    obj = await bucket.get(RECEIPT_KEY);
  } catch (err) {
    return storeErrorResponse(c, err);
  }
  if (!obj || !obj.body) {
    return c.json(
      {
        error: 'receipt_absent',
        detail:
          'No receipt has been published yet. It is written alongside the snapshot — run the publisher on the home machine.',
      },
      503,
    );
  }
  let receipt: unknown;
  try {
    receipt = await new Response(obj.body).json();
  } catch (err) {
    return c.json(
      { error: 'receipt_unreadable', detail: `The receipt could not be parsed: ${(err as Error).message}` },
      502,
    );
  }
  // ⚠️ Returned WHOLE and only to a devops-class caller. It names every
  // included path — including audiobook_catalog's LOCAL-ONLY docs — which is
  // exactly what makes a directory allowlist auditable, and exactly why it
  // sits behind the same gate as the corpus itself.
  return c.json({ ok: true, receipt });
});
