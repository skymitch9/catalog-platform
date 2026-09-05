/**
 * THE CATALOG REGISTRY — the estate's one answer to *"which catalogs exist,
 * what is each called, and who owns it"*.
 *
 * Owner ask, 2026-09-05 15:50 Phoenix, confirmed 15:58: *"Make sure everything
 * we have that's in the estate connects to multiple libraries and make sure
 * that the libraries are designated by who owns the physical or shared with
 * digital works."*
 *
 * Design: docs/info/catalog-registry.md. Survey and inventory:
 * docs/info/multi-library-survey-2026-09-05.md §4 (what existed before this
 * file: `id` ✅, `host` 🟡, and `label`/`owner`/`holding`/`shared` ❌ — nothing
 * anywhere), §2 F2 (the SEVEN disagreeing spellings of two libraries this
 * exists to delete), §10 dispatch 1 (this build). Schema and the reasoning
 * behind every column: `migrations/0020_estate_catalog.sql`.
 *
 * ## 🔴 The one thing to understand before editing
 *
 * **The rows of this table are PUBLISHED to the anonymous internet**, through
 * `GET index.heygabi.ai/api/catalogs`, because the apex search box needs labels
 * before anybody signs in. Owner decision 2026-09-05 16:14, asked and answered:
 * **"yes name only"**.
 *
 * So a row here is a public statement that a shelf EXISTS and whose it is. It
 * is never a statement about what is ON it. ⚠️ **No count, no title, no
 * freshness and nothing derived from an `entry` row may ever be stored in this
 * table or joined into the anonymous answer.** Samantha's rows stay
 * `vis_library2`-gated everywhere else, exactly as they were; this changes
 * nothing about who may read them.
 *
 * ## ⚠️ Who may read the route in this file
 *
 * `GET /api/estate/catalogs` is an **app-token door** — the same
 * `identifyApp()` bearer check `POST /estate/seen` and `GET
 * /estate/billing/policy` use, and therefore **no new secret**: the index
 * Worker already holds `ESTATE_APP_TOKEN_INDEX` and the matching value already
 * lives here. It is deliberately NOT browser-reachable and has no CORS mount
 * (index.ts says so at its mount): the PUBLIC surface is the index Worker's
 * `/api/catalogs`, which caches, which every estate page already calls, and
 * which decides in one place what an anonymous caller versus a member sees.
 * Two public copies of one fact is exactly the thing this registry deletes.
 *
 * ## ⚠️ Nothing here creates a catalog
 *
 * Same rule as `catalog-requests.ts`, one layer on: a row here says a catalog
 * EXISTS. It is written by the `/live` route — the call the person who actually
 * ran the ten-step provisioning makes — and never by `accept`, because between
 * accept and live somebody has been told yes and nothing exists. A registry row
 * written at accept time would put a catalog on the estate's front door before
 * the hostname resolved.
 */

import { Hono } from 'hono';
import type { AppBindings } from './env.js';
import { identifyApp } from './estate.js';

/* ------------------------------------------------------------------ *
 * Rows and the wire shape
 * ------------------------------------------------------------------ */

export interface EstateCatalogRow {
  id: string;
  push_source: string | null;
  kind: string;
  label: string;
  owner_name: string | null;
  holding: string;
  shared: number;
  host: string;
  sort_order: number;
  request_id: number | null;
  created_at: string;
}

/**
 * The six fields the survey's §4 proposed, plus the two static ones every
 * consumer turned out to need.
 *
 * ⚠️ `owner` ON THE WIRE, `owner_name` IN SQL. The column is named for what it
 * holds (a display name, never an identifier); the wire field is named for the
 * question it answers, which is the owner's own word.
 *
 * ⚠️ `push_source` AND `kind` ARE ON THE ANONYMOUS WIRE ON PURPOSE, and they are
 * not a widening of the owner's "name only". Both are STATIC metadata about the
 * id that is already listed — `push_source` is the games↔game translation every
 * search hit needs to be labelled at all, `kind` is what stops a future `games2`
 * rendering as a book. Neither is a count, a title, a freshness or anything
 * derived from a row on anybody's shelf, which is what "name only" fences.
 */
