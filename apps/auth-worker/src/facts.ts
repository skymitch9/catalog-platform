/**
 * Self-service build facts — GET/POST /api/estate/facts/:slug (owner ask
 * 2026-08-16, SHELF_SERVER.md §0a: "can we make an information entry form
 * or something so he [Justin] can enter in the data without bothering me").
 * §0 of that runbook blocks on facts only Justin has (server hardware, OS,
 * free disk vs library size) — this route is the round-trip that lets him
 * fill them in directly instead of relaying them through the owner.
 *
 * ⚠️ GENERIC ON :slug, deliberately NOT hardcoded to "shelf" (docs.ts's own
 * shape, reused rather than reinvented): the only slug wired up today is
 * "shelf" (the migration page + doc.js below), but the next build that needs
 * "a few facts filled in by whoever holds them" gets this route for free
 * instead of growing a near-duplicate.
 *
 * STORAGE: the EXISTING estate_docs KV namespace (env.ts), key
 * `facts:<slug>` — a sibling key space to docs.ts's `doc:<slug>`, same
 * binding. No new namespace: this is the same shape of thing (a small,
 * admin-only JSON/HTML blob keyed by slug) docs.ts already has a home for,
 * and a second namespace would buy nothing but one more binding to keep in
 * sync across wrangler.toml/env.ts/tests. A missing key is a legitimate
 * "nobody has filled this in yet" state (GET answers `{ facts: null }`), not
 * an error — mirrors docs.ts's `not_found` vs `docs_kv_unbound` distinction
 * for "doc absent" vs "namespace unbound".
 *
 * GATING: BOTH verbs behind requireDevops() (devops OR approver OR owner).
 * Justin already holds devops (SHELF_SERVER.md §S step 5, "Make devops" at
 * heygabi.ai/admin) purely so he can read the runbook page — this reuses
 * that exact same door for writing the facts that feed it, rather than
 * inventing a new capability tier for one small form. The only page that
 * calls POST is the already-devops-gated migration shim, so there is no
 * surface where a wider audience could reach it.
 *
 * ⚠️ USER-SUPPLIED CONTENT THAT WILL BE RENDERED — unlike docs.ts's own
 * bundled/KV content (trusted-writer HTML), these values are typed by
 * Justin in a browser and rendered back into two pages (the migration form
 * itself, and the runbook's §0 table). Devops-gated is not a substitute for
 * validation: every field is bounded (short strings, hard max lengths) and
 * scanned for control characters on the way IN (validateFactsInput below);
 * unknown keys are refused outright (the estate.ts /seen and /users
 * precedent — "body is strict"). On the way OUT, escaping is enforced by
 * CONSTRUCTION rather than by an escape() call in this file: this route
 * only ever returns `application/json`, and its two consumers (this
 * shim's doc.js and the migration page's form script) render every fact
 * value with `textContent`/`.value` assignment, never `innerHTML` — see
 * the comments at the fill sites in both scripts. A JSON string cannot
 * execute as markup through those APIs regardless of its contents, which is
 * the actual escaping boundary; an HTML-entity-escape helper here would be
 * dead code with no caller that needs it.
 */

import { Hono } from 'hono';
import type { AppBindings } from './env.js';
import { requireDevops } from './middleware/auth.js';
import { checkRegistryAuth, keyById } from './machine-keys.js';

const SLUG_RE = /^[a-z0-9-]{1,64}$/;

