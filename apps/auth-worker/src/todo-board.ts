/**
 * The cross-project todo board's CONTENT — the `<main>…</main>` fragment
 * that used to be baked, public and unauthenticated, into
 * sites/heygabi-home/public/todo/index.html. Auth-locked 2026-08-15 (owner
 * order: "Auth lock the todo page too") by moving the content OFF the public
 * origin entirely: it now lives here, behind requireApprover() (todo.ts),
 * and the public page (the "shim") fetches it only after a successful
 * sign-in + approver check. A signed-out `curl` of the public HTML shows
 * none of this — that is the point of the move, not an accident of styling.
 *
 * ⚠️ WHY A PLAIN TS STRING, NOT A WRANGLER TEXT-MODULE IMPORT (`import html
 * from './todo-board.html'` + a `[[rules]]` entry in wrangler.toml): that
 * idiom has no precedent anywhere in this Worker, and adding one here would
 * have been a one-off. More concretely, it would have broken `npm test`
 * (`tsx --test test/*.test.ts`): tsx's loader handles `.ts`/`.js` via esbuild
 * but does not know about wrangler's `[[rules]]` module types, so an
 * `import … from '*.html'` resolves fine under `wrangler dev`/`wrangler
 * deploy` (which DO read wrangler.toml) and fails outright under the plain
 * Node test runner. A `.ts` constant works identically in all three contexts
 * with no build-config fork, which is worth more than the marginal tidiness
 * of a separate `.html` file.
 *
 * CONTENT-UPDATE PATH (deliberate, and slower than editing a static file on
 * purpose — the board changes rarely, see the owner note in docs/TODO.md):
 *   1. Edit the markup below.
 *   2. `npm test` (this file has no logic to break, but todo.ts's gating
 *      does — run the suite anyway) and `npm run probe` if you touched
 *      gating.
 *   3. `wrangler deploy` from apps/auth-worker/ (`wrangler.toml`'s existing
 *      routes/bindings; no new secrets needed).
 *   4. No Pages deploy is needed for a content-only change — the public shim
 *      (sites/heygabi-home/public/todo/index.html + todo.js) does not change
 *      when only the board's items change.
 *
 * The markup itself is unchanged from the pre-lock page except for being
 * lifted out of its <html> shell: same tokens-relative classes (.item,
 * .tag, .scope, .owner, …), same CSS-only radio filter (#f-all…#f-cross,
 * .filters, .board, :checked ~ rules) — all of it defined in the shim's own
 * <style> block, which still ships those rules verbatim so this fragment
 * renders correctly the moment it is injected via innerHTML. See the shim's
 * own header comment for the injection mechanics and the "no content in the
 * public HTML" verification.
 */

