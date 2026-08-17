/**
 * MODERATION — the flows. `moderation.ts` holds the decisions; this file joins
 * them to Discord and to the audit collection.
 *
 * ⚠️ **EVERYTHING HERE IS DARK.** Every entry point takes an `enabled` flag
 * and re-checks it before doing anything, and `MODERATION_ENABLED` is `"off"`
 * in deployed configuration. The re-check is deliberately redundant with the
 * router's — a moderation path that could only be reached by one gate is a
 * moderation path one refactor away from being reachable by none.
 *
 * ## Two phases, on purpose
 *
 * The PLANNERS are pure and answer inside Discord's 3-second window: they
 * word every refusal (switched off, wrong place, missing permission, bad
 * duration, over the cap) without a single network call. Only a plan that
 * survives all of them defers, and only then does anything touch Discord.
 * A person who mistypes a duration therefore never waits on a round trip, and
 * a bot that is switched off performs no I/O at all.
 */

import {
  auditDocId,
  auditFields,
  buildConfirmCustomId,
  CONFIRM_TTL_MS,
  hasPermission,
  MOD_AUDIT_COLLECTION,
  MOD_MSG,
  parseCleanupArgs,
  parseDuration,
  parsePermissions,
  PERMISSION,
  selectForCleanup,
  type ChannelMessage,
  type CleanupPlan,
  type ModAuditEntry,
} from './moderation.js';
import {
  bulkDeleteMessages,
  deleteChannelMessage,
  editOriginalMessage,
  listChannelMessages,
  timeoutGuildMember,
} from './discord-api.js';
import { firestoreRequest, mintAccessToken, type ServiceAccount } from './firebase-sa.js';

const truncate = (s: string, max: number): string => (s.length <= max ? s : `${s.slice(0, max - 1)}…`);

// ---------------------------------------------------------------------------
// Shared shapes
// ---------------------------------------------------------------------------

export interface ModCallContext {
  enabled: boolean;
  /** Discord's computed permission bits for this member, as sent. */
  permissionsRaw: unknown;
  guildId: string;
  channelId: string;
  actorId: string;
  actorName: string;
  /** GABI's own application id — she refuses to moderate herself. */
  applicationId: string;
}

export type Refusal = { kind: 'refuse'; message: string };

export interface TimeoutPlan {
  targetUserId: string;
  targetName: string;
  seconds: number;
  label: string;
  reason: string;
}

export type TimeoutDecision = Refusal | { kind: 'proceed'; plan: TimeoutPlan };
export type CleanupDecision = Refusal | { kind: 'proceed'; plan: CleanupPlan };

/**
 * The gate every moderation path shares, in the order the estate's rules
 * require: the SWITCH first (so an off bot reveals nothing about permissions),
 * then "is this even a server", then the caller's own authority.
 */
function gate(ctx: ModCallContext, needed: bigint, missingMessage: string): Refusal | null {
  if (!ctx.enabled) return { kind: 'refuse', message: MOD_MSG.switchedOff };
  const bits = parsePermissions(ctx.permissionsRaw);
  if (bits === null || !ctx.guildId) return { kind: 'refuse', message: MOD_MSG.dmOnly };
  if (!hasPermission(bits, needed)) return { kind: 'refuse', message: missingMessage };
  return null;
}

// ---------------------------------------------------------------------------
// /timeout — the pure plan
// ---------------------------------------------------------------------------

