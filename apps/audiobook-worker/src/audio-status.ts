/**
 * `GET /api/audio/status` — what is streamable right now, behind the estate.
 * **Audio player phase 1**, built 2026-08-18.
 *
 * This is what lets the audiobook site's book modal choose between three
 * states — *"not streamable yet — request it"*, *"requested"*, and *"ready"* —
 * without the site ever holding a list of the household's audio files.
 *
 * ## ⚠️ IT IS NOT `/api/ebooks/manifest`'S TWIN, AND THE NAME SAYS SO
 *
 * `GET /api/ebooks/manifest` returns the ebook manifest **verbatim** — every
 * row, `path` included — because the reader needs it. This route returns a
 * **PROJECTION**: five named fields per book, built by an explicit allowlist in
 * `audio-manifest.ts::streamableBooks()`, and `path` is not one of them.
 *
 * It is called `/status` rather than `/manifest` for exactly that reason. A
 * route called "manifest" that serves something less than the manifest is an
 * invitation for the next session to "fix" it by serving the whole thing — and
 * the whole thing is a filename-by-filename map of 630 GB of audio, which is
 * why `site/audio_manifest.json` is gitignored in a PUBLIC repo
 * (`audiobook_catalog/docs/info/audio-ingest.md` §2). ⚠️ **Do not add `path`
 * to this answer. Nothing on the site needs it — the byte route resolves
 * `anchor → path` server-side, which is the entire point of the anchor.**
 *
 * ## The gate is the same one, on purpose
 *
 * `resolveEbookAccess()` — the estate's `vis_ebooks` grant, which owner
 * decision 1 (design §12) made mean *"may consume the estate's book files"*,
 * reading **or** listening. A person who cannot listen gets the gate's own
 * worded 401/403 and the site renders no audio row at all, which is the
 * standing rule's preferred shape: do not render a control someone cannot use.
 *
 * ⚠️ It is NOT gated on `ESTATE_CHECK` — same reasoning as the ebook shelf's:
 * that mode exists to shadow an EXISTING behaviour, and a surface that answers
 * in shadow mode is an ungated surface. This route did not exist before today.
 *
 * ## What an empty answer means
 *
 * `{ books: [], count: 0 }` is the CORRECT answer on day one and for as long
 * as nobody presses request. Ingest is on-demand; an empty bucket is the
 * design working, not a stalled pipeline. The `manifest_absent` 503 below says
 * the same thing in its own words for the case where the publish step has
 * never run at all.
 */

import { Hono } from 'hono';
import { AUDIO_MANIFEST_KEY, audioIndex, streamableBooks } from './audio-manifest.js';
import { resolveEbookAccess } from './ebook-gate.js';
import { estateCheckMode, type Env } from './env.js';

export const audioStatusRoutes = new Hono<{ Bindings: Env }>();

audioStatusRoutes.get('/api/audio/status', async (c) => {
  const mode = estateCheckMode(c.env.ESTATE_CHECK);

  // 1. The shared gate. Every refusal sentence lives in ebook-gate.ts and is
  //    returned unchanged — one gate, one answer, so the shelf, the reader and
  //    the player can never disagree about who is admitted.
  const gate = await resolveEbookAccess(c);
  if (!gate.ok) return gate.response;
  const grant = gate.access.grant;

  const bucket = c.env.EBOOKS_GATED;
  if (!bucket) {
    return c.json(
      {
        error: 'manifest_store_unbound',
        detail:
          'You may listen, but the audio catalogue’s store is not attached to this Worker. That is a deployment problem on our side — tell Mitch.',
        fix: 'add the [[r2_buckets]] EBOOKS_GATED binding (bucket ebooks-gated) and redeploy',
      },
      503,
    );
  }

  const idx = await audioIndex(bucket);
  if (!idx.ok) {
    return c.json(
      {
        error: idx.reason === 'absent' ? 'manifest_absent' : 'manifest_unreadable',
        detail:
          idx.reason === 'absent'
            ? 'No audio catalogue has been published yet, so nothing is known to be streamable. Audiobooks are uploaded on request — if nobody has requested one yet, this is the expected answer rather than a fault.'
            : 'The audio catalogue could not be read. This is a publishing problem, not a permission one — tell Mitch.',
        ...(idx.reason === 'absent'
          ? {
              fix: `run scripts/publish_audio_manifest.py in audiobook_catalog (it publishes ${AUDIO_MANIFEST_KEY} after every ingest)`,
            }
          : {}),
      },
      503,
    );
  }

  const books = streamableBooks(idx.index);

  return c.json(
    {
      books,
      count: books.length,
      // The player is phase 2. Said here rather than assumed so the site can
      // render an honest ladder — "ready to stream, player coming" — instead
      // of a play button that does nothing.
      player: 'phase2',
      estate: { mode, status: grant.status, stale: grant.stale },
    },
    200,
    {
      // Never a shared cache: the answer is per-person by construction (the
      // gate decided it), and `Vary: Authorization` says so to any proxy that
      // ignores `private`.
      'Cache-Control': 'private, no-store',
      Vary: 'Authorization',
    },
  );
});
