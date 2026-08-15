/**
 * Estate todo board — GET /api/estate/todo.
 *
 * Auth-lock the /todo page (owner order, 2026-08-15): the board used to be a
 * public, unauthenticated static page at sites/heygabi-home/public/todo/
 * (CSS-only radios, `default-src 'none'`) — public by design, but "public"
 * turned out to mean the content sat in cleartext on the CDN edge for anyone
 * with the URL. Hiding the LINK on the front door (apex-admin-link.js) never
 * locked the PAGE. This route is the actual lock: the content moves off the
 * public origin entirely and is served only to a verified, approver-gated
 * caller — the same gate as every other estate admin surface
 * (/api/estate/users, /api/estate/site-roles, /api/estate/ops/pipeline).
 *
 * The public shim (sites/heygabi-home/public/todo/index.html + todo.js)
 * ships NO board content: it signs in, calls this endpoint with the
 * resulting Firebase ID token, and renders the fragment on 200. On 401
 * (no/garbage token) or 403 (signed in, not an approver) it shows a quiet
 * "This board is for the estate's admins." — the same fact (a 200 from a
 * requireApprover()-gated endpoint) every other estate surface relies on,
 * not a separate probe.
 *
 * Response shape: `{ html: string }` — a JSON envelope wrapping an HTML
 * fragment, not `text/html` directly. Chosen because it keeps the shim's CSP
 * simple (one `connect-src` entry, `application/json` needs no extra
 * directive) and matches every other estate route's envelope; the shim
 * injects `data.html` via `innerHTML` into a mount point it owns. The
 * fragment is OUR OWN bundled content (todo-board.ts), never a
 * user-supplied string, so there is no injection surface being opened here.
 *
 * Gating: requireApprover() (identical to ops.ts / site-roles.ts), CORS
 * apex-only (mounted in index.ts, mirroring the ops/site-roles/users mounts).
 * No new secrets, no new bindings — this reads nothing from D1 beyond what
 * requireApprover() already does to resolve the caller's row.
 */

import { Hono } from 'hono';
import type { AppBindings } from './env.js';
import { requireApprover } from './middleware/auth.js';
import { TODO_BOARD_HTML } from './todo-board.js';

export const todoRoutes = new Hono<AppBindings>();

todoRoutes.get('/estate/todo', requireApprover(), async (c) => {
  return c.json({ html: TODO_BOARD_HTML });
});
