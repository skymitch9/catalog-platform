/**
 * The link ceremony's PAGES — the only HTML this Worker serves.
 *
 * Self-contained by necessity: `discord.heygabi.ai` is a Worker with no
 * static assets and no Pages project behind it, so there is nothing to link
 * a stylesheet to. The estate's design tokens are therefore inlined in a
 * MINIMAL subset (the `--et-*` vocabulary's ground/surface/fg/muted/accent
 * roles, in the apex's `apple` palette, light and dark), not copied wholesale
 * — sites/heygabi-home/public/assets/estate-theme.css stays canonical and
 * this is a deliberate, documented, five-token echo of it.
 *
 * ⚠️ EVERY PAGE HERE ANSWERS IN WORDS. The estate's no-bare-status rule
 * applies hardest to a page a human lands on from Discord: it must say what
 * happened, what it needs, and how to get it — and it must never dress a
 * service outage as a permissions problem, or a not-yet-configured secret as
 * a user error. `page()` takes a title, a body and a "what to do" line, and
 * there is no code path that renders a page without all three.
 */

/** HTML-escape everything interpolated. No exceptions, no "this one is safe". */
export function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** The apex's `apple` tokens, trimmed to what one page needs. */
const STYLE = `
:root{color-scheme:light dark;
  --et-bg:#ffffff;--et-surface:#f5f5f7;--et-fg:#1d1d1f;--et-muted:#6e6e73;
  --et-hairline:rgba(0,0,0,.12);--et-accent:#0071e3;--et-accent-fg:#ffffff;
  --et-warn:#8a5a00;--et-warn-bg:#fdf4e3}
@media (prefers-color-scheme:dark){:root{
  --et-bg:#000000;--et-surface:#1d1d1f;--et-fg:#f5f5f7;--et-muted:#86868b;
  --et-hairline:rgba(255,255,255,.16);--et-accent:#2997ff;--et-accent-fg:#00204a;
  --et-warn:#e8c98a;--et-warn-bg:#2a2213}}
*{box-sizing:border-box}
body{margin:0;background:var(--et-bg);color:var(--et-fg);
  font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px}
main{background:var(--et-surface);border:1px solid var(--et-hairline);border-radius:18px;
  padding:32px;max-width:34rem;width:100%}
h1{font-size:1.5rem;line-height:1.25;margin:0 0 .75rem}
p{margin:0 0 1rem}
p.what-to-do{color:var(--et-muted);font-size:.925rem;margin-bottom:0}
.note{background:var(--et-warn-bg);color:var(--et-warn);border-radius:12px;padding:14px 16px;
  font-size:.9rem;margin:0 0 1rem}
button{font:inherit;font-weight:600;background:var(--et-accent);color:var(--et-accent-fg);
  border:0;border-radius:980px;padding:11px 22px;cursor:pointer}
button[disabled]{opacity:.5;cursor:default}
button.secondary{background:transparent;color:var(--et-muted);border:1px solid var(--et-hairline)}
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.9em;
  background:var(--et-bg);border:1px solid var(--et-hairline);border-radius:6px;padding:1px 5px}
.row{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:1rem}
.hide{display:none}
`;

export interface PageParts {
  title: string;
  /** Already-escaped / trusted HTML for the body. */
  body: string;
  /** The one line saying what the reader should do next. Plain text. */
  whatToDo: string;
  /** Extra <script type="module"> source, if the page is interactive. */
  script?: string;
}

export function page(parts: PageParts): string {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(parts.title)} — GABI</title>
<style>${STYLE}</style>
</head><body><main>
<h1>${esc(parts.title)}</h1>
${parts.body}
<p class="what-to-do">${esc(parts.whatToDo)}</p>
</main>${parts.script ? `\n<script type="module">${parts.script}</script>` : ''}
</body></html>`;
}

/**
 * The SHIPS-DARK page. `DISCORD_CLIENT_SECRET` is unset, so the ceremony
 * cannot start — and the person hears that in words, with the owner's exact
 * remaining step named, rather than a 500 or a redirect into an error.
 */
export function notConfiguredPage(): string {
  return page({
    title: 'Linking is not configured yet',
    body: `
