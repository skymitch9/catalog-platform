/**
 * **THE RETRIEVAL CORE — pure, no bucket, no Hono, no env.**
 *
 * `docs/info/gabi-book-knowledge-design.md` phase 3. Everything here operates on
 * ONE book's chunk pack, in memory, and every rule below is the design's, with
 * the section that argues it named. `book-packs.ts` fetches; `book-routes.ts`
 * gates; this file decides which passages come back.
 *
 * ## ⚠️ THE FOUR MODES, AND WHY THEY ARE NOT ONE MODE WITH A SORT FLAG
 *
 * Design §6.2, measured in the 2026-08-18 pilot over Primal Hunter books 1–3:
 *
 * | mode | question shape | why relevance ranking cannot do it |
 * |---|---|---|
 * | `relevant` | "what happened when X" | — it is the workhorse (6/9 in the pilot) |
 * | `latest` | "current at the end of book N" | ⚠️ relevance returns the *best* stat block, which is usually an early-book baseline. "Current" means **last in reading order**, a different sort |
 * | `earliest` | "where does X **first** appear" | ⚠️ BM25 scores DENSITY of mentions, and a first appearance is by construction the LEAST dense one. The pilot ranked the true passage **34th–60th of 200** against a top-6 cap — a total miss at every chunk size. Lowest-`ord` returned it at rank 1 |
 * | `presence` | "is X in this book at all" | ⚠️ a different RETURN SHAPE, not a different sort. Top-K silently omitted the book where a character is introduced; a per-book roll-up answers it exactly |
 *
 * ⚠️ **`presence` returns counts and a first sighting, never passages.** That is
 * the point of it: it is the one question where "six good passages" is the wrong
 * data structure, and where **absence must be reportable as absence**.
 *
 * ## ⚠️ INDEX SMALL, RETURN WIDE (design §7.3 step 2, §7.3.1)
 *
 * Packs are chunked at 800/100 because that measured best on retrieval precision
 * (6/9 vs 4/9 top-3) and citation precision (27.5 s vs 102.2 s median error).
 * That setting alone leaves **1 stat sheet in 4 cut across a boundary** — so the
 * hit is returned STITCHED WITH ITS ±1 NEIGHBOURS (~2,160 chars), which scores
 * 100% block integrity while keeping both of the small-chunk wins. The stitch is
 * a retrieval-time behaviour on purpose: baking neighbours into stored chunks
 * would reintroduce everything the small chunks bought.
 *
 * ⚠️ **The stitch is CLAMPED TO THE CHAPTER** (design §7.3 step 3). A passage
 * that straddles a chapter boundary cannot be cited and cannot be scoped.
 *
 * ## ⚠️ ORD CEILINGS ARE DERIVED, NEVER STORED — the 28-chapter leak
 *
 * Design §4.3, and it bit the pilot on the first try. An `ord` is only meaningful
 * relative to the chunking that produced it: the same number **405** is "end of
 * chapter 32" at 1,500/200 and "chapter ~15" at 800/100. A ceiling carried across
 * a re-chunk **leaked twenty-eight chapters of book 2 past the reader's
 * position**, with no error anywhere and nothing in the answer looking wrong.
 *
 * So: nothing in this module accepts a ceiling it did not compute this turn from
 * a bound plus THIS pack's chapter table, nothing returns one for storage, and
 * `boundVersionRefusal()` refuses outright when a caller's bound was derived at a
 * different `ingester_version`. ⚠️ The failure direction is toward SPOILING and
 * it is silent, which is why the refusal is a hard error rather than a warning.
 */

/** One chunk, exactly as the ingester writes it (`app/core/book_chunker.py`). */
export interface PackChunk {
  ord: number;
  chapter_index: number;
  text: string;
  spine_index?: number;
  page?: number;
  start_sec?: number;
  end_sec?: number;
}

/** One chapter's span over the chunk array. */
export interface PackChapter {
  index: number;
  title: string;
  first_chunk: number;
  last_chunk: number;
  spine_index?: number;
  page?: number;
  start_sec?: number;
  end_sec?: number;
}

/** A chunk pack as stored at `text/{bookId}.json.gz` in `ebooks-gated`. */
export interface BookPack {
  book_id: string;
  title: string;
  source: string;
  ingested_at?: string;
  ingester_version: number;
  chunk_chars?: number;
  chunk_overlap?: number;
  text_bytes?: number;
  text_sha256?: string;
  chapters: PackChapter[];
  chunks: PackChunk[];
  notes?: string[];
  /** ⚠️ CANDIDATES with counts, per BOOK, transcripts only — never a decided
   *  mapping. `build_alias_map`'s own docstring refuses to decide that two
   *  spellings are the same name, because "Sylphian Ayas" → "Sylphie and Ayas"
   *  is a MEANING change, not a variant. This module uses them only to SUGGEST,
   *  and every suggestion it acts on is reported in the answer. */
  alias_candidates?: Record<string, number>;
}

export const RETRIEVAL_MODES = ['relevant', 'latest', 'earliest', 'presence'] as const;
export type RetrievalMode = (typeof RETRIEVAL_MODES)[number];

export function isRetrievalMode(v: unknown): v is RetrievalMode {
  return typeof v === 'string' && (RETRIEVAL_MODES as readonly string[]).includes(v);
}

// ---------------------------------------------------------------------------
// The caps — design §4.6. Each is its own fuse.
// ---------------------------------------------------------------------------

/** Passages one search may return. */
export const MAX_PASSAGES = 6;
/** One passage, in bytes. ⚠️ A stitched span is ~2,160 chars, so this is
 *  headroom rather than a routine trim — and it is enforced by DROPPING a
 *  neighbour, never by cutting text mid-sentence. A silently truncated passage
 *  is a plot point missing the sentence that mattered (design §4.6). */
export const MAX_PASSAGE_BYTES = 4 * 1024;
/** Retrieved bytes per turn — the budget the TOOL layer enforces, restated here
 *  so the route can refuse a single absurd request without a turn context. */
export const MAX_SEARCH_BYTES = 24 * 1024;

/** Spellings one count may look for, `q` included (design §4.3's
 *  `MAX_COUNT_VARIANTS`). ⚠️ Six because a transcript renders a catchphrase two
 *  or three ways at most; a longer list is a different question wearing this
 *  one's clothes. */
export const MAX_COUNT_VARIANTS = 6;
/** Example excerpts a count may carry. ⚠️ A count is not a way to read the book
 *  three hundred words at a time — three is enough to prove the matcher found
 *  what the asker meant. */
