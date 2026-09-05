/**
 * A DOM small enough to read and real enough to drive the front door's modules.
 *
 * ## Why this exists rather than jsdom
 *
 * `catalog-platform` ships ONE dependency (`firebase-admin`) and its test lane is
 * `node --test scripts/test/**` with nothing else installed. Pulling a browser
 * emulator in to exercise two hundred lines of DOM calls would add a dependency
 * tree larger than the site, to test code that only ever calls fourteen DOM
 * methods. So this is those fourteen methods, and nothing more.
 *
 * ⚠️ THE POINT IS NOT FIDELITY, IT IS EXERCISING THE REAL MODULE. Phase 3b's
 * nine show/hide rows were all proven this way and the harness was never
 * committed, so phase 5 had to build it again. This one is committed.
 *
 * ⚠️ WHAT IT DOES NOT DO, so nobody reads a pass here as more than it is: no
 * layout, no CSS, no focus order, no real event ordering, no `dialog` semantics
 * beyond open/close. A green run says the module's LOGIC is right. It says
 * nothing about what a person sees, and the design doc's bar — a human, signed
 * in, presses the button — is untouched by it.
 */

class StubNode {
  constructor(tagName) {
    this.tagName = String(tagName || '').toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.attributes = {};
    this.dataset = {};
    this.listeners = new Map();
    this.className = '';
    this.hidden = false;
    this.disabled = false;
    this.value = '';
    this.style = {};
    this._text = '';
  }

  /* --- tree ------------------------------------------------------------- */

  appendChild(child) {
    if (child.parentElement) child.parentElement.removeChild(child);
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  append(...nodes) {
    for (const n of nodes) {
      if (typeof n === 'string') {
        const t = new StubNode('#text');
        t._text = n;
        this.appendChild(t);
      } else this.appendChild(n);
    }
  }

  removeChild(child) {
    const i = this.children.indexOf(child);
    if (i !== -1) this.children.splice(i, 1);
    child.parentElement = null;
    return child;
  }

  remove() {
    if (this.parentElement) this.parentElement.removeChild(this);
  }

  /* --- text ------------------------------------------------------------- */

  set textContent(v) {
    this.children = [];
    this._text = v == null ? '' : String(v);
  }

  get textContent() {
    return this._text + this.children.map((c) => c.textContent).join('');
  }

  /* --- attributes ------------------------------------------------------- */

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null;
  }

  get classList() {
    const self = this;
    return {
      add(...names) {
        const set = new Set(String(self.className).split(/\s+/).filter(Boolean));
        for (const n of names) set.add(n);
        self.className = [...set].join(' ');
      },
      remove(...names) {
        const set = new Set(String(self.className).split(/\s+/).filter(Boolean));
        for (const n of names) set.delete(n);
        self.className = [...set].join(' ');
      },
      contains(name) {
        return String(self.className).split(/\s+/).includes(name);
      },
    };
  }

  /* --- events ----------------------------------------------------------- */

  addEventListener(type, fn) {
    const list = this.listeners.get(type) || [];
    list.push(fn);
    this.listeners.set(type, list);
  }

  /**
   * ⚠️ RETURNS what the last listener returned, so an `async` handler can be
   * awaited by the test. Real `dispatchEvent` returns a boolean and a test that
   * could not await would have to sleep — which is how flaky suites are born.
   */
  dispatch(type, event) {
    let last;
    for (const fn of this.listeners.get(type) || []) last = fn(event ?? { type });
    return last;
  }

  click() {
    return this.dispatch('click', { type: 'click' });
  }

  focus() {}

  /* --- dialog ----------------------------------------------------------- */

  showModal() {
    this.open = true;
  }

  close() {
    this.open = false;
    this.dispatch('close', { type: 'close' });
  }

  /* --- queries the tests use, not the module ---------------------------- */

  /** Every descendant, depth first. */
  all() {
    const out = [];
    for (const c of this.children) {
      out.push(c);
      out.push(...c.all());
    }
    return out;
  }

  /** Descendants carrying a class. */
  byClass(name) {
    return this.all().filter((n) => String(n.className).split(/\s+/).includes(name));
  }

