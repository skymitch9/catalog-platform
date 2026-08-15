/**
 * estate-search.js — <estate-search>: the ONE reusable cross-catalog search
 * component (search-normalization phase 1, docs/TODO.md item 0, owner-
 * adopted 2026-08-15). Framework-agnostic custom element, no build step,
 * Shadow DOM for style isolation — same "browser-native, no build, no
 * bundler" precedent as estate-auth.js and theme.js.
 *
 * EXTRACTED FROM find.js (heygabi-home's front-door search): this file IS
 * find.js's behavior, turned into a configurable custom element, so a search
 * improvement made HERE reaches every site that embeds the tag instead of
 * dying at the apex the way every previous find.js fix has. The apex itself
 * now consumes this file (see index.html) rather than carrying its own copy
 * of the logic — one implementation, not a fork.
 *
 * WHY a custom element and not a framework component: three of the four
 * consuming sites are plain HTML/JS (apex, audiobook, /universes) and two are
 * React (library, games) — a vanilla element with attributes/properties is
 * the one shape every one of them can consume, directly or through a two-line
 * wrapper.
 *
 * ---------------------------------------------------------------------------
 * CONFIGURATION — attributes (kebab-case) each mirrored by a JS property
 * (camelCase); properties always win when both are set.
 * ---------------------------------------------------------------------------
 *   index-url      The index Worker origin. Default 'https://index.heygabi.ai'.
 *   source         Scope preset: 'all' | 'audiobook' | 'library' | 'game'.
 *                  Sent to GET /api/search as &source=… (search-route.ts,
 *                  added for this component). It can only NARROW the
 *                  caller's own visibility, never widen it — an authless
 *                  library-scoped box searches nothing, because anonymous
 *                  visibility is {audiobook} only (estate design §4.5).
 *                  Default 'all'.
 *   auth           'authless' (default) | 'authed'.
 *                    authless — every query goes tokenless, forever: the
 *                      public audiobook slice, zero setup, no Firebase cost.
 *                      Nothing is ever imported beyond this file.
 *                    authed — wires the neutral-boot / sign-in / bearer-token
 *                      pattern find.js pioneered, via a DYNAMICALLY imported
 *                      auth adapter module (see auth-module) — never a static
 *                      import, so authless embeds never pay for Firebase.
 *   auth-module    Path to the adapter module, imported only when
 *                  auth="authed" and no .authAdapter property is set. Must
 *                  export the estate-auth.js surface: watchAuth, idToken,
 *                  signIn, signOutUser, handleRedirectResult. Default:
 *                  'estate-auth.js' resolved NEXT TO THIS FILE
 *                  (import.meta.url) — the sync scripts' own precedent is to
 *                  vendor sibling assets together (sync-estate-theme.mjs),
 *                  so a site that copies both files this way gets a working
 *                  default for free.
 *   min-chars      Minimum query length before a search fires. Default 2.
 *   debounce-ms    Debounce delay in ms. Default 250.
 *   placeholder    Input placeholder once ready (authless-ready, or signed
 *                  out once auth resolves). Default: find.js's own copy.
 *   placeholder-authed  Input placeholder once signed in (authed mode only).
 *   sign-in-label  Text on the sign-in button (authed mode only).
 *   hint           The helper line under the box. Omit the attribute (rather
 *                  than passing empty) to keep find.js's own copy; pass an
 *                  empty string explicitly to hide the line.
 *   universes      'true' (default) | 'false' — show the cross-catalog
 *                  "Universes" result group and "everything in X →" follow-
 *                  up buttons. /api/universe stays members-only server-side
 *                  regardless; authless/signed-out callers get the sign-in
 *                  invitation, unchanged from find.js. Also gates
 *                  `universeSuggestions` rendering (see below) — one flag,
 *                  both surfaces, since they share the exact idiom.
 *
 * PROPERTIES (JS-only — for callback/object config no attribute can carry)
 *   .intakeFilter(data, { kind }) → data
 *       Per-site INTAKE FILTER hook: called on every parsed /api/search or
 *       /api/universe response before render (kind: 'search' | 'universe'),
 *       so a host page can narrow further — e.g. a library app dropping
 *       non-library entries out of a same-work group, or a per-format filter
 *       — without forking the component. Return the data to render (mutate
 *       in place and return it, or return a replacement). Identity by
 *       default.
 *   .authAdapter = { watchAuth, idToken, signIn, signOutUser,
 *       handleRedirectResult }
 *       Set directly to skip the dynamic import entirely — for a host that
 *       already has an estate-auth-shaped module loaded (e.g. a React app
 *       importing it as a normal module dependency).
 *
 * EVENTS (bubbles: true, composed: true — cross the shadow boundary)
 *   'estate-search:auth'    detail: { user, resolved } — fires once auth
 *       state is known, and again on every change. authed mode only.
 *   'estate-search:select'  detail: { url, hit }, CANCELABLE — fired instead
 *       of the default `window.open(url, '_blank', 'noopener')` whenever a
 *       result would open (Enter, click, or a card's own link). Call
 *       preventDefault() to take over navigation (an SPA router, for
 *       instance) — the component does nothing else once prevented.
 *
 * WHAT IS PRESERVED FROM find.js, VERBATIM (do not re-derive, do not "fix"):
 *   - the sign-in flash fix: neutral boot (disabled input, hidden buttons)
 *     until watchAuth's first callback, 8s backstop (authed mode);
 *   - §4.5's anonymous rule: signed out (or authless) searches go tokenless
 *     and the server answers the public slice — never disabled, never a 401;
 *   - the debounced-abortable query pattern (AbortController, 250ms pause,
 *     an aborted request renders nothing — a newer keystroke always wins);
 *   - ranked-group rendering (books = same-work groups, games = individual
 *     rows, universes = follow-up buttons) and the "in catalog, not owned"
 *     caveat copy — load-bearing, per find.js's own header, unchanged here;
 *   - full keyboard nav (↑/↓/Enter/Escape, aria-activedescendant / aria-
 *     selected, role="combobox"/"listbox"/"option").
 *
 * ADDED SINCE (four owner-ordered upgrades, this pass):
 *   - accessories de-clutter (task 1): `_renderUniverse` splits game rows by
 *     kind — base/expansion stay in "Games", kind='accessory'/'promo' collapse
 *     into a collapsed-by-default `_accessoriesDetails()` subsection. The
 *     RANKING half (accessories/promos sorting below books/audiobooks/base-
 *     expansion games) is server-side, in index-worker's search.ts — this
 *     component inherits it for free by rendering server order unchanged;
 *   - member-implied universe autofill (task 4): `_renderSearch` merges the
 *     server's additive `data.universeSuggestions` into the same "Universes"
 *     group as `data.universes` — the server already excludes any name the
 *     query text itself matched, so the merge needs no client-side dedup.
 *
 * NOT ported: the apex's approver-probe "Admin" chip (find.js's
 * probeApprover()). That is heygabi-home-specific admin surface, not a
 * generic search behavior — baking it in here would make every future
 * consumer carry an apex opinion. The apex keeps it as a thin adapter that
 * listens for 'estate-search:auth' (see index.html) instead.
 */

