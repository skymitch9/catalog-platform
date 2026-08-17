/**
 * Discord OAuth2 — the `identify` half of the identity-link ceremony
 * (design doc §1.6). Three calls, no SDK:
 *
 *   1. redirect the person to Discord's authorize page  (authorizeUrl)
 *   2. exchange the returned code for an access token   (exchangeCode)
 *   3. ask who they are                                 (fetchDiscordUser)
 *
 * ⚠️ `identify` is the WHOLE scope, deliberately. It returns a user id and a
 * username and nothing else — no email, no guild list, no consent screen
 * asking for anything the estate does not need (design §1.5's minimal-scope
 * stance, applied to the user flow rather than the bot invite). The token
 * this yields is used exactly once, in-request, to read /users/@me, and is
 * never stored anywhere.
 *
 * The client SECRET (`DISCORD_CLIENT_SECRET`) is a different credential from
 * `DISCORD_BOT_TOKEN`: it authenticates the APPLICATION during the code
 * exchange and can mint no bot powers. It lives in the same custody as the
 * rest — a wrangler secret, never in this repo, never printed.
 */

const DISCORD_API = 'https://discord.com/api/v10';

/** The one scope this ceremony ever asks for. */
export const LINK_SCOPE = 'identify';

/** The redirect the Developer Portal must whitelist, derived from the request
 * origin so a preview/dev origin builds its own rather than hardcoding prod. */
export function callbackUrl(origin: string): string {
  return `${origin.replace(/\/+$/, '')}/link/callback`;
}

/** Discord's authorize page, with the CSRF nonce riding `state`. */
export function authorizeUrl(clientId: string, redirectUri: string, state: string): string {
  const q = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    scope: LINK_SCOPE,
    state,
    redirect_uri: redirectUri,
    // Re-prompt every time. Linking is an explicit, opt-in act (§1.6) and a
    // silent re-authorize would let a person land on a "you are linked" page
    // without having consciously agreed to anything on this visit.
    prompt: 'consent',
  });
  return `https://discord.com/oauth2/authorize?${q.toString()}`;
}

export interface DiscordIdentity {
  id: string;
  /** The @handle. `global_name` is the modern display name; either may be absent. */
  username: string;
}

/** A Discord snowflake: 17-20 digits today, bounded generously. */
const SNOWFLAKE = /^\d{5,25}$/;

export type OAuthResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: 'discord_rejected' | 'discord_unreachable' | 'unusable_response'; detail: string };

/**
 * Trade the authorization code for an access token. Discord answers 4xx with
 * a JSON body naming the problem — surfaced as `detail` for the log, NEVER
 * shown to the person (they get worded copy from link.ts instead).
 */
export async function exchangeCode(
  clientId: string,
  clientSecret: string,
  code: string,
  redirectUri: string,
): Promise<OAuthResult<string>> {
  let res: Response;
  try {
    res = await fetch(`${DISCORD_API}/oauth2/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }).toString(),
    });
  } catch (err) {
    return { ok: false, reason: 'discord_unreachable', detail: String(err) };
  }
  if (!res.ok) {
    return { ok: false, reason: 'discord_rejected', detail: `token exchange ${res.status}` };
  }
  let data: { access_token?: unknown };
  try {
    data = (await res.json()) as { access_token?: unknown };
  } catch (err) {
    return { ok: false, reason: 'unusable_response', detail: String(err) };
  }
  if (typeof data.access_token !== 'string' || data.access_token.length === 0) {
    return { ok: false, reason: 'unusable_response', detail: 'no access_token in response' };
  }
  return { ok: true, value: data.access_token };
}

/** `GET /users/@me` with the freshly minted user token. */
export async function fetchDiscordUser(accessToken: string): Promise<OAuthResult<DiscordIdentity>> {
  let res: Response;
  try {
    res = await fetch(`${DISCORD_API}/users/@me`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
  } catch (err) {
    return { ok: false, reason: 'discord_unreachable', detail: String(err) };
  }
  if (!res.ok) {
    return { ok: false, reason: 'discord_rejected', detail: `users/@me ${res.status}` };
  }
  let data: { id?: unknown; username?: unknown; global_name?: unknown };
  try {
    data = (await res.json()) as typeof data;
  } catch (err) {
    return { ok: false, reason: 'unusable_response', detail: String(err) };
  }
  return readDiscordUser(data);
}

/** The pure half of fetchDiscordUser — a decoded /users/@me body, validated. */
export function readDiscordUser(data: {
  id?: unknown;
  username?: unknown;
  global_name?: unknown;
}): OAuthResult<DiscordIdentity> {
  const id = typeof data.id === 'string' ? data.id : '';
  if (!SNOWFLAKE.test(id)) {
    return { ok: false, reason: 'unusable_response', detail: 'users/@me carried no usable id' };
  }
  const global = typeof data.global_name === 'string' ? data.global_name.trim() : '';
  const handle = typeof data.username === 'string' ? data.username.trim() : '';
  return { ok: true, value: { id, username: global || handle || `user ${id}` } };
}