<p>GABI can’t connect Discord accounts to estate identities yet. This is a
<strong>setup step that hasn’t been done</strong> — it is not a problem with
your account, and nothing you did caused it.</p>
<p class="note">Owner step, one click each, both in the
<strong>Discord Developer Portal → OAuth2</strong> tab for application GABI:
copy the <strong>Client Secret</strong> into the Worker as
<code>DISCORD_CLIENT_SECRET</code>, and add
<code>https://discord.heygabi.ai/link/callback</code> to
<strong>Redirects</strong>. The runbook is
<code>docs/access/discord-bot.md</code>.</p>`,
    whatToDo:
      'Nothing to do here yet. Voting on the club page works exactly as it always has, and your Discord vote buttons will start working the moment linking is switched on.',
  });
}

/** A worded refusal — used for every failure the ceremony can hit. */
export function problemPage(title: string, what: string, whatToDo: string): string {
  return page({
    title,
    body: `<p>${esc(what)}</p><div class="row"><a href="/link"><button>Start again</button></a></div>`,
    whatToDo,
  });
}

/**
 * The ESTATE half of the ceremony — served once the Discord half is proven.
 *
 * The page's whole job is to make the person prove the OTHER identity: it
 * signs them in to the shared estate Firebase project (the same project,
 * the same `auth.heygabi.ai` authDomain and the same popup-first / redirect-
 * fallback rules as sites/heygabi-home/public/assets/estate-auth.js — that
 * file is canonical and this is a deliberate, minimal echo of it), then posts
 * the resulting ID token to `/link/confirm`, where the Worker verifies it
 * server-side and does the single write.
 *
 * The Discord identity is NOT in this page's JavaScript. It rides an
 * HttpOnly cookie the page cannot read (link-token.ts's header explains why),
 * so nothing here can be edited in devtools into a link for someone else.
 * The username below is display only.
 *
 * ⚠️ `discord.heygabi.ai` must be an AUTHORISED DOMAIN on the Firebase
 * project or sign-in throws `auth/unauthorized-domain`. Firebase does not
 * treat a subdomain as covered by its parent, so `heygabi.ai` being on the
 * list is not enough. That is a console-only owner step, and the catch below
 * turns it into an instruction rather than a dead button — exactly the way
 * estate-auth.js's ownerActionMessage() does.
 */
export function confirmPage(discordUsername: string): string {
  const script = [
    "import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js';",
    "import { getAuth, signInWithPopup, signInWithRedirect, getRedirectResult, GoogleAuthProvider }",
    "  from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';",
    '',
    '// The shared estate project — same config every estate surface ships.',
    'const app = initializeApp({',
    "  apiKey: 'AIzaSyDgAblkxzVxl7nFbd7jXOo6PpuNPsJw11Y',",
    "  authDomain: 'auth.heygabi.ai',",
    "  projectId: 'audiobook-catalog',",
    "  storageBucket: 'audiobook-catalog.firebasestorage.app',",
    "  messagingSenderId: '68492219785',",
    "  appId: '1:68492219785:web:7cbe57dda8712377f0bd58'",
    '});',
    'const auth = getAuth(app);',
    '',
    "const $ = (id) => document.getElementById(id);",
    'const say = (msg) => { $(\'status\').textContent = msg; };',
    '',
    '// estate-auth.js\'s rule, kept: only these codes justify the redirect',
    "// fallback. Someone closing the popup changed their mind; that is not a",
    '// reason to navigate the whole page to Google.',
    "const POPUP_UNAVAILABLE = new Set(['auth/popup-blocked',",
    "  'auth/operation-not-supported-in-this-environment', 'auth/web-storage-unsupported']);",
    '',
    'const OWNER_ACTION =',
    "  'Sign-in is blocked because discord.heygabi.ai is not yet an authorised domain on the '",
    "  + 'estate Firebase project. Owner action (Firebase console only): Authentication -> '",
    "  + 'Settings -> Authorised domains -> add discord.heygabi.ai. Nothing else is broken — '",
    "  + 'this page works the moment that entry exists.';",
    '',
    'async function idToken() {',
    '  const user = auth.currentUser;',
    '  if (!user) return null;',
    '  return await user.getIdToken();',
    '}',
    '',
    'async function signIn() {',
    '  const provider = new GoogleAuthProvider();',
    '  try {',
    '    await signInWithPopup(auth, provider);',
    '    return true;',
    '  } catch (e) {',
    "    if (e && e.code === 'auth/unauthorized-domain') { say(OWNER_ACTION); return false; }",
    "    if (e && (e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request')) {",
    "      say('Sign-in was cancelled. Nothing was linked.'); return false; }",
    '    if (e && POPUP_UNAVAILABLE.has(e.code)) {',
    '      try { await signInWithRedirect(auth, provider); return false; }',
    "      catch (e2) { say(e2 && e2.code === 'auth/unauthorized-domain' ? OWNER_ACTION :",
    "        'Sign-in did not complete. Nothing was linked — try again.'); return false; }",
    '    }',
    "    say('Sign-in did not complete. Nothing was linked — try again.');",
    '    return false;',
    '  }',
    '}',
    '',
    'async function call(path) {',
    '  const token = await idToken();',
    "  if (!token) { say('Signed in, but no estate token could be minted. Nothing was changed — try again.'); return; }",
    '  let res;',
    '  try {',
    "    res = await fetch(path, { method: 'POST', credentials: 'same-origin',",
    "      headers: { authorization: 'Bearer ' + token } });",
    "  } catch (e) { say('The estate did not answer (a network or service problem, NOT a permissions one). Nothing was changed.'); return; }",
    '  let data = null;',
    '  try { data = await res.json(); } catch (e) { data = null; }',
    "  if (data && typeof data.message === 'string') { say(data.message); }",
    "  else { say('Something went wrong on the estate\\u2019s side (a service problem, NOT a permissions one). Nothing was changed — try again in a minute.'); }",
    "  if (res.ok) { $('actions').classList.add('hide'); }",
    '}',
    '',
    '// Every page offering sign-in must complete a redirect return, or the',
    "// mobile/in-app-browser flow drops the credential silently (estate-auth.js).",
    'try { await getRedirectResult(auth); } catch (e) {',
    "  say(e && e.code === 'auth/unauthorized-domain' ? OWNER_ACTION : 'Sign-in did not complete. Nothing was linked — try again.');",
    '}',
    '',
    "$('link').addEventListener('click', async () => {",
    "  say('Working…');",
    '  if (!auth.currentUser && !(await signIn())) return;',
    "  await call('/link/confirm');",
    '});',
    "$('unlink').addEventListener('click', async () => {",
    "  say('Working…');",
    '  if (!auth.currentUser && !(await signIn())) return;',
    "  await call('/link/unlink');",
    '});',
  ].join('\n');

  return page({
    title: 'Link your Discord account',
    body: `
<p>Discord says you are <strong>${esc(discordUsername)}</strong>. To finish, sign in
with the same Google account you use on the estate — GABI records the pair so a
vote you cast from Discord lands on your club member entry.</p>
<p class="note">GABI asked Discord for <strong>your username only</strong> — no email,
no server list, no messages. The pair is stored and used for nothing else, and
<strong>Unlink</strong> below removes it whenever you like.</p>
<div class="row" id="actions">
  <button id="link" type="button">Sign in and link</button>
  <button id="unlink" class="secondary" type="button">Unlink instead</button>
</div>
<p id="status" role="status"></p>`,
    whatToDo:
      'Votes are never guessed from usernames. Until this link exists, a vote clicked in Discord is refused in words rather than attributed to the wrong person.',
    script,
  });
}