export const MAX_COUNT_QUOTES = 3;
/** One excerpt, in characters. */
export const MAX_QUOTE_CHARS = 400;
/** The serialised count answer, in bytes. ⚠️ The same idea as
 *  `MAX_SEARCH_BYTES` at a tenth the size, because a count is numbers: measured
 *  shapes are 1–2 KB. Over the cap, EXAMPLES are dropped before COUNTS are —
 *  the totals are the answer and the quotes are the evidence. */
export const MAX_COUNT_BYTES = 8 * 1024;

// ---------------------------------------------------------------------------
// ⚠️ THE SCOPE BOUND — derived per turn, from the QUESTION
// ---------------------------------------------------------------------------

/**
 * What the asker's question said about how far to look.
 *
 * ⚠️ **`unknown` IS NOT "no limit" — it is "we do not know", and the difference
 * is worded in the answer** (design §4.5: *"Absence of a position means UNKNOWN,
 * never 'unread' and never 'finished'"*). The retrieval still runs, because a
 * refusal to search would make a miss indistinguishable from a spoiler
 * boundary — but the result carries `bounded: false` and the sentence she has to
 * say, and the tool description makes saying it non-optional.
 *
 * ⚠️ **`through_ord` is the seam a reading position plugs into.** Nothing in this
 * build reads `readingPositions/{uid}_{bookId}`; when something does, it derives
 * an ord from `pos.kind` + value through THIS pack's chapter table and passes it
 * here. That is the only supported way an ord ceiling may exist, and it may not
 * be stored afterwards.
 */
export type ScopeBound =
  | { kind: 'whole_book' }
  | { kind: 'through_chapter'; chapter: number }
  | { kind: 'through_ord'; ord: number; ingesterVersion: number }
  | { kind: 'unknown' };

export interface DerivedScope {
  /** The inclusive `ord` ceiling, or null for "no ceiling applied". */
  ceiling: number | null;
  /** Whether a ceiling was actually asserted by the question. */
  bounded: boolean;
  /** How it was derived, for the answer's scope statement. */
  from: ScopeBound['kind'];
  /** The chapter the ceiling lands in, when there is one. */
  ceiling_chapter?: number;
  ceiling_chapter_title?: string;
  /** ⚠️ Present only when `bounded` is false — the sentence she must say. */
  ask?: string;
}

/** ⚠️ Design §4.5, row 2. The words matter: two people reading the same book get
 *  two different answers to the same question, and not knowing which is which is
 *  a thing to SAY, not to guess. */
export const SCOPE_UNKNOWN_ASK =
  "I don't have a bookmark for you in that one, so I don't know how far you've got — say if you've " +
  'finished it and I will speak freely, or tell me where you are and I will keep to it.';

/**
 * Turn a bound into an `ord` ceiling **against this pack**.
 *
 * ⚠️ Rounds DOWN, always (design §4.3): *"An answer that stops one chapter short
 * of where the reader is costs a follow-up question. An answer that runs one
 * chapter long costs them the book."*
 */
export function deriveCeiling(pack: BookPack, bound: ScopeBound): DerivedScope {
  switch (bound.kind) {
    case 'whole_book':
      return { ceiling: null, bounded: true, from: 'whole_book' };

    case 'through_chapter': {
      // ⚠️ Clamp, never extrapolate. A chapter number past the end of the book
      // is a question about a book the asker is misremembering, and answering it
      // as "the whole book" would be the spoiling direction.
      const chapters = pack.chapters;
      if (chapters.length === 0) {
        return { ceiling: -1, bounded: true, from: 'through_chapter' };
      }
      const wanted = bound.chapter;
      let chosen: PackChapter | null = null;
      for (const ch of chapters) {
        if (ch.index <= wanted && (!chosen || ch.index > chosen.index)) chosen = ch;
      }
      if (!chosen) {
        // Every chapter is past the bound — the ceiling is "nothing".
        return { ceiling: -1, bounded: true, from: 'through_chapter' };
      }
      return {
        ceiling: chosen.last_chunk,
        bounded: true,
        from: 'through_chapter',
        ceiling_chapter: chosen.index,
        ceiling_chapter_title: chosen.title,
      };
    }

    case 'through_ord': {
      const ord = Math.max(-1, Math.floor(bound.ord));
      const chapter = chapterOf(pack, ord);
      return {
        ceiling: ord,
        bounded: true,
        from: 'through_ord',
        ...(chapter
          ? { ceiling_chapter: chapter.index, ceiling_chapter_title: chapter.title }
          : {}),
      };
    }

    case 'unknown':
      return { ceiling: null, bounded: false, from: 'unknown', ask: SCOPE_UNKNOWN_ASK };
  }
}

/**
 * ⚠️ **THE VERSION REFUSAL — design §4.3 and §7.5.**
 *
 * An `ord` bound derived against one `ingester_version` and applied to a pack at
 * another is the 28-chapter leak, exactly. It produces no error and nothing in
 * the answer looks wrong, so it is refused here rather than warned about.
 * Returns the worded reason, or `null` when the pair is safe to use together.
 */
export function boundVersionRefusal(pack: BookPack, bound: ScopeBound): string | null {
  if (bound.kind !== 'through_ord') return null;
  if (bound.ingesterVersion === pack.ingester_version) return null;
  return (
    `That bookmark was made against version ${bound.ingesterVersion} of how this book was chunked, ` +
    `and the copy I have is version ${pack.ingester_version}. The same number means a different place ` +
    'in the two, so using them together could show you far more of the book than you have read. ' +
    'Open the book once and I will pick your place up again.'
  );
}

/** Which chapter an ord falls in. Linear — chapter counts are in the dozens. */
export function chapterOf(pack: BookPack, ord: number): PackChapter | null {
  for (const ch of pack.chapters) {
    if (ord >= ch.first_chunk && ord <= ch.last_chunk) return ch;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Tokenising and scoring
// ---------------------------------------------------------------------------

/** ⚠️ Deliberately tiny. A big stopword list drops "who", "how" and "first",
 *  each of which is a real query term in a book question. */
const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'do', 'does', 'for', 'from', 'had', 'has',
  'have', 'i', 'in', 'is', 'it', 'its', 'of', 'on', 'or', 'that', 'the', 'their', 'them', 'they',
  'this', 'to', 'was', 'were', 'what', 'when', 'with', 'you', 'your',
]);