export function planTimeout(
  ctx: ModCallContext,
  args: { targetUserId: string; targetName: string; duration: string; reason: string },
): TimeoutDecision {
  const refused = gate(ctx, PERMISSION.MODERATE_MEMBERS, MOD_MSG.needTimeoutPermission);
  if (refused) return refused;

  const targetUserId = (args.targetUserId ?? '').trim();
  if (!/^\d{1,20}$/.test(targetUserId)) return { kind: 'refuse', message: MOD_MSG.noTarget };
  if (targetUserId === ctx.actorId) return { kind: 'refuse', message: MOD_MSG.selfTarget };
  if (ctx.applicationId && targetUserId === ctx.applicationId) {
    return { kind: 'refuse', message: MOD_MSG.botTarget };
  }

  const duration = parseDuration(args.duration ?? '');
  if (!duration.ok) return { kind: 'refuse', message: duration.message };

  return {
    kind: 'proceed',
    plan: {
      targetUserId,
      targetName: (args.targetName ?? '').trim() || `<@${targetUserId}>`,
      seconds: duration.seconds,
      label: duration.label,
      reason: truncate((args.reason ?? '').trim(), 300),
    },
  };
}

// ---------------------------------------------------------------------------
// /cleanup — the pure plan
// ---------------------------------------------------------------------------

export function planCleanup(
  ctx: ModCallContext,
  args: { count: unknown; user?: unknown; contains?: unknown },
): CleanupDecision {
  const refused = gate(ctx, PERMISSION.MANAGE_MESSAGES, MOD_MSG.needCleanupPermission);
  if (refused) return refused;

  const parsed = parseCleanupArgs(args);
  if (!parsed.ok) return { kind: 'refuse', message: parsed.message };
  return { kind: 'proceed', plan: parsed.plan };
}

// ---------------------------------------------------------------------------
// The dependencies (injected, so the flows are testable without a network)
// ---------------------------------------------------------------------------

export interface DiscordCallResult {
  ok: boolean;
  status: number;
}

export interface ModDeps {
  timeoutMember(guildId: string, userId: string, untilIso: string, reason: string): Promise<DiscordCallResult>;
  listMessages(channelId: string, limit: number): Promise<ChannelMessage[]>;
  bulkDelete(channelId: string, ids: readonly string[], reason: string): Promise<DiscordCallResult>;
  deleteOne(channelId: string, id: string, reason: string): Promise<DiscordCallResult>;
  /** Never throws out of the flow — an audit failure must not undo or hide a
   * moderation action that already happened. */
  writeAudit(entry: ModAuditEntry): Promise<void>;
  /** Replace the deferred message with the final worded answer. */
  respond(payload: unknown): Promise<void>;
  now(): number;
  /** Key material for the confirm MAC (the bot token — see moderation.ts). */
  confirmKey: string;
}

// ---------------------------------------------------------------------------
// /timeout — the flow
// ---------------------------------------------------------------------------

export async function runTimeout(
  deps: ModDeps,
  ctx: ModCallContext,
  plan: TimeoutPlan,
): Promise<void> {
  // ⚠️ Redundant by design (see this file's header).
  if (!ctx.enabled) {
    await deps.respond({ content: MOD_MSG.switchedOff });
    return;
  }
  const at = new Date(deps.now()).toISOString();
  const untilIso = new Date(deps.now() + plan.seconds * 1000).toISOString();
  const auditReason = plan.reason
    ? `${plan.reason} — /timeout by ${ctx.actorName}`
    : `/timeout by ${ctx.actorName}`;

  let result: DiscordCallResult;
  try {
    result = await deps.timeoutMember(ctx.guildId, plan.targetUserId, untilIso, auditReason);
  } catch (err) {
    console.error('timeout call failed:', err instanceof Error ? err.message : err);
    await deps.respond({ content: MOD_MSG.outage });
    await safeAudit(deps, {
      action: 'timeout',
      outcome: 'failed',
      actorId: ctx.actorId,
      actorName: ctx.actorName,
      guildId: ctx.guildId,
      channelId: ctx.channelId,
      targetUserId: plan.targetUserId,
      durationSeconds: plan.seconds,
      reason: plan.reason,
      detail: 'discord unreachable',
      at,
    });
    return;
  }

  await safeAudit(deps, {
    action: 'timeout',
    outcome: result.ok ? 'applied' : 'refused_by_discord',
    actorId: ctx.actorId,
    actorName: ctx.actorName,
    guildId: ctx.guildId,
    channelId: ctx.channelId,
    targetUserId: plan.targetUserId,
    durationSeconds: plan.seconds,
    reason: plan.reason,
    detail: result.ok ? undefined : `discord status ${result.status}`,
    at,
  });

  await deps.respond({
    content: result.ok
      ? MOD_MSG.timeoutApplied(plan.targetName, plan.label, plan.reason)
      : MOD_MSG.timeoutRefused(result.status),
  });
}