  /** Descendants of a tag. */
  byTag(name) {
    const want = String(name).toUpperCase();
    return this.all().filter((n) => n.tagName === want);
  }

  /** The first descendant whose visible text contains `text`. */
  findText(text) {
    return this.all().find((n) => n.children.length === 0 && n.textContent.includes(text)) || null;
  }

  /** A button by its label — how a person would find it. */
  button(label) {
    return this.byTag('button').find((b) => b.textContent.trim() === label) || null;
  }
}

/**
 * Install a document/window on `globalThis` and return the handles a test needs.
 *
 * @param {{kinds?: string[]}} [opts] which cards declare `data-catalog-kind`
 */
export function installStubDom({ kinds = ['books', 'games'] } = {}) {
  const body = new StubNode('body');
  const search = new StubNode('div');
  search.id = 'find-search';

  const cards = new Map();
  for (const kind of kinds) {
    const card = new StubNode('div');
    card.dataset.catalogKind = kind;
    body.appendChild(card);
    cards.set(kind, card);
  }

  const document = {
    body,
    createElement: (tag) => new StubNode(tag),
    getElementById: (id) => (id === 'find-search' ? search : null),
    querySelectorAll: (sel) => {
      if (sel === '[data-catalog-kind]') return [...cards.values()];
      throw new Error(`stub-dom: unsupported selector ${sel} — add it deliberately, do not widen this blindly`);
    },
  };

  const prev = {
    document: globalThis.document,
    hadDocument: 'document' in globalThis,
  };
  globalThis.document = document;

  return {
    document,
    body,
    search,
    cards,
    /** The dialog the module appended to body, once it has opened one. */
    dialog: () => body.children.find((c) => c.tagName === 'DIALOG') || null,
    /** The slot the module appended to a card. */
    slot: (kind) => cards.get(kind).children.find((c) => c.className === 'card-add-slot') || null,
    restore() {
      if (prev.hadDocument) globalThis.document = prev.document;
      else delete globalThis.document;
    },
  };
}

/**
 * A `fetch` that answers from a table of `METHOD path` → answer, and RECORDS
 * every call. ⚠️ An unmatched request THROWS rather than 404ing: a module that
 * quietly calls a route nobody expected is exactly the bug worth failing on.
 */
export function installStubFetch(routes) {
  const calls = [];
  const prev = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const method = (init && init.method) || 'GET';
    const path = String(url).replace(/^https?:\/\/[^/]+/, '');
    calls.push({ method, path, url: String(url), init, body: init && init.body });
    for (const [pattern, answer] of Object.entries(routes)) {
      const [m, p] = pattern.split(' ');
      if (m !== method) continue;
      if (!(p === path || (p.endsWith('*') && path.startsWith(p.slice(0, -1))))) continue;
      const res = typeof answer === 'function' ? await answer({ method, path, init }) : answer;
      return {
        ok: res.status >= 200 && res.status < 300,
        status: res.status,
        json: async () => res.body,
      };
    }
    throw new Error(`stub-fetch: nothing matched ${method} ${path}`);
  };
  return {
    calls,
    /** The parsed JSON body of the nth call matching a method+path. */
    bodyOf(method, path) {
      const c = calls.find((x) => x.method === method && x.path === path);
      return c && c.body ? JSON.parse(c.body) : null;
    },
    restore() {
      globalThis.fetch = prev;
    },
  };
}

/** Capture everything the module writes to the console, for the leak assertions. */
export function captureConsole() {
  const lines = [];
  const prev = { log: console.log, warn: console.warn, error: console.error, debug: console.debug };
  for (const k of Object.keys(prev)) {
    console[k] = (...args) => lines.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
  }
  return {
    lines,
    text: () => lines.join('\n'),
    restore() {
      Object.assign(console, prev);
    },
  };
}

/** A signed-in user shaped like the one `estate-search:auth` carries. */
export function stubUser(over = {}) {
  return { uid: 'uid-1', email: 'amber@example.com', displayName: 'Amber', ...over };
}

/** The `authAdapter` seam the module reads its bearer from. */
export function attachAuthAdapter(search, token = 'stub-id-token') {
  search.authAdapter = { idToken: async () => token };
}

export { StubNode };
