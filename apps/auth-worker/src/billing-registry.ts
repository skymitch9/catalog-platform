/**
 * THE MONEY-PATH REGISTRY — phase 0 of docs/info/llm-billing-control-design.md.
 *
 * Feature ids are declared **once**, here, in the auth Worker (design §3.2),
 * and travel outward to consumers the way `estate-auth` and `universes`
 * already do. Nothing else in the estate may declare a feature id; a second
 * list is a list that drifts.
 *
 * ⚠️ THE FAILURE THIS FILE EXISTS TO PREVENT IS A SILENT ONE. A Worker that
 * checks `research.cover` (singular) against a registry holding
 * `research.covers` is not denied and not errored — it is **allowed, forever,
 * invisibly**. That is why `BILLING_FEATURE_IDS` is pinned literally by
 * test/billing-registry.test.ts rather than derived from the table below: a
 * typo has to break a test, because it can never break a request.
 *
 * ⚠️ THIS IS A REGISTRY, NOT A GATE. Nothing here refuses anything. It names
 * the paths that can spend money so a policy row has something to point at,
 * and so the admin page has something to draw. The refusing is
 * `billing-policy.ts`'s job, and the code's own existing gate (a capability,
 * a secret's presence, an env posture) is never replaced — only ANDed (§3.3).
 *
 * ⚠️ VERIFIED AGAINST SOURCE 2026-09-02, all four repos, every row opened.
 * All 36 paths of design §2 still exist. Several LINE anchors in that document
 * have drifted (L4/L5, L8, A4, A9, E1–E3, E7) and the doc's own §2.4 header
 * already warns about the E-row drift; the ENTRY POINTS were re-found by
 * symbol and are live. **No dead rows** — nothing here names a path that no
 * longer exists.
 */

/**
 * The sites a policy rule can name (design §3.1). ⚠️ NOT the same vocabulary
 * as `CATALOGS` in visibility.ts, and deliberately so: `ebooks` is a catalog
 * somebody may SEE, not a place that can bill, and `estate` is a place that
 * bills (the apex scanner, the Discord bot) but is not a catalog anyone is
 * granted. Two questions, two vocabularies — merging them would make one of
 * them wrong.
 */
export const BILLING_SITES = ['library', 'library2', 'games', 'audiobook', 'estate'] as const;
export type BillingSite = (typeof BILLING_SITES)[number];

/** The matrix's row groups, in the order §7.1 names them. */
export const BILLING_GROUPS = ['research', 'scan', 'gabi', 'unattended', 'cli'] as const;
export type BillingGroup = (typeof BILLING_GROUPS)[number];

export const BILLING_GROUP_LABELS: Record<BillingGroup, string> = {
  research: 'Research',
  scan: 'Photo scan',
  gabi: 'GABI',
  unattended: 'Unattended (cron)',
  cli: 'Command line',
};

/**
 * Who triggers a path. ⚠️ `system` is not decoration — L8, G7, A4, A5, A8 and
 * A9 have **no human at all** (§2.5), so a per-person toggle is structurally
 * inapplicable to them and a `system` rule is the only thing that can switch
 * one off. A feature can be both: `warnings.web` is a person pressing a button
 * (A3) AND an hourly Action paying for the queue (A5).
 *
 * ⚠️ `system` DOES NOT MEAN "unattended" — it means "asks the SYSTEM door".
 * Corrected 2026-09-05 by the three CLI rows (`cli.backfill`,
 * `research.covers`, `research.isbn`), which a human types and which
 * nevertheless resolve as `system`, because the library's CLI gate presents an
 * app token and `resolveDenied` matches `principal_kind='system'` rows only for
 * that caller. Read this field as *which DOORS can reach this path*; reading it
 * as *is there a human* is what left those three unreachable from the panel.
 */
export type BillingPrincipalKind = 'person' | 'system';