const TOKEN_RE = /[a-z0-9][a-z0-9'’-]*/g;

export function tokenise(text: string): string[] {
  const out: string[] = [];
  const lowered = text.toLowerCase();
  let m: RegExpExecArray | null;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(lowered)) !== null) {
    // ⚠️ The possessive is stripped, because "Jake's stat sheet" and "Jake" are
    // the same term to a reader and two different rare terms to BM25 — and the
    // possessive form is the one a question uses while the book uses the plain.
    const t = m[0].replace(/['’]s$/, '').replace(/['’-]+$/, '');
    if (t.length >= 2) out.push(t);
  }
  return out;
}

/** Query terms: tokenised, stopwords dropped, de-duplicated, order preserved.
 *  ⚠️ If EVERY term is a stopword the query survives as its raw tokens rather
 *  than becoming empty — "who is he" must not silently match the whole book. */
export function queryTerms(query: string): string[] {
  const all = tokenise(query);
  const kept = all.filter((t) => !STOPWORDS.has(t));
  const source = kept.length > 0 ? kept : all;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of source) {
    if (!seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out.slice(0, 24);
}

/**
 * ⚠️ **ALIAS EXPANSION IS A SUGGESTION THAT GETS REPORTED, NEVER A SILENT
 * REWRITE** (design §6.4). Whisper renders *Thayne* as `Thane` in all 43
 * mentions across books 1–3, so a query for the printed spelling finds nothing
 * in a transcript — and the honest fix is to look for the book's OWN spellings,
 * say which ones were used, and let the answer name them.
 *
 * Only candidates with a **prefix agreement of 4 characters and an edit distance
 * of 1 or 2** are offered, and only for query terms of 4+ characters. That is
 * narrow on purpose: `Villy`/`Vili`/`Villi`/`Willy` are the class this catches,
 * and a looser rule starts matching different characters' names to each other.
 */
export function aliasExpansions(
  terms: string[],
  aliasCandidates: Record<string, number> | undefined,
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  if (!aliasCandidates) return out;
  const names = Object.keys(aliasCandidates);
  if (names.length === 0) return out;
  for (const term of terms) {
    if (term.length < 4) continue;
    const matches: string[] = [];
    for (const name of names) {
      const lower = name.toLowerCase();
      if (lower === term) continue;
      if (Math.abs(lower.length - term.length) > 2) continue;
      if (lower.slice(0, 3) !== term.slice(0, 3)) continue;
      const d = editDistance(lower, term, 2);
      if (d >= 1 && d <= 2) matches.push(lower);
    }
    if (matches.length > 0) {
      matches.sort((a, b) => (aliasCandidates[cap(b)] ?? 0) - (aliasCandidates[cap(a)] ?? 0));
      out.set(term, matches.slice(0, 4));
    }
  }
  return out;
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Bounded Levenshtein — returns `max + 1` once it is certain the distance
 *  exceeds `max`, so a long candidate list stays cheap. */
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = new Array<number>(b.length + 1).fill(0);
  let curr = new Array<number>(b.length + 1).fill(0);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min((prev[j] ?? 0) + 1, (curr[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
      curr[j] = value;
      if (value < best) best = value;
    }
    if (best > max) return max + 1;
    const swap = prev;
    prev = curr;
    curr = swap;
  }
  return prev[b.length] ?? max + 1;
}

/** ⚠️ The stat-key family, in BOTH renderings — design §6.2 step ③ for print and
 *  §6.4's measured correction for speech. A transcript states a sheet as a flat
 *  comma-separated run (*"Stats. Strength, 7. Agility, 8."*), which the anchored
 *  `^Key:` form matches not at all; the speech-tolerant form found 22 candidate
 *  blocks in book 1 with zero tuning. Both are tried and the better count wins. */
export const STAT_KEYS = [
  'name', 'race', 'class', 'level', 'profession', 'title', 'health', 'stamina', 'mana',
  'strength', 'agility', 'perception', 'willpower', 'wisdom', 'intelligence', 'endurance',
  'toughness', 'vitality', 'free points',
] as const;

const STAT_LINE_RE = new RegExp(
  `^\\s*(${STAT_KEYS.join('|')})\\s*[:\\-–]`,
  'gim',
);
const STAT_SPOKEN_RE = new RegExp(
  `\\b(${STAT_KEYS.join('|')})\\b[\\s,.:;–-]{0,4}(\\d+)`,
  'gi',
);

/** How many DISTINCT stat keys this chunk states with a value. ⚠️ Distinct keys,
 *  not total matches — a paragraph that says "level" four times is prose, and a
 *  block that says nine different keys once each is a stat sheet. */
export function statKeyCount(text: string): number {
  const seen = new Set<string>();
  STAT_LINE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = STAT_LINE_RE.exec(text)) !== null) seen.add((m[1] ?? '').toLowerCase());
  const anchored = seen.size;
  seen.clear();
  STAT_SPOKEN_RE.lastIndex = 0;
  while ((m = STAT_SPOKEN_RE.exec(text)) !== null) seen.add((m[1] ?? '').toLowerCase());
  return Math.max(anchored, seen.size);
}

/** A chunk carrying this many distinct keys is a candidate sheet. Four is the
 *  floor the pilot's weakest true block cleared; the strongest carried eleven. */
export const STAT_BLOCK_MIN_KEYS = 4;

const STAT_QUERY_RE =
  /\b(stat|stats|statsheet|stat[-\s]?sheet|status[-\s]?screen|attributes?|character\s+sheet)\b/i;

/** ⚠️ Deterministic, server-side, from the QUESTION — never a model's choice.
 *  "What's Jake's stat sheet at the end of book 1" is a stat-block question and
 *  the detector is what makes §6.2's step ④ work. */
export function looksLikeStatQuestion(query: string): boolean {
  return STAT_QUERY_RE.test(query);
}

interface ScoredChunk {
  chunk: PackChunk;
  score: number;
  /** How many DISTINCT query terms this chunk contains. The `latest`/`earliest`
   *  candidate filter is built on this rather than on the BM25 score, because
   *  those two modes must not inherit BM25's density preference. */
  coverage: number;
  statKeys: number;
}

/** BM25 over one book's chunks. k1/b are the standard defaults; the corpus is a
 *  single book, so no tuning was possible and none is claimed. */