/** The four blocking-on-Justin facts (SHELF_SERVER.md §0) plus free-text notes. */
/**
 * ⚠️ The four `shelf_*` fields (added 2026-08-22) are the SHELF_SERVER_*
 * values `audiobook_catalog/scripts/sync_to_server.py` needs before the direct
 * push can run. Owner ask: *"make those left open things he can enter on the ui
 * and they get saved somewhere secure."*
 *
 * ⚠️ **They are CONFIG, not secrets, and the distinction is load-bearing.**
 * A tailnet hostname, a unix username, a path and a port are not credentials —
 * the secret in that system is the SSH *private* key, which never leaves the
 * pipeline PC. So these are stored in PLAINTEXT, deliberately, unlike the
 * machine tokens in `machine-keys.ts` which are stored only as a SHA-256 hash.
 * Hashing them would make them useless: the pipeline must read the values back
 * to dial the box. What makes them safe is the GATE (devops to write, a machine
 * token to read) and the SHAPE VALIDATION below — not encryption theatre.
 *
 * ⚠️ Each carries a shape check, not just a length cap, because these four
 * end up in an `rclone` argv. A value with a space or a shell metacharacter is
 * fine in a form field and not fine on a command line.
 */
export const FACT_FIELDS = [
  'hardware', 'os', 'disk_free', 'library_size', 'notes',
  'shelf_host', 'shelf_path', 'shelf_user', 'shelf_ssh_port',
] as const;
export type FactField = (typeof FACT_FIELDS)[number];

interface FieldLimit {
  maxLen: number;
  /** Table-cell fields must be one line; the free-text note may wrap. */
  singleLine: boolean;
  /** Optional SHAPE check — see the FACT_FIELDS header for why these need one. */
  shape?: RegExp;
  /** Said back to the person in words. A bare regex is not an error message. */
  shapeHint?: string;
}

/** Hostname or bare IP. No spaces, no shell metacharacters, no scheme. */
const HOSTNAME_RE = new RegExp('^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?([.][A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)*$');
/** Absolute POSIX path; rejects `..` and anything shell-special. */
const ABS_PATH_RE = new RegExp('^[/](?!.*[.][.])[A-Za-z0-9._ -]*(?:[/][A-Za-z0-9._ -]+)*[/]?$');
/** POSIX-portable username. */
const UNIX_USER_RE = new RegExp('^[a-z_][a-z0-9_-]*$');
/** 1-65535, no leading zeros. */
const PORT_RE = new RegExp('^([1-9][0-9]{0,3}|[1-5][0-9]{4}|6[0-4][0-9]{3}|65[0-4][0-9]{2}|655[0-2][0-9]|6553[0-5])$');

const FIELD_LIMITS: Record<FactField, FieldLimit> = {
  hardware: { maxLen: 200, singleLine: true },
  os: { maxLen: 200, singleLine: true },
  disk_free: { maxLen: 100, singleLine: true },
  library_size: { maxLen: 100, singleLine: true },
  notes: { maxLen: 2000, singleLine: false },
  shelf_host: { maxLen: 253, singleLine: true, shape: HOSTNAME_RE, shapeHint: 'a hostname or IP — letters, digits, dots and hyphens only' },
  shelf_path: { maxLen: 400, singleLine: true, shape: ABS_PATH_RE, shapeHint: 'an absolute path, e.g. /media/napling/books' },
  shelf_user: { maxLen: 32, singleLine: true, shape: UNIX_USER_RE, shapeHint: 'a unix username — lowercase letters, digits, underscore, hyphen' },
  shelf_ssh_port: { maxLen: 5, singleLine: true, shape: PORT_RE, shapeHint: 'a port number between 1 and 65535' },
};

// C0 controls and DEL, EXCEPT tab/newline/carriage-return (which singleLine
// fields reject separately, below, so the message names the real problem).
const CONTROL_CHAR_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;

export interface ShelfFacts {
  hardware: string;
  os: string;
  disk_free: string;
  library_size: string;
  notes: string;
  /** SHELF_SERVER_HOST — the tailnet hostname or IP of Justin's box. */
  shelf_host: string;
  /** SHELF_SERVER_PATH — the library root, e.g. /media/napling/books. */
  shelf_path: string;
  /** SHELF_SERVER_USER — the ssh user (shelfsync). */
  shelf_user: string;
  /** SHELF_SERVER_SSH_PORT — usually 22. */
  shelf_ssh_port: string;
  /** The submitting caller's directory email — stamped from the resolved actor, never client-supplied. */
  submitted_by: string;
  /** ISO 8601 — stamped server-side at write time, never client-supplied. */
  submitted_at: string;
}

