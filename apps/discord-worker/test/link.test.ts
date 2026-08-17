/**
 * The identity-link ceremony (design §1.6, phase 2).
 *
 * Four things are being pinned here, and the fourth is the reason this file
 * matters most:
 *
 *   1. CSRF — the `state` nonce is set, is required, and is compared.
 *   2. Ships dark — every route answers in WORDS while
 *      `DISCORD_CLIENT_SECRET` is unset, and never with a bare status.
 *   3. Every callback failure (declined, no code, bad state, Discord refusing)
 *      lands on worded copy that says what happened and what to do.
 *   4. ⚠️ THE WRITE/READ CONTRACT. What link.ts WRITES into
 *      `discord_links/{discordUserId}` is exactly what poll-vote.ts READS back
 *      out of it, and the slug it derives is exactly the doc id the audiobook
 *      site's own `castVote()` writes. These two halves live in different
 *      files, are exercised by different surfaces, and would drift silently —
 *      the failure mode being a linked person told they are "not linked". The
 *      round-trip below makes that drift a red test instead.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import app from '../src/index.js';
import {
  linkConfigured,
  linkDocFields,
  LINK_MSG,
  PENDING_COOKIE,
  STATE_COOKIE,
} from '../src/link.js';
import {
  newNonce,
  PENDING_TTL_SECONDS,
  signPending,
  timingSafeEqual,
  verifyPending,
} from '../src/link-token.js';
import { estateDisplayName, isSafeSlug, slugifyName, slugPathSegment } from '../src/slug.js';
import { linkFromDoc, voteDocFields } from '../src/poll-vote.js';
import { authorizeUrl, callbackUrl, LINK_SCOPE, readDiscordUser } from '../src/discord-oauth.js';
import { confirmPage, esc, notConfiguredPage, page } from '../src/link-pages.js';
import {
  BASE_COMMANDS,
  isOwnerEmail,
  linkCommandMessage,
  roleIsAdmin,
} from '../src/commands.js';
import { LINK_COMMAND_NAME, routeInteraction } from '../src/interactions.js';

const CONFIGURED = {
  DISCORD_APPLICATION_ID: '1538775435880562758',
  DISCORD_CLIENT_SECRET: 'test-client-secret-not-a-real-one',
  FIREBASE_PROJECT_ID: 'audiobook-catalog',
};

// ===========================================================================
// 4. THE CONTRACT — the writer and the reader, pinned to each other
// ===========================================================================

/**
 * Display names as they really arrive from Google, and the slug the audiobook
 * site's `slugifyName()` produces for each. ⚠️ MEASURED against
 * audiobook_catalog/site/identity.js:765 — `displayName.toLowerCase()`, and
 * nothing else. Spaces are NOT stripped, which is the whole point of the
 * first three rows.
 */
const REAL_NAMES: Array<[string, string]> = [
  ['Sam Vimes', 'sam vimes'],
  ['Nathan B', 'nathan b'],
  ["Conn O'Neill", "conn o'neill"],
  ['Renée Descartes', 'renée descartes'],
  ['gabi', 'gabi'],
  ['someone@example.com', 'someone@example.com'], // the no-display-name fallback
];

test('CONTRACT: the slug this Worker derives is the doc id the club page writes', () => {
  for (const [displayName, expected] of REAL_NAMES) {
    assert.equal(slugifyName(displayName), expected, displayName);
    assert.ok(isSafeSlug(slugifyName(displayName)), `${displayName} must be linkable`);
  }
});

test('CONTRACT: a slug with a SPACE survives the writer→reader round trip', () => {
  // ⚠️ Regression pin. poll-vote.ts once validated slugs with the
  // Firestore-auto-id pattern /^[A-Za-z0-9_-]{1,64}$/, which rejects every
  // name containing a space — i.e. nearly every real one. A link written here
  // would have been refused there, and the voter told they were "not linked"
  // while their link doc sat right in front of the Worker. If this test ever
  // fails, that silent failure is back.
  const displayName = 'Sam Vimes';
  const written = linkDocFields({
    slug: slugifyName(displayName),
    displayName,
    firebaseUid: 'uid-123',
    linkedAt: new Date('2026-08-17T10:00:00.000Z'),
  });
  assert.deepEqual(linkFromDoc({ fields: written }), {
    slug: 'sam vimes',
    displayName: 'Sam Vimes',
  });
});