export interface BillingFeature {
  /** The id policy rows and consumers speak. Stable forever once shipped. */
  id: string;
  /** What the owner sees on the matrix row. */
  label: string;
  /** One sentence: what he is switching off. */
  detail: string;
  group: BillingGroup;
  /** Where this feature exists at all. A site not listed renders `n/a`. */
  sites: readonly BillingSite[];
  /** The §2 inventory rows this id covers — the audit trail, not decoration. */
  paths: readonly string[];
  /**
   * §2 rows that sit IN FRONT of this feature's own paths rather than being one
   * of them — today, only E7, GABI's Groq first line.
   *
   * ⚠️ IT IS DELIBERATELY NOT A `path`, AND NOT A FEATURE OF ITS OWN. E7 fronts
   * E1, E2, E4 and E5 — four rows across three different features — so
   * registering it as a path would claim one wire under three switches and make
   * "which switch stops it" depend on which row you happened to click. Because
   * the check runs at the call site BEFORE the ladder is entered, denying the
   * feature denies BOTH rungs: no Groq attempt and no Haiku fall-through. One
   * switch, both providers, which is the only reading that does not leak spend.
   */
  frontedBy?: readonly string[];
  /**
   * ⚠️ THE CODE'S OWN ESTIMATE, never measured spend (§7.1). The measured
   * number is `/status/agents`' question and this surface must not answer it —
   * a number worth showing twice is a number that will eventually disagree
   * with itself.
   */
  cost: string;
  /** Which principals can trigger it (see BillingPrincipalKind). */
  principals: readonly BillingPrincipalKind[];
}

/**
 * ⚠️ THE PIN. Literal, alphabetical-by-group-then-declared-order, and asserted
 * `deepEqual` by the test. Adding a feature means editing BOTH this array and
 * the table below, on purpose — the second edit is the one that makes you
 * notice you spelled it differently the first time.
 */
export const BILLING_FEATURE_IDS = [
  'research.details',
  'research.covers',
  'research.series',
  'research.tier',
  'research.isbn',
  'barcode.paid',
  'warnings.web',
  'chapters.llm',
  'scan.photo',
  'gabi.panel',
  'gabi.chat',
  'gabi.memory',
  'gabi.confirm',
  'sweep.details',
  'authors.match',
  'pipeline.run',
  'cli.backfill',
  'prompts.generate',
] as const;

export type BillingFeatureId = (typeof BILLING_FEATURE_IDS)[number];