export interface CatalogWire {
  id: string;
  push_source: string | null;
  kind: string;
  label: string;
  owner: string | null;
  holding: string;
  shared: boolean;
  host: string;
}

export function toWire(row: EstateCatalogRow): CatalogWire {
  return {
    id: row.id,
    push_source: row.push_source,
    kind: row.kind,
    label: row.label,
    owner: row.owner_name,
    holding: row.holding,
    shared: row.shared === 1,
    host: row.host,
  };
}

/* ------------------------------------------------------------------ *
 * The seed, mirrored from 0020 so a test can pin the two together
 * ------------------------------------------------------------------ */

/**
 * The five catalogs 0020 back-seeds, as data.
 *
 * ⚠️ THIS IS NOT A SECOND REGISTRY AND NOTHING AT RUNTIME READS IT. It exists
 * for exactly one purpose: `test/estate-catalog.test.ts` asserts that the SQL
 * seed and this array agree, so a future edit to one that forgets the other
 * fails a test instead of shipping. Every read path goes to D1.
 *
 * ⚠️ It is deliberately NOT used as a fallback when the table is missing. "The
 * migration has not been applied" and "these are the catalogs" are different
 * facts, and a fallback that quietly answered the second would make the
 * migration optional and its absence invisible — the exact silent-staleness
 * shape KNOWN_ISSUES and the docs standard exist to kill.
 */
export const SEED_CATALOGS: readonly Omit<EstateCatalogRow, 'created_at' | 'request_id'>[] = [
  { id: 'audiobook', push_source: 'audiobook', kind: 'audio', label: 'Shared audiobooks', owner_name: null, holding: 'digital', shared: 1, host: 'audiobooks.heygabi.ai', sort_order: 10 },
  { id: 'library', push_source: 'library', kind: 'books', label: "Skylar's library", owner_name: 'Skylar', holding: 'physical', shared: 0, host: 'library.heygabi.ai', sort_order: 20 },
  { id: 'games', push_source: 'game', kind: 'games', label: "Skylar's board games", owner_name: 'Skylar', holding: 'physical', shared: 0, host: 'boardgames.heygabi.ai', sort_order: 30 },
  { id: 'library2', push_source: 'library2', kind: 'books', label: "Samantha's library", owner_name: 'Samantha', holding: 'physical', shared: 0, host: 'padhard.heygabi.ai', sort_order: 40 },
  { id: 'ebooks', push_source: null, kind: 'books', label: 'Shared ebooks', owner_name: null, holding: 'digital', shared: 1, host: 'ebooks.heygabi.ai', sort_order: 50 },
];

/* ------------------------------------------------------------------ *
 * Validation — the vocabularies, closed
 * ------------------------------------------------------------------ */

/**
 * ⚠️ THE CONTENT KIND, AND IT IS NOT `catalog-names.ts` `CATALOG_KINDS`. That
 * one is the PROVISIONING kind (`books`|`games`: which ten-step runbook and
 * which ledger applies) and it never names a catalog that exists. This one
 * answers what is ON the shelf, so it has a third value no provisioning path
 * has. The survey's §1 flags confusing the two as a trap; they overlap by
 * design, which is what makes the `/live` write a straight copy.
 */
export const CONTENT_KINDS = ['books', 'games', 'audio'] as const;
export type ContentKind = (typeof CONTENT_KINDS)[number];

export const HOLDINGS = ['physical', 'digital'] as const;
export type Holding = (typeof HOLDINGS)[number];

export function isContentKind(v: unknown): v is ContentKind {
  return typeof v === 'string' && (CONTENT_KINDS as readonly string[]).includes(v);
}

export function isHolding(v: unknown): v is Holding {
  return typeof v === 'string' && (HOLDINGS as readonly string[]).includes(v);
}