test('CONTRACT: writer → reader → vote doc, the whole chain, for every real name', () => {
  for (const [displayName, expectedSlug] of REAL_NAMES) {
    const identity = { name: displayName, email: 'unused@example.com' };
    const derived = estateDisplayName(identity);
    const fields = linkDocFields({
      slug: slugifyName(derived),
      displayName: derived,
      firebaseUid: 'uid-1',
      linkedAt: new Date(0),
    });
    const link = linkFromDoc({ fields });
    assert.ok(link, `${displayName} must read back`);
    assert.equal(link.slug, expectedSlug);
    // …and the vote the link then produces is byte-for-byte the shape
    // validPollVote() accepts from a browser.
    assert.deepEqual(voteDocFields(2, link.displayName), {
      optionIndex: { integerValue: '2' },
      displayName: { stringValue: displayName },
    });
  }
});

test('CONTRACT: a name-less Google account falls back to email, exactly as the browser does', () => {
  // identity.js:78 — localStorage 'ab_identity_name' = user.displayName || user.email
  assert.equal(estateDisplayName({ name: null, email: 'Reader@Example.com' }), 'Reader@Example.com');
  assert.equal(estateDisplayName({ name: '   ', email: 'reader@example.com' }), 'reader@example.com');
  assert.equal(estateDisplayName({ name: 'Named', email: 'reader@example.com' }), 'Named');
});

test('the link doc carries linkedAt and firebaseUid alongside the two read fields', () => {
  const fields = linkDocFields({
    slug: 'sam vimes',
    displayName: 'Sam Vimes',
    firebaseUid: 'uid-abc',
    linkedAt: new Date('2026-08-17T10:00:00.000Z'),
  });
  assert.deepEqual(fields, {
    slug: { stringValue: 'sam vimes' },
    displayName: { stringValue: 'Sam Vimes' },
    linkedAt: { timestampValue: '2026-08-17T10:00:00.000Z' },
    firebaseUid: { stringValue: 'uid-abc' },
  });
  // The reader ignores the two extra fields rather than choking on them.
  assert.deepEqual(linkFromDoc({ fields }), { slug: 'sam vimes', displayName: 'Sam Vimes' });
});

test('isSafeSlug refuses what Firestore refuses, and what would escape a path', () => {
  for (const bad of [
    '', //            no doc id at all
    'has/slash', //   path separator
    '.', //           Firestore reserved
    '..', //          Firestore reserved
    '__proto__', //   Firestore's reserved __*__ namespace
    'Sam Vimes', //   not lowercased — whoever made it skipped slugifyName()
    'a\u0000b', //  a NUL is never in a name
    'a\u2028b', //  nor a Unicode line separator
    'x'.repeat(1501),
  ]) {
    assert.equal(isSafeSlug(bad), false, JSON.stringify(bad).slice(0, 40));
  }
  assert.equal(isSafeSlug(42), false);
  assert.equal(isSafeSlug(null), false);
});

test('a slug reaching a Firestore REST path is percent-encoded, always', () => {
  assert.equal(slugPathSegment('sam vimes'), 'sam%20vimes');
  assert.equal(slugPathSegment("conn o'neill"), "conn%20o'neill");
  assert.ok(!slugPathSegment('a b c').includes(' '));
});

// ===========================================================================
// 1. CSRF / state
// ===========================================================================

test('GET /link sets a state cookie and redirects to Discord carrying the same nonce', async () => {
  const res = await app.request('/link', {}, CONFIGURED);
  assert.equal(res.status, 302);

  const location = res.headers.get('location') ?? '';
  const url = new URL(location);
  assert.equal(url.origin + url.pathname, 'https://discord.com/oauth2/authorize');
  assert.equal(url.searchParams.get('scope'), LINK_SCOPE);
  assert.equal(url.searchParams.get('scope'), 'identify'); // and nothing wider
  assert.equal(url.searchParams.get('client_id'), CONFIGURED.DISCORD_APPLICATION_ID);
  assert.equal(url.searchParams.get('response_type'), 'code');

  const setCookie = res.headers.get('set-cookie') ?? '';
  assert.match(setCookie, new RegExp(`^${STATE_COOKIE}=`));
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /Secure/i);
  assert.match(setCookie, /SameSite=Lax/i);
  assert.match(setCookie, /Path=\/link/i);

  const cookieNonce = /^[^=]+=([^;]+)/.exec(setCookie)?.[1];
  assert.equal(url.searchParams.get('state'), cookieNonce);
  assert.ok((cookieNonce ?? '').length >= 20, 'the nonce must not be guessable');
});