function scoreChunks(
  chunks: PackChunk[],
  terms: string[],
  variants: Map<string, string[]>,
  phrase: string | null,
): ScoredChunk[] {
  const k1 = 1.2;
  const b = 0.75;
  const n = chunks.length;
  if (n === 0) return [];

  const tokenised = chunks.map((c) => tokenise(c.text));
  const lengths = tokenised.map((t) => t.length);
  const avgLen = lengths.reduce((a, x) => a + x, 0) / n || 1;

  // Term → the set of surface forms that count as it (itself plus any alias
  // variants). ⚠️ A variant contributes to the SAME term's tf, so a name split
  // four ways across a transcript does not look like four rare terms.
  const forms = terms.map((t) => [t, ...(variants.get(t) ?? [])]);

  const docFreq = terms.map(() => 0);
  const tfs: number[][] = tokenised.map((toks) => {
    const counts = new Map<string, number>();
    for (const tok of toks) counts.set(tok, (counts.get(tok) ?? 0) + 1);
    return forms.map((fs, i) => {
      let tf = 0;
      for (const f of fs) tf += counts.get(f) ?? 0;
      if (tf > 0) docFreq[i] = (docFreq[i] ?? 0) + 1;
      return tf;
    });
  });

  const idf = docFreq.map((df) => Math.log(1 + (n - df + 0.5) / (df + 0.5)));

  return chunks.map((chunk, i) => {
    let score = 0;
    let coverage = 0;
    const row = tfs[i] ?? [];
    const len = lengths[i] ?? 0;
    for (let t = 0; t < terms.length; t++) {
      const tf = row[t] ?? 0;
      if (tf <= 0) continue;
      coverage += 1;
      const norm = (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (len / avgLen)));
      score += (idf[t] ?? 0) * norm;
    }
    // ⚠️ A literal phrase hit outranks any amount of term density. The design
    // makes lexical the PRIMARY path precisely because stat blocks, item names
    // and titles are exact strings (§3.2 reason 2).
    if (phrase && chunk.text.toLowerCase().includes(phrase)) score += 6;
    return { chunk, score, coverage, statKeys: statKeyCount(chunk.text) };
  });
}

// ---------------------------------------------------------------------------
// Stitching
// ---------------------------------------------------------------------------

/** Join two overlapping chunk texts, removing the duplicated tail/head. The
 *  ingester overlaps by ~100 characters; 300 is generous headroom. */
export function deOverlap(a: string, b: string): string {
  const max = Math.min(a.length, b.length, 300);
  for (let k = max; k >= 12; k--) {
    if (a.endsWith(b.slice(0, k))) return a + b.slice(k);
  }
  return `${a} ${b}`;
}

export interface Passage {
  /** The `ord` of the MATCHED chunk — the citation coordinate, not the span's start. */
  ord: number;
  /** The span actually returned, for anyone who wants to re-read it exactly. */
  ord_span: [number, number];
  chapter_index: number;
  chapter_title: string;
  /** Present only for audio-derived packs. ⚠️ Cited at the span's START, which
   *  is early by ~27.5 s at this chunk size (design §7.3.1 (c)). */
  start_sec?: number;
  end_sec?: number;
  text: string;
  bytes: number;
  /** `full` = the hit plus both neighbours; `reduced` = a neighbour was dropped
   *  by the chapter clamp or the byte cap, and saying which is not decoration —
   *  a reduced span is the case where a stat block may be missing its header. */
  stitch: 'full' | 'reduced';
  score: number;
  stat_keys: number;
}

/** Stitch one hit with its ±1 neighbours, clamped to its chapter and to the
 *  per-passage byte cap. ⚠️ Whole chunks only — a passage is never cut mid-text. */
export function stitchPassage(pack: BookPack, ord: number): Passage | null {
  const byOrd = new Map(pack.chunks.map((c) => [c.ord, c]));
  const hit = byOrd.get(ord);
  if (!hit) return null;
  const chapter = chapterOf(pack, ord);
  const lo = chapter ? chapter.first_chunk : ord;
  const hi = chapter ? chapter.last_chunk : ord;

  const wanted: number[] = [];
  if (ord - 1 >= lo) wanted.push(ord - 1);
  wanted.push(ord);
  if (ord + 1 <= hi) wanted.push(ord + 1);

  let span = wanted;
  let text = joinOrds(byOrd, span);
  let stitch: 'full' | 'reduced' = span.length === 3 ? 'full' : 'reduced';

  // ⚠️ Drop neighbours rather than cut text. The trailing one goes first: a stat
  // block's header sits ABOVE its numbers, so the leading neighbour is the one
  // worth keeping when only one fits.
  while (byteLength(text) > MAX_PASSAGE_BYTES && span.length > 1) {
    span = span[span.length - 1] === ord ? span.slice(1) : span.slice(0, -1);
    text = joinOrds(byOrd, span);
    stitch = 'reduced';
  }

  const spanFirst = span[0] ?? ord;
  const spanLast = span[span.length - 1] ?? ord;
  const firstChunk = byOrd.get(spanFirst);
  const lastChunk = byOrd.get(spanLast);
  return {
    ord,
    ord_span: [spanFirst, spanLast],
    chapter_index: hit.chapter_index,
    chapter_title: chapter?.title ?? '',
    ...(firstChunk?.start_sec !== undefined ? { start_sec: firstChunk.start_sec } : {}),
    ...(lastChunk?.end_sec !== undefined ? { end_sec: lastChunk.end_sec } : {}),
    text,
    bytes: byteLength(text),
    stitch,
    score: 0,
    stat_keys: statKeyCount(text),
  };
}

function joinOrds(byOrd: Map<number, PackChunk>, ords: number[]): string {
  let text = '';
  for (const o of ords) {
    const c = byOrd.get(o);
    if (!c) continue;
    text = text ? deOverlap(text, c.text) : c.text;
  }
  return text;
}

function byteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

// ---------------------------------------------------------------------------
// The search
// ---------------------------------------------------------------------------

export interface SearchOptions {
  query: string;
  mode: RetrievalMode;
  limit?: number;
  bound: ScopeBound;
  /** Force the stat-block detector on or off. Unset = derive it from the query. */
  statBlock?: boolean;
}

export interface SearchAnswer {
  ok: true;
  book_id: string;
  title: string;
  source: string;
  ingester_version: number;
  mode: RetrievalMode;
  query: string;
  terms: string[];
  /** ⚠️ Reported whenever an alias variant was searched for. The answer has to
   *  be able to say *"the recording says 'Thane'"* rather than quietly matching. */
  alias_expansions?: Record<string, string[]>;
  scope: DerivedScope & { chunks_visible: number; chunks_total: number };
  passages: Passage[];
  /** ⚠️ THE CONTRACT §6.3 CRITERION 6 IS BUILT ON THIS. Retrieval never returns
   *  nothing, so the model must be able to tell "the terms are here" from "the
   *  terms are absent and these are near-misses". */
  terms_found: string[];
  terms_missing: string[];
  /** True when the stat detector drove candidate selection. */
  stat_detector: boolean;
  bytes: number;
  /** Set when the detector or the mode is doing something the answer must state. */
  note?: string;
}