(function () {
  'use strict';

  const DEFAULT_INDEX_ORIGIN = 'https://index.heygabi.ai';
  const DEFAULT_DEBOUNCE_MS = 250;
  const DEFAULT_MIN_CHARS = 2;
  const AUTH_BACKSTOP_MS = 8000;
  const FULL_SCOPE_SIZE = 3;

  const SOURCE_LABELS = { game: 'board games', library: 'library', audiobook: 'audiobooks' };
  /** The server's scope vocabulary (§4.5 catalogs), spoken like a person. */
  const SCOPE_LABELS = { audiobook: 'audiobooks', library: 'the library', games: 'board games' };

  const DEFAULT_PLACEHOLDER_ANON = 'Search the audiobook shelf…';
  const DEFAULT_PLACEHOLDER_AUTHED = 'Start typing a title, author or series…';
  const DEFAULT_SIGNIN_LABEL = 'Sign in to search everything';
  const DEFAULT_HINT =
    '“Do we own this in any format?” — one title, checked against every shelf at once.';

  const TEMPLATE = document.createElement('template');
  TEMPLATE.innerHTML = `
    <style>
      :host { display: block; }
      .es-box {
        padding: 1rem 1.15rem 1.1rem;
        border: 1px solid var(--et-hairline);
        border-radius: var(--et-radius-lg);
        background: color-mix(in srgb, var(--et-surface) 65%, transparent);
      }
      .es-form { display: flex; gap: .6rem; align-items: stretch; flex-wrap: wrap; }
      .es-input {
        flex: 1 1 14rem;
        min-height: 44px;
        padding: .5rem .85rem;
        border: 1px solid var(--et-field-border, var(--et-hairline));
        border-radius: var(--et-radius);
        background: var(--et-surface);
        color: var(--et-fg);
        font: inherit;
      }
      .es-input::placeholder { color: var(--et-muted); }
      .es-input:focus-visible { outline: 2px solid var(--et-accent); outline-offset: 1px; }
      .es-input:disabled { opacity: .6; }
      .es-btn {
        min-height: 44px;
        padding: .5rem 1.05rem;
        border: var(--et-btn-border);
        border-radius: var(--et-radius);
        background: var(--et-btn-bg);
        color: var(--et-btn-fg);
        box-shadow: var(--et-btn-shadow);
        font: inherit;
        font-weight: 600;
        cursor: pointer;
      }
      .es-btn:hover { filter: brightness(1.06); }
      .es-btn:active { transform: var(--et-press); }
      .es-btn:focus-visible { outline: 2px solid var(--et-accent); outline-offset: 2px; }
      .es-btn:disabled { opacity: .6; cursor: default; transform: none; }
      .es-hint { margin: .6rem 0 0; color: var(--et-muted); font-size: var(--et-text-small); text-wrap: pretty; }
      .es-who { margin: .6rem 0 0; color: var(--et-muted); font-size: var(--et-text-small); }
      .es-linkbtn {
        border: 0; padding: 0; min-height: 0; background: none;
        color: var(--et-accent); font: inherit; font-size: inherit; font-weight: 600;
        cursor: pointer; text-decoration: underline;
      }
      .es-linkbtn:focus-visible { outline: 2px solid var(--et-accent); outline-offset: 2px; border-radius: 4px; }
      .es-status {
        margin: .8rem 0 0; padding: .6rem .85rem;
        border: 1px solid var(--et-hairline); border-radius: var(--et-radius);
        background: color-mix(in srgb, var(--et-surface) 55%, transparent);
        color: var(--et-muted); font-size: var(--et-text-small); text-wrap: pretty;
      }
      .es-status[data-tone="warn"] { border-color: color-mix(in srgb, var(--et-danger) 45%, var(--et-hairline)); color: var(--et-fg); }
      .es-status[data-tone="owner"] { border-color: color-mix(in srgb, var(--et-accent-2) 55%, var(--et-hairline)); color: var(--et-fg); }
      .es-caveat { margin: 1rem 0 .3rem; color: var(--et-muted); font-size: var(--et-text-small); text-wrap: pretty; }
      .es-group {
        margin: 1rem 0 .5rem; font-size: var(--et-text-micro); font-weight: 700;
        letter-spacing: .1em; text-transform: uppercase; color: var(--et-muted);
      }
      /* Accessories de-clutter (task 1): a native <details>, collapsed by
         default — the universe expansion view groups kind='accessory'/'promo'
         rows here instead of the plain .es-group list. */
      details.es-accessories { margin: 1rem 0 .5rem; }
      details.es-accessories > summary {
        cursor: pointer; margin: 0; font-size: var(--et-text-micro); font-weight: 700;
        letter-spacing: .1em; text-transform: uppercase; color: var(--et-muted);
      }
      details.es-accessories > summary:hover { color: var(--et-accent); }
      details.es-accessories > summary:focus-visible { outline: 2px solid var(--et-accent); outline-offset: 2px; }
      details.es-accessories > .es-hits { margin-top: .5rem; }
      .es-hits { list-style: none; margin: 0; padding: 0; display: grid; gap: .5rem; }
      .es-hit {
        display: flex; gap: .8rem; align-items: flex-start;
        padding: .65rem .75rem; border: 1px solid var(--et-hairline);
        border-radius: var(--et-radius); background: var(--et-surface);
      }
      .es-hit[aria-selected="true"] { border-color: var(--et-accent); outline: 1px solid var(--et-accent); }
      .es-hit-cover {
        flex: none; display: block; width: 2.6rem; height: 3.6rem;
        border-radius: calc(var(--et-radius) / 2); border: 1px solid var(--et-hairline);
        background: var(--et-bg); overflow: hidden;
      }
      .es-hit-cover img { display: block; width: 100%; height: 100%; object-fit: cover; }
      .es-hit-body { display: flex; flex-direction: column; gap: .15rem; min-width: 0; }
      .es-hit-title { font-weight: 600; }
      .es-hit-title a { color: var(--et-fg); text-decoration: none; }
      .es-hit-title a:hover { color: var(--et-accent); text-decoration: underline; }
      .es-hit-meta { color: var(--et-muted); font-size: var(--et-text-small); }
      .es-hit-meta a { color: var(--et-accent); font-weight: 600; text-decoration: none; }
      .es-hit-meta a:hover { text-decoration: underline; }
      .es-hit-universe { align-self: flex-start; font-size: var(--et-text-small); margin-top: .15rem; }
    </style>
    <div class="es-box">
      <form class="es-form">
        <input class="es-input" type="search" placeholder="One moment…" autocomplete="off" disabled aria-label="Search the catalogues by title">
        <button class="es-btn es-submit" type="submit" hidden>Search</button>
        <button class="es-btn es-signin" type="button" hidden>Sign in to search everything</button>
      </form>
      <p class="es-hint"></p>
      <p class="es-who" hidden></p>
      <p class="es-status" hidden></p>
      <div class="es-results"></div>
    </div>
  `;

  /**
   * The signed-in "who" line supports ONE extension point: a light-DOM child
   * carrying slot="who-extra" (e.g. `<span slot="who-extra" hidden> ·
   * <a href="/admin">Admin</a></span>`) renders right after "Signed in as …
   * · sign out". This is how the apex adds its approver-only Admin chip
   * (find.js's probeApprover()) without the component knowing "Admin" is a
   * concept — a host-page adapter toggles the slotted element's `hidden`.
   * Unused by a host that supplies no such child; nothing renders.
   */

  class EstateSearch extends HTMLElement {
    static get observedAttributes() {
      return [
        'index-url', 'source', 'auth', 'auth-module', 'min-chars', 'debounce-ms',
        'placeholder', 'placeholder-authed', 'sign-in-label', 'hint', 'universes',
      ];
    }

    constructor() {
      super();
      this.attachShadow({ mode: 'open' });
      this.shadowRoot.appendChild(TEMPLATE.content.cloneNode(true));

      this.intakeFilter = null;
      this.authAdapter = null;

      this._currentUser = null;
      this._authResolved = false;
      this._authBackstop = null;
      this._isApprover = false; // unused by this component; kept for host adapters that peek at internals

      this._navItems = [];
      this._activeIndex = -1;
      this._debounceTimer = 0;
      this._inflight = null;

      this._onInput = this._onInput.bind(this);
      this._onKeydown = this._onKeydown.bind(this);
      this._onSubmit = this._onSubmit.bind(this);
      this._onSigninClick = this._onSigninClick.bind(this);
    }

    // -- config -----------------------------------------------------------

    get indexUrl() { return this.getAttribute('index-url') || DEFAULT_INDEX_ORIGIN; }
    get sourcePreset() {
      const v = (this.getAttribute('source') || 'all').trim().toLowerCase();
      return v === '' ? 'all' : v;
    }
    get authMode() {
      const v = (this.getAttribute('auth') || 'authless').trim().toLowerCase();
      return v === 'authed' ? 'authed' : 'authless';
    }
    get authModulePath() { return this.getAttribute('auth-module') || null; }
    get minChars() {
      const n = parseInt(this.getAttribute('min-chars'), 10);
      return Number.isFinite(n) && n > 0 ? n : DEFAULT_MIN_CHARS;
    }
    get debounceMs() {
      const n = parseInt(this.getAttribute('debounce-ms'), 10);
      return Number.isFinite(n) && n >= 0 ? n : DEFAULT_DEBOUNCE_MS;
    }
    get showUniverses() { return this.getAttribute('universes') !== 'false'; }

    // -- lifecycle ----------------------------------------------------------

    connectedCallback() {
      const root = this.shadowRoot;
      this._form = root.querySelector('.es-form');
      this._input = root.querySelector('.es-input');
      this._submitBtn = root.querySelector('.es-submit');
      this._signinBtn = root.querySelector('.es-signin');
      this._hintEl = root.querySelector('.es-hint');
      this._whoEl = root.querySelector('.es-who');
      this._statusEl = root.querySelector('.es-status');
      this._resultsEl = root.querySelector('.es-results');

      this._input.setAttribute('role', 'combobox');
      this._input.setAttribute('aria-autocomplete', 'list');
      this._input.setAttribute('aria-expanded', 'false');
      this._resultsEl.setAttribute('role', 'listbox');
      this._resultsEl.setAttribute('aria-label', 'Search results');

      const hintAttr = this.getAttribute('hint');
      this._hintEl.textContent = hintAttr !== null ? hintAttr : DEFAULT_HINT;
      if (this._hintEl.textContent === '') this._hintEl.hidden = true;

      this._input.addEventListener('input', this._onInput);
      this._input.addEventListener('keydown', this._onKeydown);
      this._form.addEventListener('submit', this._onSubmit);
      this._signinBtn.addEventListener('click', this._onSigninClick);
      this._signinBtn.textContent = this.getAttribute('sign-in-label') || DEFAULT_SIGNIN_LABEL;

      if (this.authMode === 'authed') {
        this._bootAuthed();
      } else {
        this._authResolved = true;
        this._renderAuthState();
      }
    }

    disconnectedCallback() {
      if (this._authBackstop) clearTimeout(this._authBackstop);
      if (this._inflight) this._inflight.abort();
      clearTimeout(this._debounceTimer);
    }

    attributeChangedCallback(name) {
      if (!this.shadowRoot || !this._input) return; // before connectedCallback finishes
      if (name === 'sign-in-label' && this._signinBtn) {
        this._signinBtn.textContent = this.getAttribute('sign-in-label') || DEFAULT_SIGNIN_LABEL;
      }
      if (name === 'hint' && this._hintEl) {
        const hintAttr = this.getAttribute('hint');
        this._hintEl.textContent = hintAttr !== null ? hintAttr : DEFAULT_HINT;
        this._hintEl.hidden = this._hintEl.textContent === '';
      }
      if (name === 'placeholder' || name === 'placeholder-authed') {
        this._renderAuthState();
      }
    }

    // -- auth (authed mode only) --------------------------------------------

    /**
     * ⚠️ THE SIGN-IN FLASH FIX, preserved verbatim (owner-found, find.js,
     * 2026-08-14): Firebase reads its persisted session ASYNCHRONOUSLY, so a
     * component that renders signed-out immediately shows a returning member
     * "sign in" for however long the SDK takes. The box boots NEUTRAL
     * (disabled, both buttons hidden) and renders nothing decisive until the
     * adapter's watchAuth FIRST callback. The backstop below is only for the
     * adapter never answering at all (blocked script, dead network).
     */
    async _bootAuthed() {
      this._authBackstop = setTimeout(() => {
        if (!this._authResolved) {
          this._authResolved = true;
          this._renderAuthState();
        }
      }, AUTH_BACKSTOP_MS);

      let adapter = this.authAdapter;
      if (!adapter) {
        try {
          const path = this.authModulePath || new URL('estate-auth.js', import.meta.url).href;
          adapter = await import(/* @vite-ignore */ path);
          this.authAdapter = adapter;
        } catch (e) {
          console.warn('[estate-search] auth adapter failed to load; falling back to authless behavior:', e);
          clearTimeout(this._authBackstop);
          this._authResolved = true;
          this._renderAuthState();
          return;
        }
      }

      adapter.watchAuth((user) => {
        this._authResolved = true;
        clearTimeout(this._authBackstop);
        const changed = this._currentUser !== user;
        this._currentUser = user;
        this._renderAuthState();
        this.dispatchEvent(new CustomEvent('estate-search:auth', {
          bubbles: true, composed: true, detail: { user, resolved: true },
        }));
        // Crossing the sign-in boundary changes the scope: re-run a standing
        // query so results widen (or narrow) without a re-type.
        if (changed && this._input.value.trim().length >= this.minChars) this._scheduleSearch();
      });

      if (typeof adapter.handleRedirectResult === 'function') {
        adapter.handleRedirectResult().then((err) => {
          if (err) this._setStatus(err, err.includes('authorised domain') ? 'owner' : 'warn');
        });
      }
    }

    async _idToken() {
      if (this.authMode !== 'authed' || !this._currentUser || !this.authAdapter) return null;
      return this.authAdapter.idToken();
    }

    // -- UI state -------------------------------------------------------------

    _setStatus(text, tone) {
      this._statusEl.textContent = text || '';
      this._statusEl.dataset.tone = tone || '';
      this._statusEl.hidden = !text;
    }

    _renderAuthState() {
      const input = this._input;
      if (this.authMode === 'authed' && !this._authResolved) {
        // Neutral: no claim either way until the adapter answers.
        input.disabled = true;
        input.placeholder = 'One moment…';
        this._submitBtn.hidden = true;
        this._signinBtn.hidden = true;
        this._whoEl.hidden = true;
        return;
      }
      const signedIn = this.authMode === 'authed' && this._currentUser !== null;
      // §4.5: the box works for EVERYONE — signed out (or authless) it
      // searches the public slice, so it is never disabled once ready.
      input.disabled = false;
      this._submitBtn.hidden = false;
      this._signinBtn.hidden = signedIn || this.authMode !== 'authed';
      if (signedIn) {
        this._whoEl.innerHTML = '';
        const name = document.createElement('span');
        name.textContent = this._currentUser.displayName || this._currentUser.email;
        const out = document.createElement('button');
        out.type = 'button';
        out.className = 'es-linkbtn';
        out.textContent = 'sign out';
        out.addEventListener('click', async () => {
          if (this.authAdapter && this.authAdapter.signOutUser) await this.authAdapter.signOutUser();
          this._clearResults();
          this._setStatus('');
        });
        this._whoEl.append('Signed in as ', name, ' · ', out);
        const slot = document.createElement('slot');
        slot.name = 'who-extra';
        this._whoEl.appendChild(slot);
        this._whoEl.hidden = false;
        input.placeholder = this.getAttribute('placeholder-authed') || DEFAULT_PLACEHOLDER_AUTHED;
      } else {
        this._whoEl.hidden = true;
        this._whoEl.innerHTML = '';
        input.placeholder = this.getAttribute('placeholder') || DEFAULT_PLACEHOLDER_ANON;
      }
    }

    // -- results + keyboard nav ----------------------------------------------

    _clearResults() {
      this._resultsEl.innerHTML = '';
      this._navItems = [];
      this._activeIndex = -1;
      this._input.removeAttribute('aria-activedescendant');
      this._input.setAttribute('aria-expanded', 'false');
    }

    _setActive(i) {
      if (this._activeIndex >= 0 && this._navItems[this._activeIndex]) {
        this._navItems[this._activeIndex].el.setAttribute('aria-selected', 'false');
      }
      this._activeIndex = i;
      const item = this._navItems[i];
      if (i >= 0 && item) {
        item.el.setAttribute('aria-selected', 'true');
        this._input.setAttribute('aria-activedescendant', item.el.id);
        item.el.scrollIntoView({ block: 'nearest' });
      } else {
        this._input.removeAttribute('aria-activedescendant');
      }
    }

    _registerNav(el, open) {
      el.id = `es-opt-${this._instanceId()}-${this._navItems.length}`;
      el.setAttribute('role', 'option');
      el.setAttribute('aria-selected', 'false');
      this._navItems.push({ el, open });
    }

    _instanceId() {
      if (!this.__iid) this.__iid = Math.random().toString(36).slice(2, 8);
      return this.__iid;
    }

    _sourceLabel(source) { return SOURCE_LABELS[source] || source; }

    _scopePhrase(scope) { return scope.map((c) => SCOPE_LABELS[c] || c).join(' and '); }

    _scopeNote(scope) {
      if (!Array.isArray(scope) || scope.length === 0 || scope.length >= FULL_SCOPE_SIZE) return null;
      const p = document.createElement('p');
      p.className = 'es-caveat';
      p.setAttribute('role', 'presentation');
      p.textContent = `Searching ${this._scopePhrase(scope)} only.` +
        (this._currentUser ? '' : ' Sign in to search every shelf.');
      return p;
    }

    _openHit(url, hit) {
      const evt = new CustomEvent('estate-search:select', {
        bubbles: true, composed: true, cancelable: true, detail: { url, hit },
      });
      const proceed = this.dispatchEvent(evt);
      if (proceed && url) window.open(url, '_blank', 'noopener');
    }

    _metaBits(row) {
      const bits = [];
      if (row.creator) bits.push(row.creator);
      bits.push(row.format);
      if (row.kind && row.kind !== 'base') bits.push(row.kind);
      if (row.parent_source_id) bits.push('belongs with a base game');
      if (row.series) bits.push(row.series_index != null ? `${row.series} #${row.series_index}` : row.series);
      if (row.year) bits.push(String(row.year));
      if (row.publisher) bits.push(row.publisher);
      return bits.join(' · ');
    }

    _coverFor(li, row) {
      const box = document.createElement('span');
      box.className = 'es-hit-cover';
      box.setAttribute('aria-hidden', 'true');
      if (row && row.cover_url) {
        const img = document.createElement('img');
        img.alt = '';
        img.loading = 'lazy';
        img.width = 42;
        img.height = 58;
        img.src = row.cover_url;
        img.addEventListener('error', () => img.remove());
        box.appendChild(img);
      }
      li.appendChild(box);
    }

    _rowCard(row) {
      const li = document.createElement('li');
      li.className = 'es-hit';
      this._coverFor(li, row);

      const body = document.createElement('div');
      body.className = 'es-hit-body';

      const title = document.createElement('span');
      title.className = 'es-hit-title';
      if (row.detail_url) {
        const a = document.createElement('a');
        a.href = row.detail_url;
        a.target = '_blank';
        a.rel = 'noopener';
        a.textContent = row.title;
        a.addEventListener('click', (e) => {
          e.preventDefault();
          this._openHit(row.detail_url, row);
        });
        title.appendChild(a);
      } else {
        title.textContent = row.title;
      }
      body.appendChild(title);

      const meta = document.createElement('span');
      meta.className = 'es-hit-meta';
      meta.textContent = this._metaBits(row);
      body.appendChild(meta);

      if (row.universe && this.showUniverses) {
        const uni = document.createElement('button');
        uni.type = 'button';
        uni.className = 'es-linkbtn es-hit-universe';
        uni.textContent = `everything in ${row.universe} →`;
        uni.addEventListener('click', () => this._runUniverse(row.universe));
        body.appendChild(uni);
      }

      li.appendChild(body);
      this._registerNav(li, () => this._openHit(row.detail_url, row));
      return li;
    }

    _workCard(hit) {
      const li = document.createElement('li');
      li.className = 'es-hit';
      this._coverFor(li, hit.entries.find((e) => e.cover_url) || null);

      const body = document.createElement('div');
      body.className = 'es-hit-body';

      const title = document.createElement('span');
      title.className = 'es-hit-title';
      title.textContent = hit.title;
      body.appendChild(title);

      const meta = document.createElement('span');
      meta.className = 'es-hit-meta';
      meta.textContent = hit.creator || '';
      if (meta.textContent) body.appendChild(meta);

      const formats = document.createElement('span');
      formats.className = 'es-hit-meta';
      hit.entries.forEach((e, i) => {
        if (i > 0) formats.append(' · ');
        const label = `${this._sourceLabel(e.source)}: ${e.format}`;
        if (e.detail_url) {
          const a = document.createElement('a');
          a.href = e.detail_url;
          a.target = '_blank';
          a.rel = 'noopener';
          a.textContent = label;
          a.addEventListener('click', (ev) => {
            ev.preventDefault();
            this._openHit(e.detail_url, e);
          });
          formats.appendChild(a);
        } else {
          formats.append(label);
        }
      });
      body.appendChild(formats);

      const withUniverse = hit.entries.find((e) => e.universe);
      if (withUniverse && this.showUniverses) {
        const uni = document.createElement('button');
        uni.type = 'button';
        uni.className = 'es-linkbtn es-hit-universe';
        uni.textContent = `everything in ${withUniverse.universe} →`;
        uni.addEventListener('click', () => this._runUniverse(withUniverse.universe));
        body.appendChild(uni);
      }

      li.appendChild(body);
      const first = hit.entries.find((e) => e.detail_url);
      this._registerNav(li, () => this._openHit(first ? first.detail_url : null, first));
      return li;
    }

    _groupHeading(text) {
      const h = document.createElement('h3');
      h.className = 'es-group';
      h.setAttribute('role', 'presentation');
      h.textContent = text;
      return h;
    }

    /** kind='accessory'/'promo' — the accessories de-clutter (owner: "make
     * accessories a sub category in a universe page"). Always present, just
     * collapsed and out of the way; no include-checkbox. */
    _isAccessoryOrPromo(row) {
      return row.kind === 'accessory' || row.kind === 'promo';
    }

    /** A native <details>, COLLAPSED BY DEFAULT (no `open` attribute). */
    _accessoriesDetails(rows) {
      const details = document.createElement('details');
      details.className = 'es-accessories';
      const summary = document.createElement('summary');
      summary.textContent = `Accessories & promos (${rows.length})`;
      details.appendChild(summary);
      const ul = document.createElement('ul');
      ul.className = 'es-hits';
      ul.setAttribute('role', 'presentation');
      for (const row of rows) ul.appendChild(this._rowCard(row));
      details.appendChild(ul);
      return details;
    }

    _caveatLine(headingText) {
      const heading = document.createElement('p');
      heading.className = 'es-caveat';
      heading.setAttribute('role', 'presentation');
      // ⚠ Load-bearing copy (find.js's own header): in-catalog, not owned.
      heading.textContent =
        `${headingText} A result means it is in the catalog — some entries are wanted, not owned. ` +
        'Tap through to the owning catalog for owned-versus-wanted.';
      return heading;
    }

    _renderSearch(data) {
      this._clearResults();

      if (data.reason === 'no_catalogs_visible') {
        this._setStatus('Your account currently has no catalogs to search. An approver can restore them.', 'warn');
        return;
      }

      // MEMBER-IMPLIED UNIVERSE AUTOFILL (task 4): `universeSuggestions` is
      // additive to `universes` — the server already excludes any name the
      // query itself matched, so the two arrays never overlap and can be
      // rendered as one combined list, same row idiom, no dedup needed here.
      const universeRows = this.showUniverses
        ? [...data.universes, ...(data.universeSuggestions || [])]
        : [];
      const total = data.books.length + data.games.length + universeRows.length;
      if (total === 0) {
        const where = Array.isArray(data.scope) && data.scope.length < FULL_SCOPE_SIZE
          ? `in ${this._scopePhrase(data.scope)}` : 'on any shelf';
        this._setStatus(
          `Nothing ${where} matches “${data.query}”. The search tries titles, authors and series — a couple more letters can help.` +
          (this._currentUser || !Array.isArray(data.scope) || data.scope.length >= FULL_SCOPE_SIZE
            ? '' : ' Signing in searches every shelf.'),
        );
        return;
      }
      this._setStatus('');
      this._input.setAttribute('aria-expanded', 'true');

      this._resultsEl.appendChild(this._caveatLine(`Matches for “${data.query}”.`));
      const note = this._scopeNote(data.scope);
      if (note) this._resultsEl.appendChild(note);

      if (universeRows.length) {
        this._resultsEl.appendChild(this._groupHeading('Universes — every catalog, every format'));
        const ul = document.createElement('ul');
        ul.className = 'es-hits';
        ul.setAttribute('role', 'presentation');
        for (const u of universeRows) {
          const li = document.createElement('li');
          li.className = 'es-hit';
          const body = document.createElement('div');
          body.className = 'es-hit-body';
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'es-linkbtn es-hit-universe';
          btn.textContent = `everything in ${u.name} (${u.count}) →`;
          btn.addEventListener('click', () => this._runUniverse(u.name));
          body.appendChild(btn);
          li.appendChild(body);
          this._registerNav(li, () => this._runUniverse(u.name));
          ul.appendChild(li);
        }
        this._resultsEl.appendChild(ul);
      }

      if (data.books.length) {
        this._resultsEl.appendChild(this._groupHeading('Books & audiobooks — same work, any format'));
        const ul = document.createElement('ul');
        ul.className = 'es-hits';
        ul.setAttribute('role', 'presentation');
        for (const hit of data.books) ul.appendChild(this._workCard(hit));
        this._resultsEl.appendChild(ul);
      }

      if (data.games.length) {
        this._resultsEl.appendChild(this._groupHeading('Board games — matched on title'));
        const ul = document.createElement('ul');
        ul.className = 'es-hits';
        ul.setAttribute('role', 'presentation');
        for (const hit of data.games) ul.appendChild(this._rowCard(hit));
        this._resultsEl.appendChild(ul);
      }
    }

    _renderUniverse(data) {
      this._clearResults();

      if (!data.matches.length) {
        this._setStatus(`Nothing in any catalog sits in ${data.universe} right now.`);
        return;
      }
      this._setStatus('');
      this._input.setAttribute('aria-expanded', 'true');

      this._resultsEl.appendChild(this._caveatLine(`Everything in ${data.universe} — every catalog, every format.`));

      // Accessories de-clutter (task 1): base/expansion games render in
      // "Games" as before; kind='accessory'/'promo' collapse into a
      // collapsed-by-default details subsection, out of the main list.
      const bookRows = data.matches.filter((m) => m.source === 'library' || m.source === 'audiobook');
      const gameRows = data.matches.filter((m) => m.source === 'game');
      const games = gameRows.filter((m) => !this._isAccessoryOrPromo(m));
      const accessories = gameRows.filter((m) => this._isAccessoryOrPromo(m));

      const groups = [
        { name: 'Books & audiobooks', rows: bookRows },
        { name: 'Games', rows: games },
      ];
      for (const g of groups) {
        if (!g.rows.length) continue;
        this._resultsEl.appendChild(this._groupHeading(g.name));
        const ul = document.createElement('ul');
        ul.className = 'es-hits';
        ul.setAttribute('role', 'presentation');
        for (const row of g.rows) ul.appendChild(this._rowCard(row));
        this._resultsEl.appendChild(ul);
      }
      if (accessories.length) this._resultsEl.appendChild(this._accessoriesDetails(accessories));
    }

    // -- queries: debounced, abortable ---------------------------------------

    async _callIndex(path, signal) {
      // Signed out (or authless), the request goes TOKENLESS on purpose —
      // §4.5's anonymous rule answers with the public slice server-side.
      const headers = {};
      if (this.authMode === 'authed' && this._currentUser) {
        const token = await this._idToken();
        if (!token) {
          this._setStatus('Your sign-in has lapsed — sign in again.', 'warn');
          return null;
        }
        headers.authorization = `Bearer ${token}`;
      }
      let res;
      try {
        res = await fetch(`${this.indexUrl}${path}`, { headers, signal });
      } catch (e) {
        if (e && e.name === 'AbortError') return { aborted: true };
        this._setStatus('The index did not answer (network). Try again shortly.', 'warn');
        return null;
      }

      if (res.ok) return res.json();

      let body = null;
      try { body = await res.json(); } catch (e) { /* non-JSON error body; the status still speaks */ }

      switch (body?.error) {
        case 'estate_pending':
          this._setStatus('Your account is awaiting approval. An approver admits new members; nothing more for you to do.', 'warn');
          break;
        case 'estate_revoked':
          this._setStatus('Your access has been revoked.', 'warn');
          break;
        case 'estate_unreachable':
          this._setStatus('The estate directory did not answer, so new admissions cannot be checked right now. Try again shortly.', 'warn');
          break;
        case 'query_too_short':
          break; // the client already gates at minChars; stay quiet mid-keystroke
        case 'unfoldable_query':
          this._setStatus('That title cannot be key-matched (it folds to nothing — wholly non-Latin or punctuation-only titles do this). Browse the owning catalog instead.', 'warn');
          break;
        case 'unauthenticated':
          this._setStatus('The index did not accept the sign-in token. Sign out and back in.', 'warn');
          break;
        default:
          this._setStatus(`Search failed (${res.status}${body?.error ? `: ${body.error}` : ''}).`, 'warn');
      }
      return null;
    }

    _searchPath(q) {
      const params = new URLSearchParams({ q });
      if (this.sourcePreset !== 'all') params.set('source', this.sourcePreset);
      return `/api/search?${params.toString()}`;
    }

    async _runSearch(q) {
      if (this._inflight) this._inflight.abort();
      this._inflight = new AbortController();
      let data = await this._callIndex(this._searchPath(q), this._inflight.signal);
      if (!data || data.aborted) return; // a newer keystroke owns the box now
      if (typeof this.intakeFilter === 'function') {
        const filtered = this.intakeFilter(data, { kind: 'search' });
        if (filtered) data = filtered;
      }
      this._renderSearch(data);
    }

    async _runUniverse(name) {
      if (!this.showUniverses) return;
      if (this.authMode !== 'authed' || !this._currentUser) {
        // /api/universe is members-only server-side (§4.5's carve-out is
        // search-only). Say so as an invitation, before a 401 says it worse.
        this._setStatus(`The universe view spans every shelf, so it needs a sign-in. Sign in to see everything in ${name}.`);
        return;
      }
      if (this._inflight) this._inflight.abort();
      this._inflight = new AbortController();
      this._setStatus(`Everything in ${name}…`);
      let data = await this._callIndex(`/api/universe/${encodeURIComponent(name)}`, this._inflight.signal);
      if (!data || data.aborted) return;
      if (typeof this.intakeFilter === 'function') {
        const filtered = this.intakeFilter(data, { kind: 'universe' });
        if (filtered) data = filtered;
      }
      this._renderUniverse(data);
    }

    _scheduleSearch() {
      clearTimeout(this._debounceTimer);
      const q = this._input.value.trim();
      if (q.length < this.minChars) {
        if (this._inflight) this._inflight.abort();
        this._clearResults();
        this._setStatus('');
        return;
      }
      this._debounceTimer = setTimeout(() => this._runSearch(q), this.debounceMs);
    }

    // -- wiring ---------------------------------------------------------------

    _onInput() {
      if (this.authMode === 'authed' && !this._authResolved) return; // neutral boot: no claims yet
      this._scheduleSearch();
    }

    _onKeydown(e) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (!this._navItems.length) return;
        e.preventDefault();
        const delta = e.key === 'ArrowDown' ? 1 : -1;
        const next = this._activeIndex + delta;
        this._setActive(next < -1 ? this._navItems.length - 1 : next >= this._navItems.length ? -1 : next);
      } else if (e.key === 'Enter') {
        if (this._activeIndex >= 0 && this._navItems[this._activeIndex]) {
          e.preventDefault();
          this._navItems[this._activeIndex].open();
        }
        // Plain Enter falls through to form submit: flush the debounce.
      } else if (e.key === 'Escape') {
        clearTimeout(this._debounceTimer);
        if (this._inflight) this._inflight.abort();
        this._clearResults();
        this._setStatus('');
      }
    }

    _onSubmit(e) {
      e.preventDefault();
      if (this.authMode === 'authed' && !this._authResolved) return;
      clearTimeout(this._debounceTimer);
      const q = this._input.value.trim();
      if (q.length < this.minChars) return;
      this._runSearch(q);
    }

    async _onSigninClick() {
      if (this.authMode !== 'authed' || !this.authAdapter) return;
      this._signinBtn.disabled = true;
      const r = await this.authAdapter.signIn();
      this._signinBtn.disabled = false;
      if (r.error) this._setStatus(r.error, r.ownerAction ? 'owner' : 'warn');
      else if (r.cancelled) this._setStatus('');
      // ok / redirecting need nothing: watchAuth re-renders, or the page leaves.
    }
  }

  if (!customElements.get('estate-search')) {
    customElements.define('estate-search', EstateSearch);
  }
})();