test('the redirect_uri sent to Discord is the one the portal must whitelist', async () => {
  const res = await app.request('https://discord.heygabi.ai/link', {}, CONFIGURED);
  const url = new URL(res.headers.get('location') ?? '');
  assert.equal(
    url.searchParams.get('redirect_uri'),
    'https://discord.heygabi.ai/link/callback',
  );
  assert.equal(callbackUrl('https://discord.heygabi.ai/'), 'https://discord.heygabi.ai/link/callback');
});

test('/link/callback with NO state cookie is refused in words, not with a bare status', async () => {
  const res = await app.request('/link/callback?code=abc&state=xyz', {}, CONFIGURED);
  assert.equal(res.status, 400);
  const html = await res.text();
  assert.match(html, /could not be verified/i);
  assert.match(html, /nothing was linked/i);
  assert.match(html, /run \/link in discord again/i); // what to do
  assert.ok(!/^\s*400\s*$/.test(html));
});

test('/link/callback with a MISMATCHED state is refused, and burns the nonce either way', async () => {
  const res = await app.request(
    '/link/callback?code=abc&state=attacker-supplied',
    { headers: { cookie: `${STATE_COOKIE}=the-real-one` } },
    CONFIGURED,
  );
  assert.equal(res.status, 400);
  assert.match(await res.text(), /could not be verified/i);
  // Single-use by construction: the nonce is cleared on EVERY outcome.
  assert.match(res.headers.get('set-cookie') ?? '', new RegExp(`${STATE_COOKIE}=;`));
});

test('timingSafeEqual: equal is true, any difference is false, no early exit on length', () => {
  assert.equal(timingSafeEqual('abc', 'abc'), true);
  assert.equal(timingSafeEqual('abc', 'abd'), false);
  assert.equal(timingSafeEqual('abc', 'abcd'), false);
  assert.equal(timingSafeEqual('', ''), true);
});

test('newNonce: unguessable and unique', () => {
  const seen = new Set(Array.from({ length: 200 }, () => newNonce()));
  assert.equal(seen.size, 200);
  assert.ok([...seen].every((n) => n.length >= 20));
});

// ===========================================================================
// 2. Ships dark — the unset secret answers in words, everywhere
// ===========================================================================

test('linkConfigured needs BOTH halves', () => {
  assert.equal(linkConfigured({}), false);
  assert.equal(linkConfigured({ DISCORD_APPLICATION_ID: 'a' }), false);
  assert.equal(linkConfigured({ DISCORD_CLIENT_SECRET: 's' }), false);
  assert.equal(linkConfigured({ DISCORD_APPLICATION_ID: 'a', DISCORD_CLIENT_SECRET: 's' }), true);
});

test('GET /link with the client secret unset serves the worded not-configured page', async () => {
  const res = await app.request('/link', {}, { DISCORD_APPLICATION_ID: 'app-only' });
  assert.equal(res.status, 503);
  assert.match(res.headers.get('content-type') ?? '', /text\/html/);
  const html = await res.text();
  assert.match(html, /not configured yet/i);
  // It names the cause honestly — a setup step, not the visitor's fault.
  assert.match(html, /setup step/i);
  assert.match(html, /not a problem with\s*\n?\s*your account/i);
  // …and the exact remaining owner step, both halves of it.
  assert.match(html, /DISCORD_CLIENT_SECRET/);
  assert.match(html, /discord\.heygabi\.ai\/link\/callback/);
  assert.match(html, /docs\/access\/discord-bot\.md/);
  // …and it never redirects into a broken OAuth trip.
  assert.ok(!html.includes('discord.com/oauth2/authorize'));
});

test('/link/callback with the client secret unset also degrades to the worded page', async () => {
  const res = await app.request('/link/callback?code=x&state=y', {}, {});
  assert.equal(res.status, 503);
  assert.match(await res.text(), /not configured yet/i);
});

test('the not-configured page never leaks a secret NAME as a value, nor invents one', () => {
  const html = notConfiguredPage();
  // It names the variable, which is public; there is nothing that looks like
  // a value anywhere in it.
  assert.match(html, /DISCORD_CLIENT_SECRET/);
  assert.ok(!/DISCORD_CLIENT_SECRET\s*[:=]\s*\S/.test(html));
});