// ---------------------------------------------------------------------------
// /cleanup — preview, then confirm
// ---------------------------------------------------------------------------

export function describeSelection(
  selection: ReturnType<typeof selectForCleanup>,
  plan: CleanupPlan,
): string {
  const filters: string[] = [];
  if (plan.targetUserId) filters.push(`from <@${plan.targetUserId}>`);
  if (plan.contains) filters.push(`containing “${plan.contains}”`);
  const scope = `the last ${plan.count} message${plan.count === 1 ? '' : 's'} in this channel` +
    (filters.length ? `, ${filters.join(' and ')}` : '');

  const lines = [`**Nothing has been deleted yet.** Looking at ${scope}:`];
  lines.push(
    selection.deletable.length === 0
      ? '• **0 messages** can be deleted.'
      : `• **${selection.deletable.length} message${selection.deletable.length === 1 ? '' : 's'}** would be deleted.`,
  );
  if (selection.tooOld.length > 0) {
    lines.push(
      `• ⚠️ **${selection.tooOld.length}** also matched but ${selection.tooOld.length === 1 ? 'is' : 'are'} ` +
        'more than **14 days old** — Discord refuses to bulk-delete those, so GABI will leave them ' +
        'alone rather than delete part of what you asked for. Delete them by hand if you need to.',
    );
  }
  if (selection.pinned.length > 0) {
    lines.push(
      `• 📌 **${selection.pinned.length}** matched but ${selection.pinned.length === 1 ? 'is' : 'are'} ` +
        'pinned, and GABI never deletes a pin — someone put it there on purpose.',
    );
  }
  const sample = selection.deletable.slice(0, 3);
  if (sample.length > 0) {
    lines.push('');
    lines.push('Oldest of what would go:');
    for (const m of sample.slice().reverse()) {
      lines.push(`> **${truncate(m.authorName, 32)}**: ${truncate((m.content ?? '').replace(/\n/g, ' ') || '(no text)', 80)}`);
    }
  }
  lines.push('');
  lines.push('_This preview is good for two minutes. Deletion cannot be undone._');
  return lines.join('\n');
}

export async function runCleanupPreview(
  deps: ModDeps,
  ctx: ModCallContext,
  plan: CleanupPlan,
): Promise<void> {
  if (!ctx.enabled) {
    await deps.respond({ content: MOD_MSG.switchedOff });
    return;
  }
  let messages: ChannelMessage[];
  try {
    messages = await deps.listMessages(ctx.channelId, plan.count);
  } catch (err) {
    console.error('cleanup preview read failed:', err instanceof Error ? err.message : err);
    await deps.respond({ content: MOD_MSG.outage });
    return;
  }

  const selection = selectForCleanup(messages, plan, deps.now());
  const body = describeSelection(selection, plan);

  if (selection.deletable.length === 0) {
    // No button at all — a confirm that would delete nothing is a trap, not a
    // choice.
    await deps.respond({ content: body });
    return;
  }

  const customId = await buildConfirmCustomId(
    deps.confirmKey,
    plan,
    { invokerId: ctx.actorId, channelId: ctx.channelId },
    deps.now() + CONFIRM_TTL_MS,
  );
  await deps.respond({
    content: body,
    components: [
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 4, // danger — a destructive action never wears a neutral button
            label: truncate(`Delete ${selection.deletable.length} message${selection.deletable.length === 1 ? '' : 's'}`, 80),
            custom_id: customId,
          },
        ],
      },
    ],
  });
}