export interface PresenceAnswer {
  book_id: string;
  title: string;
  source: string;
  /** ⚠️ 0 is a REAL ANSWER and the most valuable one this mode gives. */
  chunk_hits: number;
  first_ord?: number;
  first_chapter?: number;
  first_chapter_title?: string;
  first_start_sec?: number;
  last_ord?: number;
  last_chapter?: number;
  /** Chunks the scope ceiling hid. ⚠️ Reported, because "absent" and "past where
   *  you are" are different facts and one of them is a spoiler boundary. */
  hidden_by_scope: number;
  terms_found: string[];
  terms_missing: string[];
  alias_expansions?: Record<string, string[]>;
}

/** ⚠️ The visible set — design §4.3's one comparison, applied BEFORE scoring so
 *  nothing past the ceiling can influence a rank, let alone be returned. */
function visibleChunks(pack: BookPack, ceiling: number | null): PackChunk[] {
  if (ceiling === null) return pack.chunks;
  return pack.chunks.filter((c) => c.ord <= ceiling);
}

export function searchPack(pack: BookPack, opts: SearchOptions): SearchAnswer {
  const mode = opts.mode;
  const limit = Math.min(Math.max(1, Math.floor(opts.limit ?? MAX_PASSAGES)), MAX_PASSAGES);
  const scope = deriveCeiling(pack, opts.bound);
  const visible = visibleChunks(pack, scope.ceiling);

  const terms = queryTerms(opts.query);
  const variants = aliasExpansions(terms, pack.alias_candidates);
  const phrase = phraseOf(opts.query);
  const statBlock = opts.statBlock ?? (looksLikeStatQuestion(opts.query) && mode !== 'presence');

  const scored = scoreChunks(visible, terms, variants, phrase);
  const found = new Set<string>();
  for (let i = 0; i < terms.length; i++) {
    const term = terms[i];
    if (term && scored.some((s) => chunkHasTerm(s, i, terms, variants))) found.add(term);
  }

  let selected: ScoredChunk[];
  let note: string | undefined;

  if (statBlock) {
    // ⚠️ §6.2 step ④, THE KEY INSIGHT: select by ORDINAL, not by score. Ordinary
    // relevance returns the most COMPLETE sheet, which is usually an early-book
    // baseline; "current at the end" means last in reading order.
    const blocks = scored.filter((s) => s.statKeys >= STAT_BLOCK_MIN_KEYS);
    if (blocks.length > 0) {
      const ordered = [...blocks].sort((a, b) =>
        mode === 'earliest' ? a.chunk.ord - b.chunk.ord : b.chunk.ord - a.chunk.ord,
      );
      selected = ordered.slice(0, limit);
      note =
        mode === 'earliest'
          ? `Selected by earliest position among ${blocks.length} candidate stat blocks, not by relevance.`
          : `Selected by LAST position among ${blocks.length} candidate stat blocks, not by relevance. ` +
            'If the last one is not at the literal end of the book, say so rather than implying finality.';
    } else {
      selected = topByScore(scored, limit);
      note =
        'No passage in scope carries enough distinct stat keys to be a stat sheet. Say that the ' +
        'sheet is not in what you can see rather than assembling one from prose.';
    }
  } else if (mode === 'latest' || mode === 'earliest') {
    selected = byOrdinal(scored, terms.length, limit, mode);
    note =
      mode === 'latest'
        ? 'Selected by LAST position in the book among the passages that match, not by relevance.'
        : // ⚠️ The pilot's headline miss: BM25 ranked a true first-meeting passage
          // 34th–60th of 200 because a first appearance is the least dense mention.
          'Selected by FIRST position in the book among the passages that match, not by relevance.';
  } else {
    selected = topByScore(scored, limit);
  }

  const passages: Passage[] = [];
  let bytes = 0;
  const taken: number[] = [];
  for (const s of selected) {
    // ⚠️ Adjacent hits produce OVERLAPPING stitched spans, and two passages that
    // are 90% the same text spend the turn's byte budget saying one thing twice.
    // Measured on the real book-1 pack: `latest` returned ord 1547 and 1546 as
    // its top two, whose ±1 spans share two of three chunks.
    if (taken.some((t) => Math.abs(t - s.chunk.ord) <= 2)) continue;
    const p = stitchPassage(pack, s.chunk.ord);
    if (!p) continue;
    // ⚠️ REFUSE rather than trim (design §4.6). Stopping short of the cap is an
    // honest short answer; a truncated passage is a lie about what was read.
    if (bytes + p.bytes > MAX_SEARCH_BYTES) break;
    p.score = Number(s.score.toFixed(4));
    passages.push(p);
    taken.push(s.chunk.ord);
    bytes += p.bytes;
  }

  const expansions = variantsRecord(variants);
  return {
    ok: true,
    book_id: pack.book_id,
    title: pack.title,
    source: pack.source,
    ingester_version: pack.ingester_version,
    mode,
    query: opts.query,
    terms,
    ...(expansions ? { alias_expansions: expansions } : {}),
    scope: { ...scope, chunks_visible: visible.length, chunks_total: pack.chunks.length },
    passages,
    terms_found: terms.filter((t) => found.has(t)),
    terms_missing: terms.filter((t) => !found.has(t)),
    stat_detector: statBlock,
    bytes,
    ...(note ? { note } : {}),
  };
}