/**
 * A catalog id is the visibility vocabulary's shape: the same
 * lowercase-alphanumeric form a `vis_<id>` column can be named for. Checked
 * rather than assumed because the `/live` caller supplies it — and an id that
 * cannot become a column name is an id whose grant can never be created.
 */
export const CATALOG_ID_RE = /^[a-z][a-z0-9]{1,30}$/;

/* ------------------------------------------------------------------ *
 * The migration-lag branch
 * ------------------------------------------------------------------ */

/**
 * ⚠️ A WORKER AHEAD OF ITS MIGRATION SAYS SO, IN WORDS, WITH THE COMMAND THAT
 * FIXES IT — `catalog-requests.ts`'s idiom, kept verbatim. The alternative, a
 * 500, is indistinguishable from an outage, and this is the one failure whose
 * cause is exactly knowable from the error.
 */
export const REGISTRY_TABLE_MISSING = {
  error: 'catalog_registry_table_missing',
  detail:
    'The catalog registry table does not exist in this database — the Worker shipped ahead of its ' +
    'migration. Nothing is broken and nothing was lost; the estate simply cannot say which catalogs ' +
    'exist until the migration is applied.',
  fix: 'npm run db:migrate (from apps/auth-worker) applies 0020_estate_catalog.sql remotely',
} as const;

export function registryTableMissing(err: unknown): boolean {
  return /no such table/i.test((err as Error)?.message || '');
}

const SELECT_COLS =
  'id, push_source, kind, label, owner_name, holding, shared, host, sort_order, request_id, created_at';

/** Every catalog, in render order. Throws on a missing table — callers branch. */
export async function listCatalogs(db: D1Database): Promise<EstateCatalogRow[]> {
  const { results } = await db
    .prepare(`SELECT ${SELECT_COLS} FROM estate_catalog ORDER BY sort_order, id`)
    .all<EstateCatalogRow>();
  return results ?? [];
}

/* ------------------------------------------------------------------ *
 * The provisioner's write
 * ------------------------------------------------------------------ */

export interface NewCatalog {
  id: string;
  push_source: string | null;
  kind: ContentKind;
  label: string;
  owner_name: string | null;
  holding: Holding;
  shared: boolean;
  host: string;
  request_id: number | null;
}

export type RegistryWrite =
  | { written: true; id: string; detail: string }
  | { written: false; id: string; reason: 'exists' | 'failed'; detail: string };

/**
 * Insert a provisioned catalog's registry row.
 *
 * ⚠️ `ON CONFLICT DO NOTHING`, and the answer says which happened. A `/live`
 * call is re-runnable by design (the provisioner may be resumed), so a second
 * call must not fail — and it must not overwrite a label somebody has since
 * corrected by hand. "Already there" and "just written" are different facts and
 * the caller is told which.
 *
 * ⚠️ IT NEVER THROWS. The registry write rides on the back of a status change
 * that has already landed, and housekeeping must not be able to fail the
 * person's answer — `catalog-requests.ts` takes the same stance for the sealed
 * envelopes. A failure is REPORTED, in words, in the response.
 */