export type ValidatedFacts = { ok: true; fields: Record<FactField, string> } | { ok: false; error: string };

/**
 * Pure validator: unknown top-level keys refused, every known field bounded
 * to a max length, control characters refused, single-line fields refused
 * if they carry a newline. Absent/null fields default to `''` (the form
 * always resubmits the whole record; a blank field is "not answered yet",
 * not an error).
 */
export function validateFactsInput(body: unknown): ValidatedFacts {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, error: 'body must be a JSON object' };
  }
  const record = body as Record<string, unknown>;
  const unknownKeys = Object.keys(record).filter((k) => !(FACT_FIELDS as readonly string[]).includes(k));
  if (unknownKeys.length > 0) {
    return { ok: false, error: `unknown field(s): ${unknownKeys.join(', ')}` };
  }

  const fields = {} as Record<FactField, string>;
  for (const key of FACT_FIELDS) {
    const raw = record[key];
    const value = raw === undefined || raw === null ? '' : raw;
    if (typeof value !== 'string') {
      return { ok: false, error: `${key} must be a string` };
    }
    const limit = FIELD_LIMITS[key];
    if (value.length > limit.maxLen) {
      return { ok: false, error: `${key} exceeds ${limit.maxLen} characters` };
    }
    if (CONTROL_CHAR_RE.test(value)) {
      return { ok: false, error: `${key} contains a control character` };
    }
    if (limit.singleLine && /[\r\n]/.test(value)) {
      return { ok: false, error: `${key} must be a single line` };
    }
    // ⚠️ Shape is checked only on a NON-EMPTY value. Blank stays legal for
    // every field — "nobody has filled this in yet" is a real state and must
    // not read as a validation failure, the same reasoning as GET answering
    // `{ facts: null }` rather than 404.
    if (limit.shape && value !== '' && !limit.shape.test(value)) {
      return { ok: false, error: `${key} must be ${limit.shapeHint}` };
    }
    fields[key] = value;
  }
  return { ok: true, fields };
}

export const factsRoutes = new Hono<AppBindings>();

factsRoutes.get('/estate/facts/:slug', requireDevops(), async (c) => {
  const slug = c.req.param('slug');
  if (!SLUG_RE.test(slug)) return c.json({ error: 'bad_slug' }, 400);

  const kv = c.env.estate_docs;
  if (!kv) {
    // Same app_tokens_unset idiom as docs.ts/backups.ts — "namespace unbound"
    // must never be confused with "nobody has filled this in yet".
    return c.json({ error: 'docs_kv_unbound', fix: 'add the estate_docs kv_namespaces binding' }, 503);
  }

  const raw = await kv.get(`facts:${slug}`, 'text');
  if (raw === null) return c.json({ facts: null });

  let facts: ShelfFacts;
  try {
    facts = JSON.parse(raw) as ShelfFacts;
  } catch {
    // A corrupt stored value is a bug in this route (or a hand-edited KV
    // key), never a caller error — 500, not 404/400.
    return c.json({ error: 'facts_corrupt' }, 500);
  }
  return c.json({ facts });
});

factsRoutes.post('/estate/facts/:slug', requireDevops(), async (c) => {
  const slug = c.req.param('slug');
  if (!SLUG_RE.test(slug)) return c.json({ error: 'bad_slug' }, 400);

  const kv = c.env.estate_docs;
  if (!kv) {
    return c.json({ error: 'docs_kv_unbound', fix: 'add the estate_docs kv_namespaces binding' }, 503);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'bad_json' }, 400);
  }

  const validated = validateFactsInput(body);
  if (!validated.ok) {
    return c.json({ error: 'invalid_facts', detail: validated.error }, 400);
  }

  // requireDevops() has already resolved and set the actor (middleware/auth.ts).
  const actor = c.get('actor');
  const facts: ShelfFacts = {
    ...validated.fields,
    submitted_by: actor.email,
    submitted_at: new Date().toISOString(),
  };
  await kv.put(`facts:${slug}`, JSON.stringify(facts));
  return c.json({ facts });
});