/** The per-book roll-up. ⚠️ Counts and a first sighting — never passages. */
export function presenceInPack(
  pack: BookPack,
  query: string,
  bound: ScopeBound,
): PresenceAnswer {
  const scope = deriveCeiling(pack, bound);
  const visible = visibleChunks(pack, scope.ceiling);
  const terms = queryTerms(query);
  const variants = aliasExpansions(terms, pack.alias_candidates);
  const forms = terms.map((t) => new Set([t, ...(variants.get(t) ?? [])]));

  const found = new Set<string>();
  const hitOrds: number[] = [];
  for (const chunk of visible) {
    const toks = new Set(tokenise(chunk.text));
    let all = true;
    for (let i = 0; i < forms.length; i++) {
      let any = false;
      for (const f of forms[i] ?? []) {
        if (toks.has(f)) { any = true; break; }
      }
      const term = terms[i];
      if (any && term) found.add(term);
      if (!any) all = false;
    }
    // ⚠️ ALL terms, not any. "Which books mention Miranda" is one term; "does
    // Jake meet Casper" is two, and a chunk with only one of them is not a hit.
    if (all && forms.length > 0) hitOrds.push(chunk.ord);
  }

  let hiddenByScope = 0;
  if (scope.ceiling !== null) {
    for (const chunk of pack.chunks) {
      if (chunk.ord <= scope.ceiling) continue;
      const toks = new Set(tokenise(chunk.text));
      let all = true;
      for (const f of forms) {
        let any = false;
        for (const v of f) if (toks.has(v)) { any = true; break; }
        if (!any) { all = false; break; }
      }
      if (all && forms.length > 0) hiddenByScope += 1;
    }
  }

  const first = hitOrds.length > 0 ? hitOrds[0] : undefined;
  const last = hitOrds.length > 0 ? hitOrds[hitOrds.length - 1] : undefined;
  const firstChapter = first !== undefined ? chapterOf(pack, first) : null;
  const lastChapter = last !== undefined ? chapterOf(pack, last) : null;
  const firstChunk = first !== undefined ? pack.chunks.find((c) => c.ord === first) : undefined;
  const expansions = variantsRecord(variants);

  return {
    book_id: pack.book_id,
    title: pack.title,
    source: pack.source,
    chunk_hits: hitOrds.length,
    ...(first !== undefined ? { first_ord: first } : {}),
    ...(firstChapter ? { first_chapter: firstChapter.index, first_chapter_title: firstChapter.title } : {}),
    ...(firstChunk?.start_sec !== undefined ? { first_start_sec: firstChunk.start_sec } : {}),
    ...(last !== undefined ? { last_ord: last } : {}),
    ...(lastChapter ? { last_chapter: lastChapter.index } : {}),
    hidden_by_scope: hiddenByScope,
    terms_found: terms.filter((t) => found.has(t)),
    terms_missing: terms.filter((t) => !found.has(t)),
    ...(expansions ? { alias_expansions: expansions } : {}),
  };
}

function variantsRecord(variants: Map<string, string[]>): Record<string, string[]> | null {
  if (variants.size === 0) return null;
  const out: Record<string, string[]> = {};
  for (const [k, v] of variants) out[k] = v;
  return out;
}

function chunkHasTerm(
  s: ScoredChunk,
  index: number,
  terms: string[],
  variants: Map<string, string[]>,
): boolean {
  const term = terms[index];
  if (!term) return false;
  const forms = [term, ...(variants.get(term) ?? [])];
  const toks = new Set(tokenise(s.chunk.text));
  return forms.some((f) => toks.has(f));
}

function topByScore(scored: ScoredChunk[], limit: number): ScoredChunk[] {
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.chunk.ord - b.chunk.ord)
    .slice(0, limit);
}

/**
 * ⚠️ The ordinal modes' candidate set is chosen by TERM COVERAGE, then sorted by
 * position — never by score. Start at the strictest coverage seen and relax one
 * step at a time until there are enough candidates, so a two-term question does
 * not fall back to a one-term match while a two-term match exists.
 */
function byOrdinal(
  scored: ScoredChunk[],
  termCount: number,
  limit: number,
  mode: 'latest' | 'earliest',
): ScoredChunk[] {
  const maxCoverage = scored.reduce((m, s) => Math.max(m, s.coverage), 0);
  if (maxCoverage === 0) return [];
  for (let need = maxCoverage; need >= 1; need--) {
    const candidates = scored.filter((s) => s.coverage >= need);
    if (candidates.length === 0) continue;
    const ordered = [...candidates].sort((a, b) =>
      mode === 'earliest' ? a.chunk.ord - b.chunk.ord : b.chunk.ord - a.chunk.ord,
    );
    if (ordered.length >= limit || need === 1) return ordered.slice(0, limit);
    if (ordered.length > 0) return ordered.slice(0, limit);
  }
  void termCount;
  return [];
}

// ---------------------------------------------------------------------------
// ⚠️ THE PHRASE COUNT — design §4.3 of
// `docs/info/gabi-phrase-count-and-read-state.md`, built because the three
// instruments that existed could not answer "how often does Carl say God damn
// it, Donut".
//
// | Instrument | Said | Truth |
// |---|---|---|
// | `/api/books/presence` (bag of words `{god,damn,donut}`) | 17 chunk hits | 14 |
// | `/api/book/:id/search` (literal string, top-6 cap) | 13 chunks, 6 returned | 14 |
// | this | **14** | 14 |
//
// Two errors in opposite directions, neither of them reported. So this counts
// PHRASES, and it counts them over text that has been de-overlapped.
//
// ## ⚠️ COUNT ON DE-OVERLAPPED CHAPTER TEXT, NEVER PER CHUNK
//
// The ingester overlaps chunks by ~100 characters (`book-packs.ts`, 800/100).
// A phrase inside that seam is stored TWICE, so a per-chunk tally reports it
// twice — and a phrase that straddles a seam with no overlap is stored in
// neither chunk whole, so a per-chunk tally reports it not at all. Both errors
// are silent and they do not cancel. `deOverlap` (the same one the stitch uses)
// rebuilds each chapter's continuous text first, and the count runs on that.
//
// ⚠️ The join is CLAMPED TO THE CHAPTER, exactly as the stitch is: a phrase
// spanning a chapter boundary cannot be cited, cannot be scoped, and is not
// counted. That is the same trade the stitch already makes.
//
// ## ⚠️ ZERO IS AN ANSWER, AND IT IS NOT THE SAME ANSWER AS "NOT INGESTED"
//
// `presenceInPack`'s rule, one layer in. `total: 0` on a pack that was read is
// "he never says it"; `ingested: false` is "I have not read the book". The
// route keeps them in two different shapes so a caller cannot conflate them.
//
// ## ⚠️ AND "ABSENT" IS NOT THE SAME ANSWER AS "PAST WHERE YOU ARE"
//
// The ceiling is applied FIRST, and matches beyond it are counted separately
// into `hidden_by_scope`. A count that said "he never says it" while the rest
// of the book was hidden would be a spoiler boundary reported as a fact about
// the book.
// ---------------------------------------------------------------------------

/** ⚠️ What the matcher does, in words, so the ANSWER can say it. A count is
 *  only as trustworthy as the normalisation behind it, and a reader who is told
 *  "14" deserves to know that a comma and a full stop were treated alike. */
export const COUNT_MATCHER =
  "case-insensitive; curly quotes read as '; runs of whitespace collapsed; a comma, " +
  'full stop, exclamation mark, em dash or hyphen allowed between the words; whole ' +
  'words at both ends; counted over de-overlapped chapter text';

/** ⚠️ Between two words of the phrase: at least one separator, any mixture of
 *  whitespace and the punctuation a transcriber sprinkles into speech. This is
 *  what makes *"God damn it, Donut"*, *"God damn it. Donut"* and *"god damn it
 *  donut"* one phrase rather than three. It never matches the empty string, so
 *  *"goddamnit"* is NOT this phrase — a different spelling is a `variant`, and
 *  a variant is declared by the caller and reported back. */