test('POST /link/confirm with no pending proof answers in words, and touches nothing', async () => {
  const res = await app.request('/link/confirm', { method: 'POST' }, CONFIGURED);
  assert.equal(res.status, 400);
  const body = (await res.json()) as { ok: boolean; message: string };
  assert.equal(body.ok, false);
  assert.equal(body.message, LINK_MSG.noPending);
  assert.match(body.message, /nothing was changed/i);
});

test('POST /link/unlink with no pending proof answers the same way', async () => {
  const res = await app.request('/link/unlink', { method: 'POST' }, CONFIGURED);
  assert.equal(res.status, 400);
  assert.equal(((await res.json()) as { message: string }).message, LINK_MSG.noPending);
});

test('POST /link/confirm with the client secret unset is a CONFIG answer, not a permissions one', async () => {
  const res = await app.request(
    '/link/confirm',
    { method: 'POST', headers: { cookie: `${PENDING_COOKIE}=anything` } },
    { FIREBASE_PROJECT_ID: 'audiobook-catalog' },
  );
  assert.equal(res.status, 503);
  const body = (await res.json()) as { message: string };
  assert.match(body.message, /NOT a permissions/i);
  assert.match(body.message, /nothing was changed/i);
});

test('a proven Discord half with NO estate token is refused as not-signed-in', async () => {
  const pending = await signPending(CONFIGURED.DISCORD_CLIENT_SECRET, {
    discordUserId: '1234567890123456',
    discordUsername: 'reader',
    exp: Math.floor(Date.now() / 1000) + PENDING_TTL_SECONDS,
  });
  const res = await app.request(
    '/link/confirm',
    { method: 'POST', headers: { cookie: `${PENDING_COOKIE}=${pending}` } },
    CONFIGURED,
  );
  assert.equal(res.status, 401);
  const body = (await res.json()) as { message: string };
  assert.equal(body.message, LINK_MSG.notSignedIn);
  assert.match(body.message, /nothing was linked/i);
});

test('an estate half with no FIREBASE_PROJECT_ID is a CONFIG answer, never a 401', async () => {
  const pending = await signPending(CONFIGURED.DISCORD_CLIENT_SECRET, {
    discordUserId: '1234567890123456',
    discordUsername: 'reader',
    exp: Math.floor(Date.now() / 1000) + PENDING_TTL_SECONDS,
  });
  const res = await app.request(
    '/link/confirm',
    { method: 'POST', headers: { cookie: `${PENDING_COOKIE}=${pending}` } },
    { DISCORD_APPLICATION_ID: 'a', DISCORD_CLIENT_SECRET: CONFIGURED.DISCORD_CLIENT_SECRET },
  );
  assert.equal(res.status, 503);
  assert.match(((await res.json()) as { message: string }).message, /NOT a permissions/i);
});

// ===========================================================================
// The pending token — the Discord half's integrity across the trip
// ===========================================================================

const SECRET = 'a-client-secret';
const somePending = () => ({
  discordUserId: '1234567890123456',
  discordUsername: 'Sam',
  exp: Math.floor(Date.now() / 1000) + 600,
});

test('pending token: signs and verifies, round trip', async () => {
  const p = somePending();
  const token = await signPending(SECRET, p);
  assert.deepEqual(await verifyPending(SECRET, token, Math.floor(Date.now() / 1000)), p);
});

test('pending token: the Discord user id cannot be edited in flight', async () => {
  const token = await signPending(SECRET, somePending());
  const [payload, mac] = token.split('.') as [string, string];
  const forgedPayload = btoa(
    JSON.stringify({ ...somePending(), discordUserId: '9999999999999999' }),
  )
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  assert.notEqual(forgedPayload, payload);
  assert.equal(await verifyPending(SECRET, `${forgedPayload}.${mac}`, 1), null);
});

test('pending token: a different client secret cannot mint one', async () => {
  const token = await signPending(SECRET, somePending());
  assert.equal(await verifyPending('a-different-secret', token, 1), null);
});

