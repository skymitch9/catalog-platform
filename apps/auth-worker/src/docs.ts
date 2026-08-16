/**
 * Unlisted estate documents — GET /api/estate/docs/:slug (0003, 2026-08-15).
 *
 * Owner order: the shelf-server runbook gets a hidden page on heygabi.ai,
 * "behind sso… give this page its own role… devops". The serving shape is
 * /todo's lock, verbatim: a content-free shim on the apex signs in and
 * fetches this endpoint; a 200 IS the capability fact; 401/403 leave the
 * gate showing a quiet refusal. Response is the same `{ html }` JSON
 * envelope as /estate/todo, for the same CSP reasons.
 *
 * ⚠️ WHY KV AND NOT A BUNDLED MODULE (the one way this deliberately differs
 * from todo-board.ts): this repo is PUBLIC on GitHub. todo-board.ts predates
 * that flip and its content is curated to survive it; the runbooks behind
 * THIS endpoint are precisely the operational detail the devops gate exists
 * to fence, so they must never sit in the repo at all. They live in the
 * `estate_docs` KV namespace (bound in wrangler.toml), written by
 * `wrangler kv key put --binding estate_docs doc:<slug> --path <fragment>
 * --remote` from a source-of-truth file kept in a LOCAL-ONLY docs tree
 * (first tenant: audiobook_catalog docs/access/SHELF_SERVER.md names both
 * the fragment and the update command).
 *
 * Slugs are [a-z0-9-]{1,64} — no path tricks, no enumeration endpoint, and
 * a missing doc answers the same 404 shape as an unknown route. Gated by
 * requireDevops() (devops OR approver OR owner), CORS apex-only (index.ts).
 */

import { Hono } from 'hono';
import type { AppBindings } from './env.js';
import { requireDevops } from './middleware/auth.js';

const SLUG_RE = /^[a-z0-9-]{1,64}$/;

export const docsRoutes = new Hono<AppBindings>();

docsRoutes.get('/estate/docs/:slug', requireDevops(), async (c) => {
  const slug = c.req.param('slug');
  if (!SLUG_RE.test(slug)) return c.json({ error: 'bad_slug' }, 400);

  const kv = c.env.estate_docs;
  if (!kv) {
    // A missing binding is a configuration error, not a 404 — the
    // app_tokens_unset idiom, so "doc absent" and "namespace unbound" can
    // never be confused while debugging.
    return c.json({ error: 'docs_kv_unbound', fix: 'add the estate_docs kv_namespaces binding' }, 503);
  }

  const html = await kv.get(`doc:${slug}`, 'text');
  if (html === null) return c.json({ error: 'not_found' }, 404);
  return c.json({ html });
});