export async function runCleanupConfirm(
  deps: ModDeps,
  ctx: ModCallContext,
  plan: CleanupPlan,
): Promise<void> {
  if (!ctx.enabled) {
    await deps.respond({ content: MOD_MSG.switchedOff, components: [] });
    return;
  }
  // The permission is re-checked at PRESS time, not merely at preview time: a
  // role can be removed in the two minutes between, and the authority that
  // matters is the one held at the moment of deletion.
  const refused = gate(ctx, PERMISSION.MANAGE_MESSAGES, MOD_MSG.needCleanupPermission);
  if (refused) {
    await deps.respond({ content: refused.message, components: [] });
    return;
  }

  const at = new Date(deps.now()).toISOString();
  let messages: ChannelMessage[];
  try {
    messages = await deps.listMessages(ctx.channelId, plan.count);
  } catch (err) {
    console.error('cleanup confirm read failed:', err instanceof Error ? err.message : err);
    await deps.respond({ content: MOD_MSG.outage, components: [] });
    return;
  }

  // ⚠️ Re-selected from the LIVE channel, never from the preview: two minutes
  // of chat may have moved things, and deleting a remembered list would delete
  // messages nobody previewed.
  const selection = selectForCleanup(messages, plan, deps.now());
  const ids = selection.deletable.map((m) => m.id);
  const reason = `/cleanup by ${ctx.actorName}`;

  if (ids.length === 0) {
    await deps.respond({
      content:
        'Nothing was deleted — by the time you confirmed, nothing in that window still matched. ' +
        'Run `/cleanup` again for a fresh look.',
      components: [],
    });
    return;
  }

  let result: DiscordCallResult;
  try {
    result =
      ids.length === 1
        ? await deps.deleteOne(ctx.channelId, ids[0] as string, reason)
        : await deps.bulkDelete(ctx.channelId, ids, reason);
  } catch (err) {
    console.error('cleanup delete failed:', err instanceof Error ? err.message : err);
    await deps.respond({ content: MOD_MSG.outage, components: [] });
    await safeAudit(deps, {
      action: 'cleanup',
      outcome: 'failed',
      actorId: ctx.actorId,
      actorName: ctx.actorName,
      guildId: ctx.guildId,
      channelId: ctx.channelId,
      messagesDeleted: 0,
      detail: 'discord unreachable',
      at,
    });
    return;
  }

  await safeAudit(deps, {
    action: 'cleanup',
    outcome: result.ok ? 'applied' : 'refused_by_discord',
    actorId: ctx.actorId,
    actorName: ctx.actorName,
    guildId: ctx.guildId,
    channelId: ctx.channelId,
    messagesDeleted: result.ok ? ids.length : 0,
    detail: result.ok ? undefined : `discord status ${result.status}`,
    at,
  });

  if (!result.ok) {
    await deps.respond({
      content:
        `Discord refused the deletion (HTTP ${result.status}), so **nothing was deleted**. The ` +
        'usual reasons are that GABI lacks Manage Messages in this channel, or that a message ' +
        'aged past 14 days between the preview and now. Nothing is half-done.',
      components: [],
    });
    return;
  }

  const extras: string[] = [];
  if (selection.tooOld.length > 0) {
    extras.push(
      `${selection.tooOld.length} older than 14 days ${selection.tooOld.length === 1 ? 'was' : 'were'} ` +
        'left alone — Discord will not bulk-delete those',
    );
  }
  if (selection.pinned.length > 0) {
    extras.push(`${selection.pinned.length} pinned ${selection.pinned.length === 1 ? 'message was' : 'messages were'} left alone`);
  }
  await deps.respond({
    content:
      `Deleted **${ids.length} message${ids.length === 1 ? '' : 's'}**` +
      (extras.length ? `. ${extras.join('; ')}.` : '.') +
      '\n\nThis is recorded in the estate’s moderation log and in this server’s own audit log.',
    components: [],
  });
}

