/**
 * The two Discord REST calls the deferred vote flow needs. Both ride the
 * INTERACTION token (valid 15 minutes), not the bot token — editing the
 * original message and posting followups through the interaction webhook
 * needs no Authorization header at all, which keeps DISCORD_BOT_TOKEN
 * entirely out of the poll-vote path (it is held for phase-3 bot-posted
 * messages only).
 */

const DISCORD_API = 'https://discord.com/api/v10';

/** Discord message flag: visible only to the interacting user. */
export const EPHEMERAL_FLAG = 64;

/** Post an ephemeral followup — the worded rejection/outage channel. */
export async function followupEphemeral(
  applicationId: string,
  interactionToken: string,
  content: string,
): Promise<Response> {
  return fetch(`${DISCORD_API}/webhooks/${applicationId}/${interactionToken}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content, flags: EPHEMERAL_FLAG }),
  });
}

/** Edit the message the interaction came from (fresh tally + buttons). */
export async function editOriginalMessage(
  applicationId: string,
  interactionToken: string,
  payload: unknown,
): Promise<Response> {
  return fetch(`${DISCORD_API}/webhooks/${applicationId}/${interactionToken}/messages/@original`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
}