const PHRASE_GAP = '[\\s,.!\\u2014\\-]+';

/** The words of a phrase: letters, digits and internal apostrophes; every other
 *  character is separator or noise. ⚠️ A `?` on the end of a spoken question
 *  must not become a literal the book has to contain. */
export function phraseWords(phrase: string): string[] {
  return normaliseForCount(phrase).match(/[\p{L}\p{N}][\p{L}\p{N}']*/gu) ?? [];
}

/** ⚠️ Length-preserving except for whitespace runs, and deliberately NOT
 *  lowercased: the offsets of a match have to survive into a quote, and the
 *  quote has to read like the book. Case is handled by the regex's `i` flag. */
function normaliseForCount(text: string): string {
  return text.replace(/[‘’‛]/g, "'").replace(/\s+/g, ' ');
}

/** The phrase as a regex, or `null` when there is nothing to count. ⚠️ The
 *  boundaries reject an adjacent LETTER OR DIGIT only, so *"donuts"* does not
 *  match *"donut"* while *"Donut's"* does — the possessive is the same word
 *  being spoken to, and `tokenise()` above already takes that view. */
export function phraseRegex(phrase: string): RegExp | null {
  const words = phraseWords(phrase);
  if (words.length === 0) return null;
  const body = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join(PHRASE_GAP);
  return new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, 'giu');
}

/** One chapter's de-overlapped text, plus where each chunk's own text starts in
 *  it — the map that turns a match offset back into a citable `ord`. */
interface ChapterSegment {
  index: number;
  title: string;
  text: string;
  marks: { at: number; chunk: PackChunk }[];
}

/**
 * Rebuild each chapter's continuous text from the chunks given.
 *
 * ⚠️ After `deOverlap`, the appended chunk's own text always ends flush with the
 * end of the join — whether an overlap was found (`a + b.slice(k)`) or not
 * (`a + ' ' + b`). So `text.length - piece.length` is the offset where that
 * chunk begins, in both branches, and that is the whole of the bookkeeping.
 */
function chapterSegments(pack: BookPack, chunks: PackChunk[]): ChapterSegment[] {
  const titles = new Map(pack.chapters.map((ch) => [ch.index, ch.title]));
  const groups = new Map<number, PackChunk[]>();
  for (const c of chunks) {
    const list = groups.get(c.chapter_index);
    if (list) list.push(c);
    else groups.set(c.chapter_index, [c]);
  }
  const out: ChapterSegment[] = [];
  for (const index of [...groups.keys()].sort((a, b) => a - b)) {
    const list = [...(groups.get(index) ?? [])].sort((a, b) => a.ord - b.ord);
    let text = '';
    const marks: { at: number; chunk: PackChunk }[] = [];
    for (const c of list) {
      const piece = normaliseForCount(c.text);
      text = text ? deOverlap(text, piece) : piece;
      marks.push({ at: Math.max(0, text.length - piece.length), chunk: c });
    }
    out.push({ index, title: titles.get(index) ?? '', text, marks });
  }
  return out;
}

interface RawMatch {
  start: number;
  end: number;
  variant: number;
}

function matchesIn(text: string, regexes: (RegExp | null)[]): RawMatch[] {
  const out: RawMatch[] = [];
  for (let v = 0; v < regexes.length; v++) {
    const re = regexes[v];
    if (!re) continue;
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (m[0].length === 0) {
        re.lastIndex += 1;
        continue;
      }
      out.push({ start: m.index, end: m.index + m[0].length, variant: v });
    }
  }
  return out;
}

/**
 * ⚠️ ONE OCCURRENCE IS ONE OCCURRENCE, however many variants matched it.
 *
 * Two spellings in the same list will sometimes cover the same words, and
 * adding their counts together is precisely the 17-versus-14 error this module
 * exists to stop. Overlapping spans collapse to one, credited to the FIRST
 * variant that matched it — which is why `by_variant` always sums to `total`.
 */
function distinctMatches(matches: RawMatch[]): RawMatch[] {
  const sorted = [...matches].sort(
    (a, b) => a.start - b.start || b.end - a.end || a.variant - b.variant,
  );
  const out: RawMatch[] = [];
  let lastEnd = -1;
  for (const m of sorted) {
    if (m.start >= lastEnd) {
      out.push(m);
      lastEnd = m.end;
    }
  }
  return out;
}

/** The chunk a match offset falls in — the last one that starts at or before
 *  it, so a match inside a seam is cited to the LATER of the two chunks that
 *  hold it. Deterministic, and either is a truthful citation. */
function chunkAtOffset(seg: ChapterSegment, offset: number): PackChunk | null {
  let found: PackChunk | null = null;
  for (const mark of seg.marks) {
    if (mark.at <= offset) found = mark.chunk;
    else break;
  }
  return found;
}

export interface CountQuote {
  chapter_index: number;
  /** The `ord` of the chunk the match sits in — a citation coordinate, and the
   *  argument to `/passage` for anyone who wants the surrounding scene. */
  ord: number;
  start_sec?: number;
  text: string;
}

export interface CountChapter {
  index: number;
  title: string;
  n: number;
  first_start_sec?: number;
}

export interface CountOptions {
  q: string;
  /** Other spellings that count as the same phrase. ⚠️ `q` counts as one of the
   *  `MAX_COUNT_VARIANTS`; the rest are clamped away rather than refused. */
  variants?: string[];
  bound: ScopeBound;
  quotes?: number;
}

export interface CountAnswer {
  ok: true;
  book_id: string;
  title: string;
  /** ⚠️ `transcript` means Whisper's punctuation, not the printed book's. The
   *  answer has to be able to say so — *"goddammit"* on the page can be
   *  *"god damn it"* in the recording. */
  source: string;
  ingester_version: number;
  q: string;
  /** The spellings actually counted, `q` first, after the clamp. */
  variants: string[];
  /** ⚠️ A PHRASE count over de-overlapped text — not chunks, not words. */
  total: number;
  by_variant: { variant: string; n: number }[];
  /** Only the chapters with a hit, in reading order. */
  by_chapter: CountChapter[];
  quotes: CountQuote[];
  /** ⚠️ Matches PAST the ceiling. Non-zero forbids the word "never". */
  hidden_by_scope: number;
  scope: DerivedScope & { chunks_visible: number; chunks_total: number };
  /** What the normalisation did, in words — `COUNT_MATCHER`. */
  matcher: string;
  /** This object serialised, in bytes, against `MAX_COUNT_BYTES`. ⚠️ It does
   *  NOT include the route's own envelope (`ingested`, `limits`) — a few dozen
   *  bytes, and the cap has an order of magnitude of headroom over the measured
   *  1–3 KB shape. */
  bytes: number;
  note?: string;
}