/**
 * GET /api/machine/shelf-config - the pipeline PC reading where the box is.
 *
 * ⚠️ **Bearer only. A signed-in cookie must NOT work here**, the same rule
 * shelf-parity.ts states for its POST: browser auth and machine auth are
 * different doors, and a family member's session must never be one of them.
 *
 * ⚠️ **This returns the four values in PLAINTEXT, and that is correct.** They
 * are config, not credentials - see the FACT_FIELDS header. The pipeline cannot
 * dial a box it can only see a hash of. The gate is the security boundary.
 *
 * ⚠️ **It returns ONLY the four `shelf_*` fields.** `hardware`, `os`,
 * `disk_free`, `library_size`, `notes` and `submitted_by` stay behind the
 * devops door. Default-deny by explicit allowlist, never the stored object
 * minus a few keys - the subtract form leaks the day somebody adds a field.
 */
factsRoutes.get('/machine/shelf-config', async (c) => {
  const kv = c.env.estate_docs;
  if (!kv) {
    return c.json({ error: 'docs_kv_unbound', fix: 'add the estate_docs kv_namespaces binding' }, 503);
  }

  const def = keyById('shelf-config');
  if (!def) return c.json({ error: 'key_not_registered' }, 500);

  const auth = await checkRegistryAuth(kv, def, c.req.header('authorization') ?? null, undefined);
  if (!auth.ok) {
    // ⚠️ Never a bare status. Three causes, three different fixes - the
    // estate rule that a person must always be told what to DO next.
    const said = {
      secret_unset: {
        error: 'no_key_minted',
        detail: 'Nobody has minted the shelf connection reader key yet.',
        fix: 'Mint one at https://heygabi.ai/status/api (devops sign-in), then set SHELF_CONFIG_TOKEN on the pipeline PC.',
      },
      no_header: {
        error: 'no_token',
        detail: 'This route is machine-only and no bearer token was sent.',
        fix: 'Send: Authorization: Bearer <SHELF_CONFIG_TOKEN>. A browser session is deliberately not accepted here.',
      },
      bad_token: {
        error: 'bad_token',
        detail: 'That token is not the current or previous shelf connection reader key.',
        fix: 'Rotate at https://heygabi.ai/status/api and re-set SHELF_CONFIG_TOKEN on the pipeline PC.',
      },
    }[auth.cause];
    return c.json(said, auth.cause === 'secret_unset' ? 503 : 401);
  }

  const raw = await kv.get('facts:shelf', 'text');
  const stored = raw ? (JSON.parse(raw) as Partial<ShelfFacts>) : null;

  const config = {
    host: stored?.shelf_host ?? '',
    path: stored?.shelf_path ?? '',
    user: stored?.shelf_user ?? '',
    ssh_port: stored?.shelf_ssh_port ?? '',
  };
  // ⚠️ "configured" is BOTH-not-blank, matching get_config() in
  // sync_to_server.py exactly: a half-filled form is still "not configured",
  // never a guess at the missing half. Two implementations of one rule is how
  // they drift, so this says which one is canonical.
  const configured = config.host !== '' && config.path !== '';

  return c.json({
    configured,
    config,
    ...(configured
      ? {}
      : {
          fix: 'Fill in the shelf connection fields at https://heygabi.ai/runbooks/shelf-migration/ (devops sign-in). Host and path are both required.',
        }),
    via: auth.via,
    ...(auth.via === 'previous'
      ? { warning: 'Authenticated on the PREVIOUS key - a rotation was started and never finished. Re-set SHELF_CONFIG_TOKEN on the pipeline PC.' }
      : {}),
  });
});