export const BILLING_FEATURES: readonly BillingFeature[] = Object.freeze([
  {
    id: 'research.details',
    label: 'Details research run',
    detail: 'Fills a work’s missing details from the web, on request.',
    group: 'research',
    sites: ['library', 'library2', 'games'],
    paths: ['L1', 'L7', 'G6'],
    cost: '2–8¢ a run',
    principals: ['person'],
  },
  {
    id: 'research.covers',
    label: 'Paid cover search',
    detail: 'Hunts a cover image with the model when the free rungs miss.',
    group: 'research',
    sites: ['library', 'library2'],
    // ⚠️ L9 is ALSO under `cli.backfill` — §3.2's own table says so, and the
    // duplication is safe because policy can only DENY: the script is refused
    // if EITHER switch denies. Reproduced verbatim rather than tidied.
    paths: ['L2', 'L9'],
    cost: '6¢ a cover',
    // ⚠️ `system` ADDED 2026-09-05 (owner decision (a), design §9 Q5). L9 is a
    // command-line script, and the library CLI gate (`bbc693b`,
    // `bookbuddy/library_catalog`) asks the SYSTEM door — `resolveDenied`
    // matches `principal_kind='system'` rows and NOTHING else for that caller.
    // While this row said `['person']` the Spending panel's click wrote an
    // `everyone` rule the scripts could never see: a switch that looked pressed
    // and denied nobody, the exact silent shape this file exists to prevent.
    principals: ['person', 'system'],
  },
  {
    id: 'research.series',
    label: 'Series volume scan',
    detail: 'Works out what volumes a series has. ⚠️ No server-side concurrency lock.',
    group: 'research',
    sites: ['library', 'library2'],
    paths: ['L3'],
    cost: '8¢ a scan',
    principals: ['person'],
  },
  {
    id: 'research.tier',
    label: 'Research tier run',
    detail: 'The games catalogue’s deep research run — the priciest single call in the estate.',
    group: 'research',
    sites: ['games'],
    paths: ['G5'],
    cost: '6–40¢ a run',
    principals: ['person'],
  },
  {
    id: 'research.isbn',
    label: 'ISBN backfill (LLM rung)',
    detail: 'Finds a missing ISBN with web search when the free lookups fail.',
    group: 'research',
    sites: ['library', 'library2'],
    // ⚠️ L10 is ALSO under `cli.backfill`, same reading as L9 above.
    paths: ['L10'],
    cost: 'per book, batched',
    // ⚠️ `system` ADDED 2026-09-05 — same reason as `research.covers` above:
    // L10 runs from the batch script, whose gate resolves `system` rules only.
    principals: ['person', 'system'],
  },
  {
    id: 'barcode.paid',
    label: 'Paid barcode identify',
    detail: 'Identifies a barcode the free databases do not know.',
    group: 'research',
    sites: ['games'],
    paths: ['G4'],
    cost: 'per call, plus a web search',
    principals: ['person'],
  },
  {
    id: 'warnings.web',
    label: 'Content warnings via web search',
    detail: 'Looks up content warnings for a book. Also what the hourly fulfiller pays for.',
    group: 'research',
    sites: ['audiobook'],
    paths: ['A2', 'A3', 'A5'],
    cost: 'per book',
    principals: ['person', 'system'],
  },
  {
    id: 'chapters.llm',
    label: 'Chapter list (LLM fallback)',
    detail: 'Last rung of the chapter extractor — only runs after three free rungs miss.',
    group: 'research',
    sites: ['audiobook'],
    paths: ['A1'],
    cost: 'per book, rarely reached',
    principals: ['person', 'system'],
  },
  {
    id: 'scan.photo',
    label: 'Photo scan (shelf and single)',
    detail: 'Reads a photo of a shelf or a cover and identifies what is in it.',
    group: 'scan',
    sites: ['library', 'library2', 'games', 'estate'],
    paths: ['L4', 'L5', 'G1', 'G2', 'G3', 'E6'],
    cost: '$5 / $25 per MTok',
    principals: ['person'],
  },
  {
    id: 'gabi.panel',
    label: 'GABI site panel turn',
    detail: 'The GABI panel inside the library catalogue.',
    group: 'gabi',
    sites: ['library', 'library2'],
    paths: ['L6'],
    cost: 'per turn, 60 s cap',
    principals: ['person'],
  },
  {
    id: 'gabi.chat',
    label: 'GABI conversation (Discord)',
    detail:
      'Every @mention, reply and DM — classification, the reply itself, and the tool loop. ⚠️ Covers the Groq first-line rung too: denying this denies BOTH rungs, not just Anthropic’s.',
    group: 'gabi',
    sites: ['estate'],
    paths: ['E1', 'E2', 'E3'],
    frontedBy: ['E7'],
    cost: '24–1024 max tokens a turn',
    principals: ['person'],
  },
  {
    id: 'gabi.memory',
    label: 'GABI memory distill',
    detail: 'Summarises a finished conversation into a per-person profile.',
    group: 'gabi',
    sites: ['estate'],
    paths: ['E4'],
    frontedBy: ['E7'],
    cost: 'per distill',
    principals: ['person'],
  },
  {
    id: 'gabi.confirm',
    label: 'GABI confirm-lane restatement',
    detail: 'Restates a T2/T3 proposal in words before anybody presses the button.',
    group: 'gabi',
    sites: ['estate'],
    paths: ['E5'],
    frontedBy: ['E7'],
    cost: 'per proposal',
    principals: ['person'],
  },
  {
    id: 'sweep.details',
    label: 'Hourly details sweep',
    detail:
      '⚠️ Unattended. Runs on a cron with no user, and switching it off here is the only way to stop it without a deploy.',
    group: 'unattended',
    sites: ['library', 'library2', 'games'],
    paths: ['L8', 'G7'],
    cost: '~4¢/hr (library) · ~11¢/hr (games)',
    principals: ['system'],
  },
  {
    id: 'authors.match',
    label: 'Author → Drive folder match',
    detail: 'Matches a new author to a folder when exact, normalised and fuzzy all miss.',
    group: 'unattended',
    sites: ['audiobook'],
    paths: ['A4'],
    cost: 'per new author, cheap',
    principals: ['system'],
  },
  {
    id: 'pipeline.run',
    label: 'Run the ingestion pipeline',
    detail:
      'The whole pipeline — chapters, warnings, author match. Triggered by the button or by the filesystem watcher.',
    group: 'unattended',
    sites: ['audiobook'],
    paths: ['A8', 'A9'],
    cost: 'a whole pipeline run',
    principals: ['person', 'system'],
  },
  {
    id: 'cli.backfill',
    label: 'Command-line backfills',
    detail:
      'The library’s batch scripts. ⚠️ Advisory only — a CLI warns and offers --ignore-policy rather than refusing its operator (§9 Q5).',
    group: 'cli',
    sites: ['library', 'library2'],
    paths: ['L9', 'L10', 'L11', 'L12', 'L13'],
    cost: 'per book, unbounded batch',
    // ⚠️ `system` ADDED 2026-09-05 (owner decision (a), design §9 Q5). Every
    // path here is a script an operator runs, and its gate asks the SYSTEM
    // door. `person` stays because a human IS the one typing the command — the
    // two together are what let the panel's one click reach both the API caller
    // and the shell. The visible cost of the decision is a clock icon on this
    // row, three rows in all; that was the owner's call to make and he made it.
    principals: ['person', 'system'],
  },
  {
    id: 'prompts.generate',
    label: 'Discussion prompt generation',
    detail: 'Writes book-club discussion prompts. Command line only — no cron calls it.',
    group: 'cli',
    sites: ['audiobook'],
    paths: ['A7'],
    cost: 'per book, manual',
    principals: ['person'],
  },
]);