/** ⚠️ Dropped rows are ANNOUNCED. A silently shortened list is a count that
 *  quietly stopped being a count. */
export const COUNT_TRIMMED_NOTE =
  'Some example excerpts and per-chapter rows were left out to keep this answer small. The ' +
  'totals are complete; the examples are not all of them.';

/** `q` plus its variants, de-duplicated case-insensitively, clamped. */
function countVariants(q: string, extra: string[] | undefined): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of [q, ...(extra ?? [])]) {
    const v = raw.trim();
    if (!v) continue;
    const key = phraseWords(v).join(' ').toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(v);
    if (out.length >= MAX_COUNT_VARIANTS) break;
  }
  return out;
}

function excerptAround(text: string, start: number, end: number): string {
  const mid = Math.floor((start + end) / 2);
  let from = Math.max(0, mid - Math.floor(MAX_QUOTE_CHARS / 2));
  const to = Math.min(text.length, from + MAX_QUOTE_CHARS);
  from = Math.max(0, to - MAX_QUOTE_CHARS);
  let out = text.slice(from, to);
  // ⚠️ The ellipsis REPLACES a character rather than being added to one, so the
  // excerpt is never longer than MAX_QUOTE_CHARS. A cap that the marker itself
  // can push past is not a cap.
  if (from > 0) out = `…${out.slice(1)}`;
  if (to < text.length) out = `${out.slice(0, -1)}…`;
  return out;
}

/**
 * **Count a phrase over one book, without returning the book.**
 *
 * Counts and anchors: how many times, in which chapters, at what timestamps, and
 * at most `MAX_COUNT_QUOTES` short excerpts as evidence. Never passages, never
 * prose to be tallied by something else.
 */
export function countPhrase(pack: BookPack, opts: CountOptions): CountAnswer {
  const scope = deriveCeiling(pack, opts.bound);
  const ceiling = scope.ceiling;
  const visible = visibleChunks(pack, ceiling);
  const hidden = ceiling === null ? [] : pack.chunks.filter((c) => c.ord > ceiling);

  const variants = countVariants(opts.q, opts.variants);
  const regexes = variants.map((v) => phraseRegex(v));
  const quotesWanted = Math.min(
    Math.max(0, Math.floor(opts.quotes ?? 0) || 0),
    MAX_COUNT_QUOTES,
  );

  const byVariant = variants.map((variant) => ({ variant, n: 0 }));
  const byChapter: CountChapter[] = [];
  const perChapter: { seg: ChapterSegment; hits: RawMatch[] }[] = [];
  let total = 0;

  for (const seg of chapterSegments(pack, visible)) {
    const hits = distinctMatches(matchesIn(seg.text, regexes));
    if (hits.length === 0) continue;
    total += hits.length;
    for (const h of hits) {
      const row = byVariant[h.variant];
      if (row) row.n += 1;
    }
    const first = hits[0];
    const firstChunk = first ? chunkAtOffset(seg, first.start) : null;
    byChapter.push({
      index: seg.index,
      title: seg.title,
      n: hits.length,
      ...(firstChunk?.start_sec !== undefined ? { first_start_sec: firstChunk.start_sec } : {}),
    });
    perChapter.push({ seg, hits });
  }

  // ⚠️ The hidden tail is counted the same way and reported separately. It is
  // never folded into `total` — the asker asked about the part they have read.
  let hiddenByScope = 0;
  for (const seg of chapterSegments(pack, hidden)) {
    hiddenByScope += distinctMatches(matchesIn(seg.text, regexes)).length;
  }

  // ⚠️ Examples come from VISIBLE chunks only, and are spread one-per-chapter
  // before a second is taken from any chapter — three quotes from one scene
  // prove less than three quotes from three.
  const quotes: CountQuote[] = [];
  for (let round = 0; quotes.length < quotesWanted; round++) {
    let any = false;
    for (const { seg, hits } of perChapter) {
      const h = hits[round];
      if (!h) continue;
      any = true;
      const chunk = chunkAtOffset(seg, h.start);
      quotes.push({
        chapter_index: seg.index,
        ord: chunk?.ord ?? -1,
        ...(chunk?.start_sec !== undefined ? { start_sec: chunk.start_sec } : {}),
        text: excerptAround(seg.text, h.start, h.end),
      });
      if (quotes.length >= quotesWanted) break;
    }
    if (!any) break;
  }

  const answer: CountAnswer = {
    ok: true,
    book_id: pack.book_id,
    title: pack.title,
    source: pack.source,
    ingester_version: pack.ingester_version,
    q: opts.q,
    variants,
    total,
    by_variant: byVariant,
    by_chapter: byChapter,
    quotes,
    hidden_by_scope: hiddenByScope,
    scope: { ...scope, chunks_visible: visible.length, chunks_total: pack.chunks.length },
    matcher: COUNT_MATCHER,
    bytes: 0,
  };
  answer.bytes = byteLength(JSON.stringify(answer));

  // ⚠️ Evidence goes before arithmetic. Over the cap, quotes are dropped first,
  // then the THINNEST chapter rows — never a digit of `total`.
  while (answer.bytes > MAX_COUNT_BYTES && answer.quotes.length > 0) {
    answer.quotes.pop();
    answer.note = COUNT_TRIMMED_NOTE;
    answer.bytes = byteLength(JSON.stringify(answer));
  }
  while (answer.bytes > MAX_COUNT_BYTES && answer.by_chapter.length > 1) {
    let thinnest = 0;
    for (let i = 1; i < answer.by_chapter.length; i++) {
      if ((answer.by_chapter[i]?.n ?? 0) < (answer.by_chapter[thinnest]?.n ?? 0)) thinnest = i;
    }
    answer.by_chapter.splice(thinnest, 1);
    answer.note = COUNT_TRIMMED_NOTE;
    answer.bytes = byteLength(JSON.stringify(answer));
  }
  return answer;
}

/** A quoted phrase, or the whole query when it is short enough to be one. */
function phraseOf(query: string): string | null {
  const quoted = query.match(/"([^"]{3,120})"/);
  if (quoted?.[1]) return quoted[1].toLowerCase();
  const trimmed = query.trim().toLowerCase();
  if (trimmed.length >= 6 && trimmed.length <= 60 && !/[?]/.test(trimmed)) return trimmed;
  return null;
}