test('pending token: expiry is enforced, and expired reads exactly like forged', async () => {
  const expired = await signPending(SECRET, { ...somePending(), exp: 1000 });
  assert.equal(await verifyPending(SECRET, expired, 1001), null);
  assert.notEqual(await verifyPending(SECRET, expired, 999), null);
  // Garbage, tampered and expired are ONE answer — nothing tells a forger
  // which half to fix.
  assert.equal(await verifyPending(SECRET, 'not-a-token', 1), null);
  assert.equal(await verifyPending(SECRET, '', 1), null);
  assert.equal(await verifyPending(SECRET, 'a.b', 1), null);
});

// ===========================================================================
// 3. Callback failures — every one lands on worded copy
// ===========================================================================

test('a person who declines on Discord gets a page that says so, kindly, with status 200', async () => {
  const res = await app.request(
    '/link/callback?error=access_denied&state=s',
    { headers: { cookie: `${STATE_COOKIE}=s` } },
    CONFIGURED,
  );
  assert.equal(res.status, 200); // declining is not an error condition
  const html = await res.text();
  assert.match(html, /nothing was linked/i);
  assert.match(html, /perfectly fine answer/i);
  assert.match(html, /club page never needed this/i);
});

test('any OTHER Discord error is named as a Discord problem, never a permissions one', async () => {
  const res = await app.request(
    '/link/callback?error=server_error&state=s',
    { headers: { cookie: `${STATE_COOKIE}=s` } },
    CONFIGURED,
  );
  const html = await res.text();
  assert.match(html, /NOT a permissions problem/i);
});

test('a callback with a valid state but NO code is refused in words', async () => {
  const res = await app.request(
    '/link/callback?state=s',
    { headers: { cookie: `${STATE_COOKIE}=s` } },
    CONFIGURED,
  );
  assert.equal(res.status, 400);
  assert.match(await res.text(), /no authorization code/i);
});

test('readDiscordUser: prefers global_name, falls back to the handle, refuses a junk id', () => {
  assert.deepEqual(readDiscordUser({ id: '1234567890123456', username: 'handle', global_name: 'Sam' }), {
    ok: true,
    value: { id: '1234567890123456', username: 'Sam' },
  });
  assert.deepEqual(readDiscordUser({ id: '1234567890123456', username: 'handle' }), {
    ok: true,
    value: { id: '1234567890123456', username: 'handle' },
  });
  for (const junk of [{}, { id: 'not-a-snowflake' }, { id: 12345 }, { id: '' }]) {
    assert.equal(readDiscordUser(junk).ok, false, JSON.stringify(junk));
  }
});

test('authorizeUrl asks for identify and nothing else, and re-prompts every time', () => {
  const url = new URL(authorizeUrl('app-1', 'https://x/link/callback', 'nonce'));
  assert.equal(url.searchParams.get('scope'), 'identify');
  assert.equal(url.searchParams.get('prompt'), 'consent');
  assert.equal(url.searchParams.get('state'), 'nonce');
});

// ===========================================================================
// The pages
// ===========================================================================

test('esc: every interpolated character that could break out is escaped', () => {
  assert.equal(esc(`<img src=x onerror="a('b')">&`), '&lt;img src=x onerror=&quot;a(&#39;b&#39;)&quot;&gt;&amp;');
});

test('a Discord username cannot inject markup into the confirm page', () => {
  const html = confirmPage('<script>alert(1)</script>');
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.match(html, /&lt;script&gt;/);
});

test('the confirm page states the scope, the storage and the revocation, in words', () => {
  const html = confirmPage('Sam');
  assert.match(html, /your username only/i);
  assert.match(html, /no email/i);
  assert.match(html, /unlink/i);
  assert.match(html, /never guessed from usernames/i);
});

test('the confirm page keeps the Discord identity OUT of its JavaScript', () => {
  // Display only — the id the write uses rides an HttpOnly cookie instead, so
  // nothing in devtools can retarget the link at another Discord account.
  const html = confirmPage('Sam');
  assert.ok(!/discordUserId/.test(html));
  assert.ok(!/1234567890123456/.test(html));
});

test('⚠️ the confirm page\'s embedded module actually PARSES as JavaScript', () => {
  // The page's script is a STRING inside TypeScript, so tsc never looks at it
  // and a stray quote ships silently — the button simply does nothing, with a
  // syntax error in a console nobody is watching. This is the mechanical
  // guard: extract it and hand it to Node's own parser. It has already caught
  // one real breakage (mismatched quotes in the owner-action message).
  const extracted = /<script type="module">([\s\S]*?)<\/script>/.exec(confirmPage('Sam'));
  assert.ok(extracted?.[1], 'the confirm page must carry its module');

  const file = join(tmpdir(), `gabi-page-check-${process.pid}-${Date.now()}.mjs`);
  writeFileSync(file, extracted[1]);
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } finally {
    rmSync(file, { force: true });
  }
});