const BY_ID = new Map(BILLING_FEATURES.map((f) => [f.id, f]));

export function isBillingFeatureId(v: unknown): v is BillingFeatureId {
  return typeof v === 'string' && BY_ID.has(v);
}

export function isBillingSite(v: unknown): v is BillingSite {
  return typeof v === 'string' && (BILLING_SITES as readonly string[]).includes(v);
}

export function billingFeature(id: string): BillingFeature | null {
  return BY_ID.get(id) ?? null;
}

/** The features that exist on a site — what the matrix draws, and what a resolver iterates. */
export function featuresForSite(site: BillingSite): BillingFeature[] {
  return BILLING_FEATURES.filter((f) => f.sites.includes(site));
}

/**
 * The sentence a person sees when a feature is switched off, per §6.
 *
 * ⚠️ THE SITE/PERSON SPLIT IS LOAD-BEARING and it is the whole reason this
 * function takes a `scope`. *"Switched off for you"* sends somebody to ask the
 * owner; *"switched off for this catalogue"* tells them not to bother, because
 * nobody there can turn it back on either. Collapsing the two into one sentence
 * wastes an evening.
 *
 * ⚠️ It never quotes the rule's `why` — that is the owner's internal note and
 * it may name people (§5).
 */
export function billingRefusalSentence(id: string, scope: 'site' | 'person'): string {
  const f = billingFeature(id);
  const what = f ? f.label : 'That paid feature';
  return scope === 'site'
    ? `${what} is switched off for this catalogue. The owner can turn it back on.`
    : `${what} is switched off for you. Ask the owner.`;
}

/**
 * The whole refusal body a Worker returns, so the SENTENCE travels on the wire
 * and not only inside one React app.
 *
 * ⚠️ This shape is the lesson of §6.1 defect 1, which survived review because
 * `Board_Game_Catalog`'s browser client mapped the bare code to a sentence:
 * curl, GABI, a second surface and every future app got a machine code and no
 * route back. *"The client translates the code"* is not compliance — the rule
 * is about the RESPONSE.
 */
export function billingRefusalBody(id: string, scope: 'site' | 'person') {
  return {
    error: 'billing_denied' as const,
    detail: billingRefusalSentence(id, scope),
    feature: id,
    scope,
    needs: scope === 'site' ? 'the estate owner' : 'the estate owner, for your account',
    how: 'Ask the owner to switch it back on from the Spending panel on heygabi.ai/admin/. A change takes effect within 10 minutes.',
  };
}