export async function insertCatalog(db: D1Database, cat: NewCatalog): Promise<RegistryWrite> {
  try {
    const existing = await db
      .prepare('SELECT id FROM estate_catalog WHERE id = ?1')
      .bind(cat.id)
      .first<{ id: string }>();
    if (existing) {
      return {
        written: false,
        id: cat.id,
        reason: 'exists',
        detail:
          `The registry already holds a catalog called “${cat.id}”, so nothing was changed. ` +
          'That is the expected answer when a provisioning run is repeated; if it is a different ' +
          'catalog that wanted the same id, it needs a different one.',
      };
    }
    await db
      .prepare(
        'INSERT INTO estate_catalog (id, push_source, kind, label, owner_name, holding, shared, host, ' +
          'sort_order, request_id, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 100, ?9, ?10) ' +
          'ON CONFLICT(id) DO NOTHING',
      )
      .bind(
        cat.id,
        cat.push_source,
        cat.kind,
        cat.label,
        cat.owner_name,
        cat.holding,
        cat.shared ? 1 : 0,
        cat.host,
        cat.request_id,
        new Date().toISOString(),
      )
      .run();
    return {
      written: true,
      id: cat.id,
      detail:
        `“${cat.id}” is now in the estate catalog registry, so every surface that reads it will ` +
        'name this catalog and say who owns it. It does NOT create the visibility grant — ' +
        `a \`vis_${cat.id}\` column is still its own migration.`,
    };
  } catch {
    // ⚠️ NAMED, NOT SWALLOWED. The catalog IS live either way — the status
    // change landed before this ran — so the honest answer is "live, but the
    // estate does not know its name yet", with the one thing to do about it.
    return {
      written: false,
      id: cat.id,
      reason: 'failed',
      detail:
        'The catalog is marked live, but the estate registry row could not be written — so nothing ' +
        'will name this catalog on the front door or in a search result yet. Re-run this call once ' +
        'the directory is reachable, or insert the row by hand; the /live status is already recorded ' +
        'and does not need repeating.',
    };
  }
}

/* ------------------------------------------------------------------ *
 * The route
 * ------------------------------------------------------------------ */

export const estateCatalogRoutes = new Hono<AppBindings>();

/**
 * GET /estate/catalogs — the registry, for the index Worker.
 *
 * ⚠️ MOUNTED BEFORE `catalogRequestRoutes` in index.ts, which owns
 * `/estate/catalogs/availability` and `/estate/catalogs/requests`. The paths do
 * not overlap (Hono matches exact segments, and neither of those is
 * parameterised at this level) but the order is kept explicit anyway: the same
 * "specific ahead of any parameterised sibling" rule the estateDocsRoutes mount
 * states, and the failure it prevents is a 404 that reads like "the route was
 * never deployed".
 *
 * ⚠️ NO CORS MOUNT, DELIBERATELY. Nothing in a browser calls this; the public
 * surface is the index Worker's `/api/catalogs`. A CORS mount here would make a
 * second browser-reachable copy of the same fact, which is the failure this
 * whole registry exists to end.
 */
estateCatalogRoutes.get('/estate/catalogs', async (c) => {
  const { app, anyConfigured } = await identifyApp(c.env, c.req.header('authorization'));

  if (!anyConfigured) {
    // A missing secret is a CONFIGURATION failure, not an auth decision — the
    // `/seen` idiom, kept verbatim, because on rotation day this is the
    // difference between "I set it wrong" and "I never set it".
    return c.json(
      {
        error: 'app_tokens_unset',
        detail:
          'This Worker holds no app tokens at all, so it cannot say whether yours is one of them. ' +
          'That is our configuration, not a decision about your token.',
        fix: 'wrangler secret put ESTATE_APP_TOKEN_INDEX (on estate-auth)',
      },
      503,
    );
  }

  if (!app) {
    return c.json(
      {
        error: 'unauthorized',
        detail:
          'The catalog registry is read by the estate’s own Workers, with an app token. That bearer is ' +
          'not one of them. People read the registry at index.heygabi.ai/api/catalogs, which needs no ' +
          'token at all.',
        fix: 'present ESTATE_APP_TOKEN_<APP>, or use https://index.heygabi.ai/api/catalogs',
      },
      401,
    );
  }

  try {
    const rows = await listCatalogs(c.env.DB);
    return c.json({
      ok: true,
      catalogs: rows.map(toWire),
      count: rows.length,
      /** Which Worker answered, and when — the reader stamps its own cache with this. */
      source: 'estate-auth',
      generated_at: new Date().toISOString(),
    });
  } catch (err) {
    if (registryTableMissing(err)) return c.json(REGISTRY_TABLE_MISSING, 503);
    return c.json(
      {
        error: 'registry_unreadable',
        detail:
          'The estate directory could not be read — that is an outage, not a permissions problem, and ' +
          'not a statement that no catalogs exist.',
      },
      502,
    );
  }
});