test('the not-configured page carries NO script at all', () => {
  // It is served when the ceremony cannot run. A page whose only job is to
  // explain that should not also be a place a bug can live.
  assert.ok(!/<script/i.test(notConfiguredPage()));
});

test('every page carries a what-to-do line — the no-bare-status rule, mechanically', () => {
  for (const html of [
    notConfiguredPage(),
    confirmPage('Sam'),
    page({ title: 't', body: '<p>b</p>', whatToDo: 'do this' }),
  ]) {
    assert.match(html, /class="what-to-do"/);
    assert.match(html, /<title>/);
  }
});

// ===========================================================================
// The slash command
// ===========================================================================

test('the registry and the router agree on the command name', () => {
  // BASE_COMMANDS is the always-published half (/link, /have); the moderation
  // pair is published only when the switch is on — see have.test.ts and
  // moderation.test.ts for that contract.
  assert.ok(BASE_COMMANDS.some((cmd) => cmd.name === LINK_COMMAND_NAME));
  assert.deepEqual(routeInteraction({ type: 2, data: { name: LINK_COMMAND_NAME } }), {
    kind: 'link_command',
  });
});

test('/link answers ephemerally with the URL, or with the worded not-yet if unconfigured', () => {
  const on = linkCommandMessage('https://discord.heygabi.ai', true);
  assert.match(on, /https:\/\/discord\.heygabi\.ai\/link/);
  assert.match(on, /username only/i);
  assert.match(on, /unlink/i);

  const off = linkCommandMessage('https://discord.heygabi.ai', false);
  assert.match(off, /not switched on yet/i);
  assert.match(off, /not a problem with your account/i);
  assert.match(off, /club page/i);
  assert.ok(!off.includes('/link\n'), 'a dead link is worse than none');
});

test('the /link interaction is ephemeral and reflects the live config', async () => {
  const { signedPost } = await import('./helpers/signed-post.js');
  const res = await signedPost({ type: 2, data: { name: 'link' } }, {});
  const body = (await res.json()) as { type: number; data: { content: string; flags: number } };
  assert.equal(body.type, 4);
  assert.equal(body.data.flags, 64); // ephemeral
  assert.match(body.data.content, /not switched on yet/i); // no client secret in the test env
});

// ===========================================================================
// The command-registration gate
// ===========================================================================

test('command registration refuses an unauthenticated caller in words', async () => {
  const res = await app.request(
    '/admin/commands/register',
    { method: 'POST' },
    { FIREBASE_PROJECT_ID: 'audiobook-catalog' },
  );
  assert.equal(res.status, 401);
  const body = (await res.json()) as { ok: boolean; message: string };
  assert.equal(body.ok, false);
  assert.match(body.message, /not signed in/i);
  assert.match(body.message, /nothing was published/i);
  assert.match(body.message, /Authorization: Bearer/); // how to get it
});

test('command registration with no verifier configured is a config answer, not a 401', async () => {
  const res = await app.request('/admin/commands/register', { method: 'POST' }, {});
  assert.equal(res.status, 503);
  assert.match(((await res.json()) as { message: string }).message, /NOT a permissions/i);
});

test('the admin gate: OWNER_EMAILS is case- and space-insensitive; role floor is admin', () => {
  const env = { OWNER_EMAILS: 'nbaslamking@gmail.com, mitchlandtv@gmail.com' };
  assert.equal(isOwnerEmail(env, 'NBaslamking@Gmail.com'), true);
  assert.equal(isOwnerEmail(env, '  mitchlandtv@gmail.com '), true);
  assert.equal(isOwnerEmail(env, 'someone@example.com'), false);
  assert.equal(isOwnerEmail({}, 'nbaslamking@gmail.com'), false);

  assert.equal(roleIsAdmin('admin'), true);
  assert.equal(roleIsAdmin('owner'), true);
  for (const below of ['moderator', 'contributor', 'member', 'guest', null]) {
    assert.equal(roleIsAdmin(below), false, String(below));
  }
});