// ---------------------------------------------------------------------------
// The real dependencies
// ---------------------------------------------------------------------------

async function safeAudit(deps: ModDeps, entry: ModAuditEntry): Promise<void> {
  try {
    await deps.writeAudit(entry);
  } catch (err) {
    // ⚠️ An audit failure is LOUD in the log and invisible to the person: the
    // action already happened, and telling them it failed would be false.
    console.error('moderation audit write failed:', err instanceof Error ? err.message : err);
  }
}

export function messageFromDiscord(raw: unknown): ChannelMessage | null {
  const m = raw as {
    id?: unknown;
    content?: unknown;
    timestamp?: unknown;
    pinned?: unknown;
    author?: { id?: unknown; username?: unknown; global_name?: unknown };
  };
  if (typeof m?.id !== 'string' || m.id.length === 0) return null;
  const ts = typeof m.timestamp === 'string' ? Date.parse(m.timestamp) : NaN;
  return {
    id: m.id,
    content: typeof m.content === 'string' ? m.content : '',
    // An unreadable timestamp is treated as ANCIENT (0), which lands it in the
    // "too old to bulk-delete" bucket — the safe side of the 14-day line.
    timestampMs: Number.isFinite(ts) ? ts : 0,
    authorId: typeof m.author?.id === 'string' ? m.author.id : '',
    authorName:
      (typeof m.author?.global_name === 'string' && m.author.global_name) ||
      (typeof m.author?.username === 'string' && m.author.username) ||
      'someone',
    pinned: m.pinned === true,
  };
}

export interface RealDepsInput {
  botToken: string;
  serviceAccount: ServiceAccount | null;
  applicationId: string;
  interactionToken: string;
}

/** Production wiring: Discord via the bot token, the audit line via the
 * service account, the answer via the interaction token. */
export function realModDeps(input: RealDepsInput): ModDeps {
  const status = (res: Response): DiscordCallResult => ({ ok: res.ok, status: res.status });
  return {
    confirmKey: input.botToken,
    now: () => Date.now(),

    async timeoutMember(guildId, userId, untilIso, reason) {
      return status(await timeoutGuildMember(input.botToken, guildId, userId, untilIso, reason));
    },

    async listMessages(channelId, limit) {
      const res = await listChannelMessages(input.botToken, channelId, limit);
      if (!res.ok) throw new Error(`channel message list failed (${res.status})`);
      const body = (await res.json()) as unknown[];
      const out: ChannelMessage[] = [];
      for (const raw of Array.isArray(body) ? body : []) {
        const m = messageFromDiscord(raw);
        if (m) out.push(m);
      }
      return out;
    },

    async bulkDelete(channelId, ids, reason) {
      return status(await bulkDeleteMessages(input.botToken, channelId, ids, reason));
    },

    async deleteOne(channelId, id, reason) {
      return status(await deleteChannelMessage(input.botToken, channelId, id, reason));
    },

    async writeAudit(entry) {
      const sa = input.serviceAccount;
      if (!sa) throw new Error('FIREBASE_SERVICE_ACCOUNT is not set — moderation audit not written');
      const token = await mintAccessToken(sa);
      const fields = auditFields(entry);
      const mask = Object.keys(fields)
        .map((f) => `updateMask.fieldPaths=${f}`)
        .join('&');
      const id = auditDocId(entry.at, crypto.randomUUID().slice(0, 8));
      const res = await firestoreRequest(
        sa,
        token,
        'PATCH',
        `${MOD_AUDIT_COLLECTION}/${encodeURIComponent(id)}?${mask}`,
        { fields },
      );
      if (!res.ok) throw new Error(`moderation audit write failed (${res.status})`);
    },

    async respond(payload) {
      await editOriginalMessage(input.applicationId, input.interactionToken, payload);
    },
  };
}
