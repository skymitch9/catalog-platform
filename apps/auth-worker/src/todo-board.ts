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
          <p>&ldquo;Do we own this in any format?&rdquo; answered once, instead of three times. Needs a public, read-only projection out of each catalogue and a search box on the front door.</p>
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
          <p>Books and board games already share the same accounts and the same owner / manager / reader / waiting-list roles. The audiobook catalogue is the one left to bring across.</p>
          <p class="meta">
            <span class="tag t-audio">Audiobooks</span>
            <span class="tag t-books">Books</span>
            <span class="tag t-games">Board games</span>
            <span class="scope">All projects</span>
          </p>
        </li>

        <!-- ===== SOME PROJECTS =========================================== -->

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
          <h3>An ebooks view of the library</h3>
          <p>Print and ebook live in one catalogue on purpose. What is missing is the filter that shows just one of them &mdash; a link you can bookmark or pin to a home screen.</p>
          <p class="meta">
            <span class="tag t-books">Books</span>
            <span class="scope">One project</span>
          </p>
        </li>

        <li class="item p-books s-one">
          <h3>Twelve books still have no cover</h3>
          <p>Every automatic source has been tried and come back empty for these. Filling them needs a genuinely different source, not another pass over the same ones.</p>
          <p class="meta">
            <span class="tag t-books">Books</span>
            <span class="scope">One project</span>
          </p>
        </li>

        <li class="item p-books s-one">
          <h3>Five pledged books need creating by hand</h3>
          <p>A campaign&rsquo;s spelling of a title is exactly what mints a duplicate, so the importer deliberately never invents a book. These five have to exist first, then their pledges attach themselves.</p>
          <p class="meta">
            <span class="tag t-books">Books</span>
            <span class="scope">One project</span>
          </p>
        </li>

        <li class="item p-books s-one">
          <h3>Check the series pages on a real phone</h3>
          <p>The series list, the format chips and the newer panels have been built and read on a desktop. None of them has been looked at on a 390px screen, which is where they will actually be used.</p>
          <p class="meta">
            <span class="tag t-books">Books</span>
            <span class="scope">One project</span>
          </p>
        </li>

        <!-- ===== ONE PROJECT — BOARD GAMES =============================== -->

        <li class="item p-games s-one">
          <h3>Fill in what is missing from each box</h3>
          <p>&ldquo;Which pieces am I short?&rdquo; has no data behind it yet. A weekly job will fill it unattended; doing it by hand is only worth it to get the shopping list sooner.</p>
          <p class="meta">
            <span class="tag t-games">Board games</span>
            <span class="scope">One project</span>
          </p>
        </li>

        <li class="item p-games s-one">
          <h3>Count the Dice Throne playmats</h3>
          <p>Eleven are confirmed bought, twenty-one provably were not, and twenty-two came through a channel no pledge record can speak to. A physical count is the only thing that settles it.</p>
          <p class="meta">
            <span class="tag t-games">Board games</span>
            <span class="owner">Needs you</span>
            <span class="scope">One project</span>
          </p>
        </li>

        <li class="item p-games s-one">
          <h3>Name the HELLDIVERS 2 mystery box</h3>
          <p>A deliberate placeholder for content the campaign has not revealed. Rename it from whatever is actually in the box when it turns up.</p>
          <p class="meta">
            <span class="tag t-games">Board games</span>
            <span class="owner">Needs you</span>
            <span class="scope">One project</span>
          </p>
        </li>

        <!-- ===== ONE PROJECT — AUDIOBOOKS ================================ -->

        <li class="item p-audio s-one">
          <h3>Reading schedules for book clubs</h3>
          <p>Checkpoints with target dates, and an on-track or behind chip against them. The milestones already exist; what they lack is a calendar.</p>
          <p class="meta">
            <span class="tag t-audio">Audiobooks</span>
            <span class="scope">One project</span>
          </p>
        </li>

        <li class="item p-audio s-one">
          <h3>Announce club events to Discord</h3>
          <p>Comments already post through. Starting a book, finishing one and a new leader on the to-be-read list do not.</p>
          <p class="meta">
            <span class="tag t-audio">Audiobooks</span>
            <span class="scope">One project</span>
          </p>
        </li>

        <li class="item p-audio s-one">
          <h3>Polls inside a club</h3>
          <p>Free-form questions a club can vote on, taggable to a chapter so they sit behind the same spoiler shield as everything else.</p>
          <p class="meta">
            <span class="tag t-audio">Audiobooks</span>
            <span class="scope">One project</span>
          </p>
        </li>

        <!-- ===== THE LANDING SITE ======================================== -->

        <li class="item p-landing s-landing">
          <h3>Pick one name for the front door</h3>
          <p>Both <code>heygabi.ai</code> and <code>www.heygabi.ai</code> serve this page today. One of them should redirect to the other; the recommendation is the bare name, because every catalogue is a subdomain of it.</p>
          <p class="meta">
            <span class="tag t-landing">Landing site</span>
            <span class="owner">Needs you</span>
            <span class="scope">Landing site</span>
          </p>
        </li>

        <li class="item p-landing s-landing">
          <h3>Decide whether <code>ebooks.heygabi.ai</code> should exist</h3>
          <p>Only ever as a redirect into the library&rsquo;s ebook view &mdash; never as a second app. It is free and reversible, and it is also one more name to remember.</p>
          <p class="meta">
            <span class="tag t-landing">Landing site</span>
            <span class="owner">Needs you</span>
            <span class="scope">Landing site</span>
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