export const TODO_BOARD_HTML = `<main>

  <header class="rise" style="animation-delay:.02s">
    <a class="back" href="/">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H6"/><path d="m12 19-7-7 7-7"/></svg>
      heygabi.ai
    </a>
    <h1>What&rsquo;s next</h1>
    <p class="tagline">Work that is agreed but not built, across the three catalogues and the front door itself. Each item says how far it reaches: one shelf, a few, all of them, or this site.</p>
  </header>

  <section class="rise" style="animation-delay:.1s">
    <h2 class="sr-only">The board</h2>

    <!--
      ⚠️ The six radios must stay DIRECT SIBLINGS of .filters and .board, in
      this order. Wrapping them in a <fieldset> for tidiness breaks every
      \`~\` rule in the stylesheet and silently disables the filter.
    -->
    <input class="filter-radio" type="radio" name="view" id="f-all" checked>
    <input class="filter-radio" type="radio" name="view" id="f-audio">
    <input class="filter-radio" type="radio" name="view" id="f-books">
    <input class="filter-radio" type="radio" name="view" id="f-games">
    <input class="filter-radio" type="radio" name="view" id="f-home">
    <input class="filter-radio" type="radio" name="view" id="f-cross">

    <div class="filters" role="group" aria-label="Filter the board">
      <label class="chip" for="f-all">Everything</label>
      <label class="chip" for="f-audio">Audiobooks</label>
      <label class="chip" for="f-books">Books</label>
      <label class="chip" for="f-games">Board games</label>
      <label class="chip" for="f-home">Landing site</label>
      <label class="chip" for="f-cross">Cross&#8209;project</label>
    </div>

    <div class="board">

      <ul class="items">

        <!-- ===== ALL PROJECTS ============================================ -->

        <li class="item p-audio p-books p-games p-landing s-all">
          <h3>One search across all three shelves</h3>
          <p>&ldquo;Do we own this in any format?&rdquo; answered once, instead of three times. All three catalogues now feed a shared index &mdash; audiobooks, books and board games are in it. What is missing is the search box on the front door.</p>
          <p class="meta">
            <span class="tag t-audio">Audiobooks</span>
            <span class="tag t-books">Books</span>
            <span class="tag t-games">Board games</span>
            <span class="tag t-landing">Landing site</span>
            <span class="scope">All projects</span>
          </p>
        </li>

        <li class="item p-audio p-books p-games s-all">
          <h3>One sign-in and one set of roles everywhere</h3>
          <p>The same account and the same owner / manager / reader roles across every shelf. The audiobook side was the last to move and its sign-in is now wired up &mdash; what is left is signing in for real, on both shelves, to confirm it.</p>
          <p class="meta">
            <span class="tag t-audio">Audiobooks</span>
            <span class="tag t-books">Books</span>
            <span class="tag t-games">Board games</span>
            <span class="scope">All projects</span>
          </p>
        </li>

        <!-- ===== SOME PROJECTS =========================================== -->

        <li class="item p-audio p-books s-some">
          <h3>GABI answers questions about the books themselves</h3>
          <p>She can already find a book on a shelf. The next step is answering from inside one &mdash; what happened, who someone is, where a series left off. The books are being transcribed and packed for her now; nothing reads those packs yet.</p>
          <p class="meta">
            <span class="tag t-audio">Audiobooks</span>
            <span class="tag t-books">Books</span>
            <span class="scope">Some projects</span>
          </p>
        </li>

        <li class="item p-books p-games s-some">
          <h3>Keep the two scanning catalogues in step</h3>
          <p>Books borrowed its scan queue, its barcode lookup and its arrival flow from board games. Fixes found on one side should travel to the other rather than quietly forking.</p>
          <p class="meta">
            <span class="tag t-books">Books</span>
            <span class="tag t-games">Board games</span>
            <span class="scope">Some projects</span>
          </p>
        </li>

        <li class="item p-audio p-books s-some">
          <h3>Match books to their audiobooks</h3>
          <p>A book and its audiobook are the same story on two shelves, and only some of them are joined up so far. Long series with many volumes are the group worth chasing first.</p>
          <p class="meta">
            <span class="tag t-audio">Audiobooks</span>
            <span class="tag t-books">Books</span>
            <span class="scope">Some projects</span>
          </p>
        </li>

        <!-- ===== ONE PROJECT — AUDIOBOOKS ================================ -->

        <li class="item p-audio s-one">
          <h3>Listen to a book in the browser</h3>
          <p>The shelf can hand over a file; there is no player yet. Somewhere to press play, keep your place, and pick up on another device is the next piece.</p>
          <p class="meta">
            <span class="tag t-audio">Audiobooks</span>
            <span class="scope">One project</span>
          </p>
        </li>

        <li class="item p-audio s-one">
          <h3>Twenty-five books that need reading by eye first</h3>
          <p>Some books are scans with no text layer, so nothing can be searched or answered from them until the pages are read into words. They are queued and waiting on that step.</p>
          <p class="meta">
            <span class="tag t-audio">Audiobooks</span>
            <span class="scope">One project</span>
          </p>
        </li>

        <li class="item p-audio s-one">
          <h3>More of the club running itself in Discord</h3>
          <p>Voting, meeting reminders and &ldquo;do we have this book?&rdquo; already work there. Still to come: a feed of new arrivals, RSVPs by button, and posting your reading progress without leaving the chat.</p>
          <p class="meta">
            <span class="tag t-audio">Audiobooks</span>
            <span class="scope">One project</span>
          </p>
        </li>

        <!-- ===== ONE PROJECT — BOOKS ===================================== -->

        <li class="item p-books s-one">
          <h3>Mark a preordered book as arrived</h3>
          <p>Preorders and crowdfunding pledges sit in the catalogue as promises. There is no way yet to say &ldquo;this one is on the shelf now&rdquo;, which is the single transition most of them are waiting on.</p>
          <p class="meta">
            <span class="tag t-books">Books</span>
            <span class="scope">One project</span>
          </p>
        </li>

        <li class="item p-books s-one">
          <h3>Four books still have no cover</h3>
          <p>A Paw Patrol board book, <em>Home Sweet Home</em>, a Korean Tinyping book and <em>The Nightmare Before Christmas</em>. No automatic source has an image for any of them, so each needs a link pasted in by hand.</p>
          <p class="meta">
            <span class="tag t-books">Books</span>
            <span class="scope">One project</span>
          </p>
        </li>

        <li class="item p-books s-one">
          <h3>Retire the old ebook import</h3>
          <p>Ebooks moved to their own shelf and live there now. The original copies are still sitting in the book library alongside the machinery that put them there, and both want clearing out carefully.</p>
          <p class="meta">
            <span class="tag t-books">Books</span>
            <span class="scope">One project</span>
          </p>
        </li>

        <li class="item p-books s-one">
          <h3>Check the series pages on a real phone</h3>
          <p>They were built and adjusted on a desktop screen. The reading order, the covers and the jump links all need looking at on a phone before they count as finished.</p>
          <p class="meta">
            <span class="tag t-books">Books</span>
            <span class="scope">One project</span>
          </p>
        </li>

        <li class="item p-books s-one">
          <h3>A second household&rsquo;s library, joined to ours</h3>
          <p>A friend&rsquo;s shelf already runs on the same software at its own address. Linking the two &mdash; so each can see what the other owns without merging the collections &mdash; is agreed and not yet built.</p>
          <p class="meta">
            <span class="tag t-books">Books</span>
            <span class="scope">One project</span>
          </p>
        </li>

        <!-- ===== ONE PROJECT — BOARD GAMES =============================== -->

        <li class="item p-games s-one">
          <h3>Fill in what is missing from each box</h3>
          <p>Player counts, playing time and weight are blank on a number of games. They are the fields the shelf is filtered by, so the gaps show up every time somebody looks for something to play.</p>
          <p class="meta">
            <span class="tag t-games">Board games</span>
            <span class="scope">One project</span>
          </p>
        </li>

        <li class="item p-games s-one">
          <h3>Read a wide shelf photograph more accurately</h3>
          <p>A photograph of a full shelf is read in one pass, and spines at the far edges are small and skewed. Splitting the picture up might read them better &mdash; worth measuring before it is worth building.</p>
          <p class="meta">
            <span class="tag t-games">Board games</span>
            <span class="scope">One project</span>
          </p>
        </li>

        <!-- ===== THE LANDING SITE ======================================== -->

        <li class="item p-landing s-landing">
          <h3>Pick one name for the front door</h3>
          <p>The site answers to more than one name today. Choosing the one that is meant to be typed, and pointing the rest at it, is a decision rather than a build.</p>
          <p class="meta">
            <span class="tag t-landing">Landing site</span>
            <span class="scope">This site</span>
          </p>
        </li>

        <li class="item p-landing s-landing">
          <h3>Decide whether <code>ebooks.heygabi.ai</code> should exist</h3>
          <p>The ebook shelf is reachable through the audiobook site today. Whether it deserves its own address, or stays where it is, is still open.</p>
          <p class="meta">
            <span class="tag t-landing">Landing site</span>
            <span class="scope">This site</span>
          </p>
        </li>

        <li class="item p-landing s-landing">
          <h3>Choose what is worth a notification</h3>
          <p>The estate can tell you when something finishes or goes wrong. Which of those are worth a buzz on your phone &mdash; and which should wait until you look &mdash; has not been decided.</p>
          <p class="meta">
            <span class="tag t-landing">Landing site</span>
            <span class="scope">This site</span>
          </p>
        </li>

      </ul>

      <p class="empty">Nothing on the board matches that filter right now. Choose <strong>Everything</strong> to see the whole list.</p>

    </div>
  </section>

  <footer class="rise" style="animation-delay:.18s">
    <p>Each project keeps its own full work log; this is the view across all of them, kept by hand. Finished work is deleted rather than crossed out.</p>
    <p>No accounts, no tracking and no cookies on this page &mdash; same as <a href="/">the front door</a>.</p>
  </footer>

</main>`;
