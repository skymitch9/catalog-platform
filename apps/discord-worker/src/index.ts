/**
 * The estate Discord Worker — entrypoint. Wiring only; the decisions live
 * in sibling modules (verify.ts signatures, interactions.ts routing,
 * poll-vote.ts the vote flow, firebase-sa.ts the Firestore credential).
 *
 * Slash commands, and what each answers:
 *   /link      the identity-link ceremony (link.ts, commands.ts)
 *   /have      "is this book on the estate's shelves?" — the PUBLIC audiobook
 *              slice for everyone, no credential on the call (have.ts)
 *   /gabi      the fixer's Discord surface, shape (b) propose-and-deep-link
 *              (gabi.ts): a best-effort answer from the same public slice, plus
 *              a link into the real GABI panel. ⚠️ It runs NO tool loop, calls
 *              NO model, holds NO new secret and writes NOTHING — that is what
 *              lets it ship without any of gabi-fixer-design.md §10.2's four
 *              blockers being solved
 *   /timeout   ⚠️ DARK. Answers "moderation is switched off" while
 *   /cleanup   ⚠️ DARK.  MODERATION_ENABLED is anything but "on"
 *              (moderation.ts / mod-actions.ts), and is not even published to
 *              Discord until it is.
 *
 * What this is: the bot's single HTTP interactions endpoint
 * (discord-bot-design.md §1.3 — a dedicated Worker, deliberately apart from
 * auth-worker so the bot token and the estate directory stay separately
 * rotatable and separately auditable). Discord POSTs every interaction —
 * the PING handshake, buttons, slash commands — to the one URL configured
 * in the Developer Portal; there is no gateway connection.
 *
 *   POST /interactions               Ed25519-verified; PING→PONG; router.
 *                                    ⚠️ ALSO the continuity layer's fourth
 *                                    door: a press on a select menu / button
 *                                    GABI attached to an earlier answer, and
 *                                    the modal submit it can open, both arrive
 *                                    HERE as ordinary signed interactions —
 *                                    no gateway, no new endpoint, no new
 *                                    credential (conversation-flow.ts)
 *   GET  /api/health                 open; config-presence booleans, no values
 *   GET  /link, /link/callback       the identity-link ceremony (link.ts)
 *   POST /link/confirm, /link/unlink  — mounted, not implemented here
 *   POST /admin/commands/register    publish the slash-command registry
 *   POST /polls/sync                 post/refresh/close the votable poll
 *                                    messages (phase 3, poll-sync.ts)
 *
 * LIVE since 2026-08-16 at discord.heygabi.ai; the runbook remains
 * docs/access/discord-bot.md.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { AppBindings, Env } from './env.js';
import { verifyDiscordSignature } from './verify.js';
import {
  deferredEphemeral,
  deferredPublic,
  displayNameOf,
  ephemeralMessage,
  isInteraction,
  ResponseType,
  routeInteraction,
  type InteractionActor,
} from './interactions.js';
import { resumeConversation } from './conversation-flow.js';
import { CONFIRM_MSG, confirmT2On, verifyConfirmPress } from './confirm.js';
import { resumeConfirm } from './confirm-resume.js';
import {
  buildQuestionModal,
  CONV_MSG,
  CONVERSATION_MAX_EXCHANGES,
  CONVERSATION_WINDOW_MS,
} from './conversation.js';
import { processPollVote } from './poll-vote.js';
import { pollSyncRoutes } from './poll-sync.js';
import { questionSyncRoutes } from './question-sync.js';
import { parseServiceAccount, type ServiceAccount } from './firebase-sa.js';
import { linkConfigured, linkRoutes, LINK_MSG } from './link.js';
import {
  commandNames,
  commandsFor,
  isOwnerEmail,
  linkCommandMessage,
  putGlobalCommands,
  readLadderRole,
  roleIsAdmin,
} from './commands.js';
import { indexBase, processHave } from './have.js';
import { panelBase, panelDeepLink, processGabi } from './gabi.js';
import { mentionsOn } from './mentions.js';
import { catalogBase, CATALOG_PATH } from './catalog-data.js';
import {
  GABI_DELEGATED_VERB_NAMES,
  GABI_BOOKS_TOOL_NAMES,
  GABI_RECALL_TOOL_NAMES,
  GABI_SHELF_TOOL_NAMES,
  GABI_DOCS_TOOL_NAMES,
  GABI_TOOL_NAMES,
  GABI_TOOLS,
  MAX_TOOL_ITERATIONS,
} from './gabi-tools.js';
import { delegatedWritesOn, libraryInstances } from './delegated.js';
import { makeDelegate } from './delegated-exec.js';
import {
  DOCS_BYTES_PER_TURN,
  DOCS_SECTIONS_PER_TURN,
  DOCS_TURNS_PER_DAY,
  docsOn,
} from './estate-docs.js';
import { authBase } from './estate-docs-exec.js';
import {
  BOOKS_BYTES_PER_TURN,
  BOOKS_MAX_REPLY_PARTS,
  BOOKS_PASSAGE_RUN_MAX,
  BOOKS_PASSAGES_PER_TURN,
  BOOKS_TURNS_PER_DAY,
  booksOn,
} from './book-knowledge.js';
import { audiobookApiBase } from './book-knowledge-exec.js';
import { memoryOn, PROFILE_MAX_BYTES } from './memory.js';
import { ARCHIVE_RETENTION_DAYS, RECALL_SCAN_ROWS } from './archive.js';
import { personalityOn, TROPES } from './personality.js';
import { shelfOn } from './shelf.js';
import { PHYSICAL_SOURCE_INSTANCE, suggestOn } from './suggest.js';
import { GATEWAY_INTENTS, gatewayStub } from './gateway.js';
import {
  moderationOn,
  MOD_MSG,
  verifyConfirmCustomId,
  type CleanupPlan,
} from './moderation.js';
import {
  planCleanup,
  planTimeout,
  realModDeps,
  runCleanupConfirm,
  runCleanupPreview,
  runTimeout,
  type ModCallContext,
} from './mod-actions.js';
import { resolveIdentity } from '@platform/estate-auth';

const app = new Hono<AppBindings>();

// ---------------------------------------------------------------------------
// Health — same open, no-PII pattern as auth.heygabi.ai / index.heygabi.ai
// (design doc §1.7). Booleans about which secrets are PRESENT, never values.
// ---------------------------------------------------------------------------
app.get('/api/health', (c) =>
  c.json({
    ok: true,
    service: 'estate-discord',
    features: [
      'interactions_endpoint',
      'poll_vote_component',
      'identity_link',
      'poll_message_sync',
      // ⚠️ Added 2026-08-18: GABI's book-club discussion questions, posted
      // into each opted-in club's own channel. Named here so "does she post
      // the questions in Discord?" is answerable in one curl rather than by
      // waiting eight hours for a pipeline tick.
      'club_question_sync',
      'have_command',
      'gabi_command',
      'moderation_dark',
      'gabi_mentions',
      // ⚠️ Added 2026-08-17: the rolling per-person memory, the reply/DM doors,
      // and the clarifying-question components. Named here so "does she
      // remember?" is answerable in one curl rather than by pressing something.
      'gabi_continuity',
      // ⚠️ Added 2026-08-18: the read-only catalogue tools the model may call
      // during a turn. Named here so "can she answer who narrates X?" is
      // answerable in one curl rather than by asking her.
      'gabi_catalog_tools',
      // ⚠️ Added 2026-08-18: TIER 1, and the first feature in this list that
      // WRITES — DM her an ISBN and she adds the book; ask her to fix your
      // missing details and she runs the sweep, always with the ASKER'S OWN
      // standing, checked by the destination catalog. Named here so "can she
      // actually add a book?" is answerable in one curl.
      'gabi_delegated_writes',
      // ⚠️ Added 2026-08-18: TIER 0b — she reads the estate's own internal
      // documentation, on the ASKER'S OWN standing, checked per question by the
      // auth Worker. Named here so "can she answer how do I promote?" is
      // answerable in one curl rather than by DMing her.
      'gabi_estate_docs',
    ],
    configured: {
      discord_public_key: Boolean(c.env.DISCORD_PUBLIC_KEY),
      discord_application_id: Boolean(c.env.DISCORD_APPLICATION_ID),
      discord_bot_token: Boolean(c.env.DISCORD_BOT_TOKEN),
      firebase_service_account: Boolean(c.env.FIREBASE_SERVICE_ACCOUNT),
      // ⚠️ Reports FALSE until the conductor mints it and gives the SAME value
      // to the audiobook pipeline. Same honest-false discipline as the row
      // below: the ships-dark state of phase 3's sync route is VISIBLE here
      // rather than inferred from a POST nobody made.
      poll_sync_token: Boolean(c.env.POLL_SYNC_TOKEN),
      // ⚠️ Reports FALSE until the owner sets it (docs/access/discord-bot.md
      // §3 step 7). An honest false is the point of this row: it is how the
      // ships-dark state is VISIBLE rather than inferred from a page nobody
      // loaded. Not a value, not a prefix — a boolean, like every row here.
      discord_client_secret: Boolean(c.env.DISCORD_CLIENT_SECRET),
      firebase_project_id: Boolean(c.env.FIREBASE_PROJECT_ID),
      // ⚠️ Reports FALSE until the owner mints and pastes it. Same honest-false
      // discipline as every row here — and its absence is a LADDER, not a
      // fault: without it GABI still answers mentions from the keyword router
      // (src/mentions.ts), she just has no conversational half. A missing key
      // never produces an error message in a channel.
      anthropic_key_gabi: Boolean(c.env.ANTHROPIC_API_KEY_GABI),
      // ⚠️ TIER 1. Reports FALSE until the conductor mints it and pipes the
      // SAME value to BOTH library Workers — one value, three holders, same
      // name (the DONOR_TOKEN idiom). Same honest-false discipline as every row
      // here, and its absence is a LADDER not a fault: with it unset she says
      // "I'm not wired up to write yet" and every read-only answer is unchanged.
      // ⚠️ A boolean about a NAME. It is not proof the three holders agree —
      // only a real delegated call answering something other than 401 is that.
      estate_app_token_discord: Boolean(c.env.ESTATE_APP_TOKEN_DISCORD),
      // ⚠️ TIER 0b, and it is a DIFFERENT secret from the row above — that one
      // is shared with both library Workers for the delegated writes; this one
      // has exactly two holders (this Worker and the auth Worker) because the
      // docs corpus is a separate, higher-value trust edge. Same honest-false
      // discipline as every row here.
      // ⚠️ A boolean about a NAME. It is not proof the two holders agree — only
      // a real docs call answering something other than 401 is that.
      estate_app_token_discord_docs: Boolean(c.env.ESTATE_APP_TOKEN_DISCORD_DOCS),
    },
    // The one derived answer: both halves present, so /link can actually run.
    link_ready: linkConfigured(c.env) && Boolean(c.env.FIREBASE_PROJECT_ID),
    // The same question for phase 3: a sync tick needs the caller's token,
    // the bot token to post with, and the service account to read polls.
    // All three or it is dark — reported as one honest boolean, not three
    // rows a reader has to AND together themselves.
    poll_sync_ready:
      Boolean(c.env.POLL_SYNC_TOKEN) &&
      Boolean(c.env.DISCORD_BOT_TOKEN) &&
      Boolean(c.env.FIREBASE_SERVICE_ACCOUNT),
    // ⚠️ The same three secrets, so this is IDENTICAL to the row above by
    // construction — stated as its own row anyway, because a reader asking
    // "can she post club questions?" should not have to know that the answer
    // happens to be spelled `poll_sync_ready`. If the two ever diverge (a
    // question-only secret, say), this row is already the place that says so.
    // ⚠️ Neither row says a club has OPTED IN: that is per-club
    // `features.discordQuestions`, and with none set this reads `true` while
    // nothing posts anywhere. Readiness is about the Worker, not the clubs.
    question_sync_ready:
      Boolean(c.env.POLL_SYNC_TOKEN) &&
      Boolean(c.env.DISCORD_BOT_TOKEN) &&
      Boolean(c.env.FIREBASE_SERVICE_ACCOUNT),
    // ⚠️ The kill switch, VISIBLE from outside — the same honest-false
    // discipline as the two rows above. A var, not a secret, so reporting the
    // derived boolean leaks nothing; and `false` here is the whole state of
    // the moderation build, checkable without pressing anything.
    moderation_enabled: moderationOn(c.env),
    // What scope /have answers at, for everyone (design §4 decision 4). Stated
    // rather than inferred: if this ever reads anything but `audiobook`, the
    // privacy line moved and somebody should know why.
    have_scope: 'audiobook',
    // ⚠️ `/gabi`'s SHAPE, stated from outside rather than inferred from a
    // command nobody ran. `propose_and_deep_link` is the design's shape (b):
    // the bot reads the public slice and links to the panel; it runs no tool
    // loop and calls no model. If this ever reads anything else, the token
    // custody question (§10.2 blocker 2) was answered by somebody and that is
    // a decision worth finding in one curl. The URL is a var and public —
    // reporting it leaks nothing and makes a misconfigured link visible.
    gabi_surface: 'propose_and_deep_link',
    gabi_panel_url: panelDeepLink(panelBase(c.env)),
    // ⚠️ The conversational kill switch, VISIBLE from outside — same reasoning
    // as `moderation_enabled` above. `false` here is the whole state of the
    // phase-A mention build, checkable in one curl, and it means no gateway
    // WebSocket is open at all rather than "open but quiet".
    gabi_mentions_enabled: mentionsOn(c.env),
    // ⚠️ THE TIER-1 KILL SWITCH and its readiness, VISIBLE from outside — same
    // reasoning as `moderation_enabled` and `gabi_mentions_enabled` above.
    // `gabi_delegated_ready` is the derived answer a reader would otherwise
    // have to AND together themselves: the switch is on, the app token exists,
    // and the service account that reads the /link document exists. All three
    // or she cannot write, and she says so in words rather than failing.
    gabi_delegated_enabled: delegatedWritesOn(c.env),
    gabi_delegated_ready:
      delegatedWritesOn(c.env) &&
      Boolean(c.env.ESTATE_APP_TOKEN_DISCORD) &&
      Boolean(c.env.FIREBASE_SERVICE_ACCOUNT),
    // ⚠️ The WRITE surface, stated rather than inferred — the exact mirror of
    // `have_scope` above. These are the only things she can ask a catalog to
    // do, they are the library Workers' own route names, and both ends pin the
    // array with a build-failing test. If this ever grows a verb that changes
    // an existing value, deletes something, or touches a role, the T0–T4 ladder
    // moved and somebody should find that in one curl.
    gabi_delegated_verbs: GABI_DELEGATED_VERB_NAMES,
    gabi_delegated_targets: libraryInstances(c.env).map((i) => i.baseUrl),
    // ⚠️ Stated rather than inferred, because it is the claim the whole design
    // rests on: every door she can be reached through is one Discord delivers
    // content for WITHOUT the Message Content intent. Three now, not one —
    // an @mention, a reply to one of her own regular messages with the ping
    // left on, and a direct message. If this ever reads anything with "bare" or
    // "any_message" in it, somebody requested the privileged intent and that is
    // a decision worth finding in one curl.
    gabi_mentions_trigger: 'at_mention_reply_or_dm',
    gabi_mentions_privileged_intent: false,
    // The requested intent bitfield itself, so the claim above is CHECKABLE
    // rather than merely asserted: 4609 = GUILDS | GUILD_MESSAGES |
    // DIRECT_MESSAGES, all unprivileged. MESSAGE_CONTENT is 1 << 15 = 32768.
    gabi_gateway_intents: GATEWAY_INTENTS,
    // ⚠️ The memory, in the two numbers that define it. A reader who wants to
    // know "how much does she remember" gets an answer without reading code,
    // and a drift in either is visible from outside.
    gabi_memory_window_minutes: CONVERSATION_WINDOW_MS / 60_000,
    gabi_memory_max_exchanges: CONVERSATION_MAX_EXCHANGES,
    // Where the memory lives. Stated because the alternative answers (D1,
    // Firestore, a second Durable Object) each carry a cost this account
    // cannot pay, and a future reader deserves to know which one was chosen.
    gabi_memory_store: 'gateway_durable_object_storage',
    // ⚠️ THE TOOL ALLOWLIST, VISIBLE FROM OUTSIDE. The estate's default-deny
    // rule is only as good as somebody's ability to check it, and "what can the
    // bot in my server actually do?" should not require reading TypeScript.
    // Every name here is READ-ONLY by construction (test/gabi-tools.test.ts
    // fails the build otherwise); if this list ever grows a `set_`, `add_` or
    // `delete_` verb, that is a decision worth finding in one curl.
    gabi_tools: GABI_TOOL_NAMES,
    gabi_tools_mutating: GABI_TOOLS.filter((t) => t.mutates).map((t) => t.name),
    gabi_tool_max_iterations: MAX_TOOL_ITERATIONS,
    // ⚠️ Which estate surface those tools read, stated rather than inferred.
    // The index holds NO narrator, duration or genre column (measured
    // 2026-08-18 against migrations/0001_entry.sql), so this host is where the
    // metadata comes from — and it is a PUBLIC one, read with no credential,
    // which is the whole scope argument. If this ever names a gated host,
    // somebody answered the token-custody question and that should be findable.
    gabi_catalog_url: `${catalogBase(c.env).replace(/\/+$/, '')}${CATALOG_PATH}`,
    gabi_catalog_scope: 'public_audiobook_catalogue_no_credential',
    // ⚠️ THE DOCS KILL SWITCH and its readiness, VISIBLE from outside — same
    // reasoning as the three switches above. `gabi_docs_ready` is the derived
    // answer a reader would otherwise have to AND together themselves: the
    // switch is on, the docs app token exists, and the service account that
    // reads the /link document exists. All three or she cannot read the docs,
    // and she says so in words rather than failing.
    gabi_docs_enabled: docsOn(c.env),
    gabi_docs_ready:
      docsOn(c.env) &&
      Boolean(c.env.ESTATE_APP_TOKEN_DISCORD_DOCS) &&
      Boolean(c.env.FIREBASE_SERVICE_ACCOUNT),
    // ⚠️ THE DOCS TOOL ALLOWLIST, VISIBLE FROM OUTSIDE — and kept in its own row
    // rather than folded into `gabi_tools` above, because the two read
    // different things: those reach a PUBLIC csv, these reach a GATED corpus
    // carrying break-glass SQL, secret names and household emails. If this list
    // ever grows a verb that writes, or `gabi_docs_scope` ever stops naming a
    // per-asker check, that is a decision worth finding in one curl.
    gabi_docs_tools: GABI_DOCS_TOOL_NAMES,
    gabi_docs_scope: 'gated_estate_docs_per_asker_devops_check',
    gabi_docs_authority: authBase(c.env),
    // The caps, stated rather than inferred. A docs turn is roughly an order of
    // magnitude heavier than an ordinary one, so its fuses are its own.
    gabi_docs_bytes_per_turn: DOCS_BYTES_PER_TURN,
    gabi_docs_sections_per_turn: DOCS_SECTIONS_PER_TURN,
    gabi_docs_turns_per_day: DOCS_TURNS_PER_DAY,
    // ⚠️ THE BOOK KILL SWITCH and its readiness, VISIBLE from outside — the
    // fourth switch, and the one that opens the household's own book TEXT.
    // `gabi_books_ready` is the AND a reader would otherwise have to compute:
    // the switch is on, the BOOK app token exists (its own pair — not the docs
    // one and not the Tier-1 one), and the service account that reads the /link
    // document exists. All three or she cannot read a book, and she says so in
    // words rather than failing.
    gabi_books_enabled: booksOn(c.env),
    gabi_books_ready:
      booksOn(c.env) &&
      Boolean(c.env.ESTATE_APP_TOKEN_BOOKS) &&
      Boolean(c.env.FIREBASE_SERVICE_ACCOUNT),
    // ⚠️ Its own row again, for the same reason the docs row is its own: these
    // reach GATED book text, scoped per person BY READING POSITION, which
    // neither of the other two surfaces is.
    gabi_books_tools: GABI_BOOKS_TOOL_NAMES,
    gabi_books_scope: 'gated_book_text_per_asker_vis_ebooks_check',
    gabi_books_authority: audiobookApiBase(c.env),
    gabi_books_bytes_per_turn: BOOKS_BYTES_PER_TURN,
    gabi_books_passages_per_turn: BOOKS_PASSAGES_PER_TURN,
    gabi_books_turns_per_day: BOOKS_TURNS_PER_DAY,
    // ⚠️ Auto-continue's two bounds, stated rather than inferred (owner decision
    // 2026-08-18, option C). A long answer becomes consecutive messages instead
    // of a permission question, and these are what stops that being unlimited.
    gabi_books_max_reply_parts: BOOKS_MAX_REPLY_PARTS,
    gabi_books_passage_run_max: BOOKS_PASSAGE_RUN_MAX,
    // ⚠️ TIER 2 — the durable per-person profile. `ready` is the AND a reader
    // would otherwise compute: the posture is on AND the service account that
    // stores profiles exists. No app token appears here, and that absence is the
    // design's own argument for Firestore — no new trust edge.
    gabi_memory_enabled: memoryOn(c.env),
    gabi_memory_ready: memoryOn(c.env) && Boolean(c.env.FIREBASE_SERVICE_ACCOUNT),
    gabi_memory_profile_max_bytes: PROFILE_MAX_BYTES,
    // ⚠️ **TIER 3 + 4 — THE 90-DAY ARCHIVE AND THE RECALL TOOL, REPORTED AS
    // THEIR OWN ROWS.** The design shares ONE posture across tiers 2-4, so
    // flipping `GABI_MEMORY` on turned these on too the moment they deployed —
    // the owner approved the whole build, and these rows exist so that
    // consequence is VISIBLE in one curl rather than inferred from a design doc.
    gabi_archive_enabled: memoryOn(c.env),
    gabi_archive_ready: memoryOn(c.env) && Boolean(c.env.FIREBASE_SERVICE_ACCOUNT),
    gabi_archive_retention_days: ARCHIVE_RETENTION_DAYS,
    gabi_archive_collection: 'gabi_conversations',
    // ⚠️ WHAT A RECALL CAN ACTUALLY SEE, stated rather than assumed. The search
    // is LEXICAL over the newest N turns of the ASKER'S OWN archive; a match
    // older than that is not found, and every answer says how far back it looked.
    gabi_recall_tools: GABI_RECALL_TOOL_NAMES,
    gabi_recall_scope: 'own_past_conversations_person_keyed_server_side',
    gabi_recall_scan_rows: RECALL_SCAN_ROWS,
    // ⚠️ FALSE until somebody creates the Firestore TTL policy on
    // `gabi_conversations.expiresAt` (design §9 owner step 2). Nothing here can
    // check it — a Worker cannot read a TTL policy — so this row reports the
    // ESTATE'S OWN CLAIM, not a measurement, and says so by its name.
    gabi_archive_ttl_policy_claimed: false,
    // ⚠️ PERSONALITY. The roster is listed because "what can the bot in my
    // server actually do" should be answerable in one curl — but the hidden PIN
    // is deliberately NOT named anywhere a person would look, per the owner.
    gabi_personality_enabled: personalityOn(c.env),
    gabi_personality_tropes: TROPES,
    // ⚠️ Person-keyed conversations, stated so a debugger does not go hunting
    // for channel-scoped records that no longer exist.
    gabi_conversation_scope: 'person',
    // ⚠️ TIER 0d — the asker's own shelf. `ready` needs no app token, because
    // both stores are Firestore collections this Worker already reaches.
    gabi_shelf_enabled: shelfOn(c.env),
    gabi_shelf_ready: shelfOn(c.env) && Boolean(c.env.FIREBASE_SERVICE_ACCOUNT),
    gabi_shelf_tools: GABI_SHELF_TOOL_NAMES,
    // ⚠️ BOOK SUGGESTIONS. `enabled` is the lever; `ready` is deliberately
    // per-FORMAT rather than one boolean, because the three formats have three
    // different gates and "suggestions are on" tells a debugger nothing about
    // which of them can actually answer.
    gabi_suggest_enabled: suggestOn(c.env),
    gabi_suggest_audio_ready: suggestOn(c.env),
    // ⚠️ The ebook gate ASKS the audiobook Worker about `vis_ebooks`, so it needs
    // the books port — with GABI_BOOKS off there is nothing to ask and an ebook
    // suggestion answers with a SETUP sentence, never a permissions one.
    gabi_suggest_ebook_ready: suggestOn(c.env) && booksOn(c.env) && Boolean(c.env.ESTATE_APP_TOKEN_BOOKS),
    // ⚠️ The physical gate asks the delegated `whoami` whether the asker is known
    // on the instance the print row came from.
    gabi_suggest_physical_ready:
      suggestOn(c.env) && Boolean(c.env.ESTATE_APP_TOKEN_DISCORD) && Boolean(c.env.FIREBASE_SERVICE_ACCOUNT),
    gabi_suggest_physical_instance: PHYSICAL_SOURCE_INSTANCE,
    // ⚠️ THE DEVOPS-GATED LANES (the personality roster and the set/clear verb)
    // ride the DOCS port, because that is where an "is this person devops"
    // question already gets answered by the auth Worker. With GABI_DOCS off there
    // is nothing to ask, and both answer with a setup sentence.
    gabi_persona_admin_ready: personalityOn(c.env) && docsOn(c.env) && Boolean(c.env.ESTATE_APP_TOKEN_DISCORD_DOCS),
    gabi_persona_admin_gate: 'estate_devops_via_docs_port',
  }),
);

// ---------------------------------------------------------------------------
// The identity-link ceremony (design §1.6, phase 2). Everything about it —
// the OAuth trip, the two proofs, the write, the revoke, the pages — is in
// link.ts; this file only wires it, per the estate's thin-entrypoint rule.
// ---------------------------------------------------------------------------
app.route('/', linkRoutes);

// ---------------------------------------------------------------------------
// POST /polls/sync — phase 3. The audiobook pipeline's club_announcements.py
// pokes this on its existing cadence; the Worker then posts/edits the votable
// poll messages with the bot token. Token-gated, ships dark, and reads every
// fact it acts on from Firestore itself (poll-sync.ts's header explains why
// the trigger carries no club data).
// ---------------------------------------------------------------------------
app.route('/', pollSyncRoutes);

// ---------------------------------------------------------------------------
// POST /questions/sync — GABI's book-club discussion questions (2026-08-18).
// The SAME pipeline poke, on the same cadence, gated by the same
// POLL_SYNC_TOKEN — a SEPARATE route so a question sweep that fails can never
// take the poll tick's tallies down with it. What it posts are the "Post as
// GABI" starter questions from the club read page, which are ordinary comments
// carrying `isBot: true` and are NOT polls; see question-sync.ts's header for
// the measurement that decided the whole shape.
// ---------------------------------------------------------------------------
app.route('/', questionSyncRoutes);

// ---------------------------------------------------------------------------
// POST /admin/commands/register — publish the slash-command registry to
// Discord. Estate admin only; see commands.ts for why this is a route rather
// than a script (the credentials live in the Worker and nowhere else).
//
// CORS locked to the apex (2026-08-17): the registration is performed from
// the /admin page with the admin's own bearer, and that page's CSP names this
// Worker — the auth-worker's adminCors idiom, origin pinned rather than
// env-configurable because exactly one page legitimately calls this.
// ---------------------------------------------------------------------------
app.use(
  '/admin/commands/register',
  cors({
    origin: 'https://heygabi.ai',
    allowMethods: ['POST', 'OPTIONS'],
    allowHeaders: ['Authorization', 'Content-Type'],
    maxAge: 600,
  }),
);
/**
 * The estate-admin gate, in ONE place — extracted 2026-08-17 when the gateway
 * poke became a second route needing it. Returns `null` when the caller may
 * proceed and a fully-worded refusal otherwise; ⚠️ every refusal says what
 * happened, what it needs and how to get it, and an OUTAGE is never dressed up
 * as a permissions problem (the estate's no-bare-status rule).
 */
async function adminGate(c: {
  req: { raw: Request };
  env: Env;
  json: (body: unknown, status?: number) => Response;
}): Promise<Response | null> {
  let identity;
  try {
    identity = await resolveIdentity(c.req.raw, c.env);
  } catch (err) {
    console.error('estate admin verifier misconfigured:', err instanceof Error ? err.message : err);
    return c.json({ ok: false, message: LINK_MSG.misconfigured }, 503);
  }
  if (!identity || !identity.uid) {
    return c.json(
      {
        ok: false,
        message:
          'You are not signed in to the estate, so nothing was done. Send a Firebase ID ' +
          'token as `Authorization: Bearer <token>` from an estate admin account.',
      },
      401,
    );
  }

  if (!isOwnerEmail(c.env, identity.email)) {
    let role: string | null;
    try {
      role = await readLadderRole(c.env, identity.uid);
    } catch (err) {
      // An outage is NEVER reported as a permissions refusal.
      console.error('ladder role read failed:', err instanceof Error ? err.message : err);
      return c.json(
        {
          ok: false,
          message:
            'Your permissions could not be checked because the estate directory did not answer ' +
            '(a service problem, NOT a permissions one). Nothing was done — try again shortly.',
        },
        502,
      );
    }
    if (!roleIsAdmin(role)) {
      return c.json(
        {
          ok: false,
          message:
            'This is an estate `admin` action, and this account ' +
            `holds ${role ?? 'no role'}. Ask an estate admin to run it, or to grant the role from ` +
            'the audiobook site’s admin page.',
        },
        403,
      );
    }
  }
  return null;
}

/**
 * ⚠️ **THE DEVOPS GATE FOR THE OPERATIONS ROUTES — ASKED, NEVER HELD.**
 *
 * `adminGate` above is the ESTATE-ADMIN gate: it reads `site_roles/{uid}` and
 * demands `admin` or `owner`. That is right for publishing a command registry to
 * Discord, and it is wrong for an operations dashboard: `/status` is gated on
 * **devops**, which the estate directory computes as *devops OR approver OR
 * owner*, and the two ladders are genuinely different lists.
 *
 * So this asks the auth Worker the same question the browser door asks, with
 * **the caller's own bearer** — the `devops-gate.ts` idiom moved to HTTP:
 *
 * | outcome | means |
 * |---|---|
 * | `200` + `is_devops`/`is_approver` | allowed |
 * | `200` without either | ⚠️ a real refusal, worded, naming what it needs |
 * | `401` | not signed in — a different sentence, and a different fix |
 * | anything else | ⚠️ **UNKNOWN, worded as an OUTAGE.** Never a refusal |
 *
 * ⚠️ **NO SECOND COPY OF "WHO IS DEVOPS" IS CREATED, and that is the point.**
 * A local copy would be a second thing to forget to revoke, and revoking
 * somebody in `/admin` has to shut every door at once. ⚠️ **And no credential is
 * forwarded** — the token in the header is the caller's own Firebase ID token,
 * asserting the identity they already proved to their own browser.
 */
async function devopsHttpGate(c: {
  req: { raw: Request };
  env: Env;
  json: (body: unknown, status?: number) => Response;
}): Promise<Response | null> {
  const auth = c.req.raw.headers.get('authorization') ?? '';
  if (!auth.toLowerCase().startsWith('bearer ')) {
    return c.json(
      {
        ok: false,
        message:
          'You are not signed in to the estate, so nothing was read. Sign in on heygabi.ai and ' +
          'open this from the /status pages, which send your token for you.',
      },
      401,
    );
  }

  let res: Response;
  try {
    res = await fetch(`${authBase(c.env)}/api/estate/me`, { headers: { authorization: auth } });
  } catch (err) {
    console.error('devops gate: /api/estate/me was unreachable:', err instanceof Error ? err.message : err);
    return c.json(
      {
        ok: false,
        message:
          'Your access could not be checked because the estate directory did not answer — that is a ' +
          'service problem on our side, NOT a permissions one. Nothing was read; try again shortly.',
      },
      502,
    );
  }
  if (res.status === 401) {
    return c.json(
      {
        ok: false,
        message:
          'The estate did not recognise that sign-in — it may simply have expired. Sign in again on ' +
          'heygabi.ai and reload this page.',
      },
      401,
    );
  }
  if (!res.ok) {
    // ⚠️ A NETWORK OR SERVER FAILURE IS NOT A PERMISSION FAILURE. Mislabelling
    // an outage sends people asking for access they already hold.
    console.error(`devops gate: /api/estate/me answered HTTP ${res.status}.`);
    return c.json(
      {
        ok: false,
        message:
          'Your access could not be checked because the estate directory answered with an error — a ' +
          'service problem, NOT a permissions one. Nothing was read; try again shortly.',
      },
      502,
    );
  }

  let body: { is_devops?: unknown; is_approver?: unknown; email?: unknown };
  try {
    body = (await res.json()) as typeof body;
  } catch {
    return c.json(
      {
        ok: false,
        message:
          'Your access could not be checked — the estate directory answered in a shape this Worker ' +
          'did not understand. A service problem, not a permissions one. Nothing was read.',
      },
      502,
    );
  }
  if (body.is_devops === true || body.is_approver === true) return null;

  return c.json(
    {
      ok: false,
      message:
        'This is a devops view of how GABI is behaving, and this account is not devops-class. Ask an ' +
        'estate admin to grant devops on the audiobook site’s /admin page, and it will work on your ' +
        'next reload — no deploy needed.',
    },
    403,
  );
}

app.post('/admin/commands/register', async (c) => {
  const refusal = await adminGate(c);
  if (refusal) return refusal;

  const applicationId = c.env.DISCORD_APPLICATION_ID;
  const botToken = c.env.DISCORD_BOT_TOKEN;
  if (!applicationId || !botToken) {
    return c.json(
      {
        ok: false,
        message:
          'The bot credentials needed to publish commands are not set on the Worker (a ' +
          'configuration gap, NOT a permissions problem). Nothing was published — see ' +
          'docs/access/discord-bot.md §2.',
      },
      503,
    );
  }

  // ⚠️ The registry is a FUNCTION of MODERATION_ENABLED (commands.ts explains
  // the choice in full): while the switch is off, Discord is told about /link
  // and /have only, and the moderation pair is published by re-running this
  // route AFTER the owner flips it.
  const registry = commandsFor(c.env);
  const result = await putGlobalCommands(applicationId, botToken, registry);
  if (!result.ok) {
    console.error('slash command registration failed:', result.status, result.detail);
    return c.json(
      {
        ok: false,
        message:
          'Discord refused the command registration (a problem between the estate and Discord, ' +
          'NOT a permissions problem with your account). Nothing was published — try again shortly.',
        discord_status: result.status,
      },
      502,
    );
  }
  return c.json({
    ok: true,
    message:
      `Published ${result.count} global command(s). Global commands can take up to an hour to ` +
      'appear the first time; updates show up almost immediately.' +
      (moderationOn(c.env)
        ? ' Moderation is ON, so /timeout and /cleanup were published too.'
        : ' Moderation is switched off, so /timeout and /cleanup were deliberately NOT published — ' +
          're-run this route after MODERATION_ENABLED is flipped to "on" and they will appear.'),
    commands: commandNames(registry),
    moderation_enabled: moderationOn(c.env),
  });
});

// ---------------------------------------------------------------------------
// POST /admin/gateway/start — wake the conversational gateway (phase A).
//
// The Durable Object in src/gateway.ts holds the one outbound WebSocket that
// lets GABI HEAR @mentions. It needs somebody to exist before it can connect,
// and there are exactly two pokers: the cron below (every two minutes, so the
// connection exists without traffic) and this route, for a person who has just
// flipped the posture and does not want to wait.
//
// ⚠️ Estate admin only, same gate as the command registry — the poke costs
// money in the sense that it opens a billable Durable Object.
// ⚠️ It is also the ONLY way to clear the object's fatal flag: after a 4004
// (bad token) or 4014 (unapproved intent) the object deliberately stops
// reconnecting, and a person has to fix the cause and say so.
// ---------------------------------------------------------------------------
app.use(
  '/admin/gateway/start',
  cors({
    origin: 'https://heygabi.ai',
    allowMethods: ['POST', 'OPTIONS'],
    allowHeaders: ['Authorization', 'Content-Type'],
    maxAge: 600,
  }),
);
// ---------------------------------------------------------------------------
// GET /admin/gabi/turnlog — ⚠️ THE DIAGNOSTIC THE 2026-08-18 SILENCE NEEDED.
//
// A real person asked GABI a question in a channel, got nothing at all, and
// asked "Did you turn her off?" — and there was **nowhere to look**: no
// observability, no event-ring wiring, no record of an unanswered turn, and
// per-day fuse counters with no history. `src/turnlog.ts` lists all five
// instruments and why each correctly knew nothing.
//
// This is the read side of the ring: the last forty turns, what lane claimed
// each one, which tools actually fired, what scope hid it, and — the field the
// whole thing exists for — whether words reached the channel.
//
// ⚠️ **DEVOPS-GATED, and the check is ASKED rather than held** (`devopsHttpGate`
// below). ⚠️ **It carries no message text and no answer text**, by construction
// rather than by filtering; the ring never stored any.
// ---------------------------------------------------------------------------
app.use(
  '/admin/gabi/turnlog',
  cors({
    origin: 'https://heygabi.ai',
    allowMethods: ['GET', 'OPTIONS'],
    allowHeaders: ['Authorization', 'Content-Type'],
    maxAge: 600,
  }),
);
app.get('/admin/gabi/turnlog', async (c) => {
  const refusal = await devopsHttpGate(c);
  if (refusal) return refusal;

  const stub = gatewayStub(c.env);
  if (!stub) {
    return c.json(
      {
        ok: false,
        message:
          'The gateway Durable Object is not bound on this Worker, so there is no turn ring to ' +
          'read (a configuration gap, NOT a permissions problem). Check the ' +
          '[[durable_objects.bindings]] entry for GABI_GATEWAY in wrangler.toml.',
      },
      503,
    );
  }
  const res = await stub.fetch('https://gateway.internal/turnlog');
  return c.json((await res.json()) as Record<string, unknown>);
});

// Which Discord servers is the bot actually in, + a member count per server —
// the "is GABI where it should be, and can it read data back" check the owner
// asked for (2026-08-24). Devops-gated like the rest of /admin; asks Discord
// `GET /users/@me/guilds?with_counts=true` with the bot token.
app.get('/admin/guilds', async (c) => {
  const refusal = await devopsHttpGate(c);
  if (refusal) return refusal;

  const botToken = c.env.DISCORD_BOT_TOKEN;
  if (!botToken) {
    return c.json(
      {
        ok: false,
        message:
          'DISCORD_BOT_TOKEN is not configured on this Worker, so the bot cannot be asked which ' +
          'servers it is in. Set the secret and redeploy.',
      },
      503,
    );
  }
  const res = await fetch('https://discord.com/api/v10/users/@me/guilds?with_counts=true', {
    headers: { authorization: `Bot ${botToken}` },
  });
  if (!res.ok) {
    return c.json(
      {
        ok: false,
        message:
          `Discord refused the guild list (HTTP ${res.status}). The bot token may be wrong, or the ` +
          'bot has not been invited to any server.',
        detail: (await res.text()).slice(0, 300),
      },
      502,
    );
  }
  const guilds = (await res.json()) as Array<{
    id: string;
    name: string;
    owner?: boolean;
    approximate_member_count?: number;
  }>;
  return c.json({
    ok: true,
    count: guilds.length,
    guilds: guilds.map((g) => ({
      id: g.id,
      name: g.name,
      owns_server: Boolean(g.owner),
      approx_members: g.approximate_member_count ?? null,
    })),
  });
});

app.post('/admin/gateway/start', async (c) => {
  const refusal = await adminGate(c);
  if (refusal) return refusal;

  const stub = gatewayStub(c.env);
  if (!stub) {
    return c.json(
      {
        ok: false,
        message:
          'The gateway Durable Object is not bound on this Worker (a configuration gap, NOT a ' +
          'permissions problem). Nothing was started — check the [[durable_objects.bindings]] ' +
          'entry for GABI_GATEWAY in wrangler.toml and redeploy.',
      },
      503,
    );
  }
  if (!mentionsOn(c.env)) {
    return c.json({
      ok: true,
      started: false,
      message:
        'GABI_MENTIONS is not "on", so no gateway connection was opened and none will be. That is ' +
        'the shipped posture, not a fault — flipping it is an owner decision in wrangler.toml, ' +
        'followed by a deploy and then this route.',
    });
  }
  const res = await stub.fetch('https://gateway.internal/start', { method: 'POST' });
  return c.json({ ok: true, started: true, gateway: await res.json() });
});

// ---------------------------------------------------------------------------
// Three small wiring helpers. Everything they touch is decided elsewhere —
// this file stays an orchestrator (the estate's thin-entrypoint rule).
// ---------------------------------------------------------------------------

/** Run the slow half after the ack. Tests drive the app without an execution
 * context; production always has one, and none of these flows rejects. */
function defer(
  c: { executionCtx: { waitUntil(promise: Promise<unknown>): void } },
  work: Promise<unknown>,
): void {
  try {
    c.executionCtx.waitUntil(work);
  } catch {
    void work;
  }
}

function serviceAccountOrNull(json: string | undefined): ServiceAccount | null {
  try {
    return parseServiceAccount(json);
  } catch (err) {
    console.error('FIREBASE_SERVICE_ACCOUNT malformed:', err instanceof Error ? err.message : err);
    return null;
  }
}

/** Everything a moderation path needs about WHO asked and WHERE — including
 * the kill switch, read once, here, from the environment. */
function modContext(env: Env, actor: InteractionActor): ModCallContext {
  return {
    enabled: moderationOn(env),
    permissionsRaw: actor.permissions,
    guildId: actor.guildId,
    channelId: actor.channelId,
    actorId: actor.user?.id ?? '',
    actorName: displayNameOf(actor.user),
    applicationId: env.DISCORD_APPLICATION_ID || actor.applicationId,
  };
}

// ---------------------------------------------------------------------------
// The interactions endpoint. Order is load-bearing: config check → signature
// (Discord probes with deliberately BAD signatures and silently drops the
// URL if they aren't 401'd — verify.ts header) → parse → route → respond
// inside the 3-second window (vote work is deferred into waitUntil).
// ---------------------------------------------------------------------------
app.post('/interactions', async (c) => {
  const publicKeyHex = c.env.DISCORD_PUBLIC_KEY;
  if (!publicKeyHex) {
    return c.json(
      { error: 'discord_public_key_unset', fix: 'wrangler secret put DISCORD_PUBLIC_KEY' },
      503,
    );
  }

  const signature = c.req.header('x-signature-ed25519');
  const timestamp = c.req.header('x-signature-timestamp');
  if (!signature || !timestamp) return c.json({ error: 'missing_signature_headers' }, 401);

  const rawBody = await c.req.text();
  let valid: boolean;
  try {
    valid = await verifyDiscordSignature(publicKeyHex, signature, timestamp, rawBody);
  } catch (err) {
    // importDiscordPublicKey threw: the SECRET is malformed — a config bug,
    // loud and distinct from an attacker's bad signature.
    console.error('DISCORD_PUBLIC_KEY malformed:', err instanceof Error ? err.message : err);
    return c.json({ error: 'discord_public_key_invalid', fix: 'must be 64 hex chars' }, 500);
  }
  if (!valid) return c.json({ error: 'bad_signature' }, 401);

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  if (!isInteraction(body)) return c.json({ error: 'not_an_interaction' }, 400);

  const decision = routeInteraction(body);
  switch (decision.kind) {
    case 'pong':
      return c.json({ type: ResponseType.PONG });

    case 'link_command':
      // Ephemeral by design: a link ceremony is personal, and a
      // channel-visible message would invite the wrong person to press it.
      return c.json(
        ephemeralMessage(
          linkCommandMessage(
            new URL(c.req.url).origin,
            linkConfigured(c.env) && Boolean(c.env.FIREBASE_PROJECT_ID),
          ),
        ),
      );

    case 'have_command': {
      // Design §2b / §4 decision 4: the PUBLIC audiobook slice, for everyone,
      // with no credential on the call. Deferred because it asks the index —
      // a round trip must never race Discord's 3-second window (§1.7).
      if (!decision.actor.token) {
        return c.json(
          ephemeralMessage(
            'Discord sent no interaction token, so GABI has no way to reply with the answer. ' +
              'Nothing went wrong on the estate side — try the command again.',
          ),
        );
      }
      defer(
        c,
        processHave({
          query: decision.query,
          applicationId: c.env.DISCORD_APPLICATION_ID || decision.actor.applicationId,
          interactionToken: decision.actor.token,
          indexBaseUrl: indexBase(c.env),
          serviceAccountJson: c.env.FIREBASE_SERVICE_ACCOUNT,
          discordUserId: decision.actor.user?.id ?? null,
        }),
      );
      return c.json(deferredEphemeral());
    }

    case 'gabi_command': {
      // Shape (b), propose-and-deep-link (gabi.ts's header has the full
      // reasoning). Deferred for the same reason as /have: it asks the index,
      // and a round trip must never race Discord's 3-second window.
      if (!decision.actor.token) {
        return c.json(
          ephemeralMessage(
            'Discord sent no interaction token, so GABI has no way to reply with the answer. ' +
              'Nothing went wrong on the estate side — try the command again.',
          ),
        );
      }
      // ⚠️ ASKER-AWARE DEEP LINK (2026-08-18). The same port Tier 1 built,
      // used READ-ONLY: `whoami` mutates nothing and needs no capability, so
      // this is deliberately NOT gated on `GABI_DELEGATED_WRITES` — switching
      // writes off must not send everybody back to the pilot host. `null` when
      // the app token or the service account is unset, and the command then
      // behaves exactly as it did before this landed.
      const gabiPanelPort = makeDelegate(c.env);
      defer(
        c,
        processGabi({
          question: decision.question,
          applicationId: c.env.DISCORD_APPLICATION_ID || decision.actor.applicationId,
          interactionToken: decision.actor.token,
          indexBaseUrl: indexBase(c.env),
          panelUrl: panelDeepLink(panelBase(c.env)),
          serviceAccountJson: c.env.FIREBASE_SERVICE_ACCOUNT,
          discordUserId: decision.actor.user?.id ?? null,
          ...(gabiPanelPort
            ? { panel: { port: gabiPanelPort, instances: libraryInstances(c.env) } }
            : {}),
        }),
      );
      return c.json(deferredEphemeral());
    }

    // -----------------------------------------------------------------------
    // MODERATION — dark. Each of the three paths checks MODERATION_ENABLED
    // itself (via the planners' shared gate, and again inside the flows), and
    // while it is off every one of them answers MOD_MSG.switchedOff having
    // performed no I/O at all.
    // -----------------------------------------------------------------------

    case 'timeout_command': {
      const ctx = modContext(c.env, decision.actor);
      const planned = planTimeout(ctx, {
        targetUserId: decision.target.id,
        targetName: decision.target.name,
        duration: decision.duration,
        reason: decision.reason,
      });
      if (planned.kind === 'refuse') return c.json(ephemeralMessage(planned.message));
      const botToken = c.env.DISCORD_BOT_TOKEN;
      if (!botToken || !decision.actor.token) {
        return c.json(ephemeralMessage(MOD_MSG.botTokenMissing));
      }
      defer(
        c,
        runTimeout(
          realModDeps({
            botToken,
            serviceAccount: serviceAccountOrNull(c.env.FIREBASE_SERVICE_ACCOUNT),
            applicationId: ctx.applicationId,
            interactionToken: decision.actor.token,
          }),
          ctx,
          planned.plan,
        ),
      );
      return c.json(deferredEphemeral());
    }

    case 'cleanup_command': {
      const ctx = modContext(c.env, decision.actor);
      const planned = planCleanup(ctx, {
        count: decision.count,
        user: decision.userId,
        contains: decision.contains,
      });
      if (planned.kind === 'refuse') return c.json(ephemeralMessage(planned.message));
      const botToken = c.env.DISCORD_BOT_TOKEN;
      if (!botToken || !decision.actor.token) {
        return c.json(ephemeralMessage(MOD_MSG.botTokenMissing));
      }
      defer(
        c,
        runCleanupPreview(
          realModDeps({
            botToken,
            serviceAccount: serviceAccountOrNull(c.env.FIREBASE_SERVICE_ACCOUNT),
            applicationId: ctx.applicationId,
            interactionToken: decision.actor.token,
          }),
          ctx,
          planned.plan,
        ),
      );
      return c.json(deferredEphemeral());
    }

    case 'mod_confirm': {
      const ctx = modContext(c.env, decision.actor);
      // The switch, before the signature: an off bot does not even reveal
      // whether a confirm id was valid.
      if (!ctx.enabled) return c.json(ephemeralMessage(MOD_MSG.switchedOff));
      const botToken = c.env.DISCORD_BOT_TOKEN;
      if (!botToken || !decision.actor.token) {
        return c.json(ephemeralMessage(MOD_MSG.botTokenMissing));
      }
      const parsed = await verifyConfirmCustomId(
        botToken,
        decision.customId,
        { invokerId: ctx.actorId, channelId: ctx.channelId },
        Date.now(),
      );
      if (!parsed.ok) {
        return c.json(
          ephemeralMessage(parsed.reason === 'expired' ? MOD_MSG.confirmExpired : MOD_MSG.confirmInvalid),
        );
      }
      const plan: CleanupPlan = parsed.plan;
      defer(
        c,
        runCleanupConfirm(
          realModDeps({
            botToken,
            serviceAccount: serviceAccountOrNull(c.env.FIREBASE_SERVICE_ACCOUNT),
            applicationId: ctx.applicationId,
            interactionToken: decision.actor.token,
          }),
          ctx,
          plan,
        ),
      );
      return c.json({ type: ResponseType.DEFERRED_UPDATE_MESSAGE });
    }

    // -----------------------------------------------------------------------
    // T2 CONFIRM LANE — a press on a `gc2|` confirm button (DARK behind
    // GABI_CONFIRM_T2). ⚠️ NO GATEWAY WEBSOCKET: an ordinary signed interaction.
    // -----------------------------------------------------------------------

    case 'gabi_confirm': {
      // The switch first — an off lane does not even reveal whether a confirm id
      // was valid, exactly as the moderation confirm does.
      if (!confirmT2On(c.env)) return c.json(ephemeralMessage(CONFIRM_MSG.switchedOff));
      const keyMaterial = c.env.ESTATE_APP_TOKEN_DISCORD;
      const presser = decision.actor.user;
      if (!keyMaterial) return c.json(ephemeralMessage(CONFIRM_MSG.notConfigured));
      if (!presser || !decision.actor.token) return c.json(ephemeralMessage(CONFIRM_MSG.noToken));

      // ⚠️ The MAC, before any storage is touched — a hand-typed or lifted button
      // is refused here and never reaches the pending slot.
      const verified = await verifyConfirmPress(
        keyMaterial,
        decision.customId,
        presser.id,
        Date.now(),
      );
      if (!verified.ok) {
        return c.json(
          ephemeralMessage(verified.reason === 'expired' ? CONFIRM_MSG.expired : CONFIRM_MSG.invalid),
        );
      }
      defer(
        c,
        resumeConfirm(c.env, decision.actor, { action: verified.action, nonce: verified.nonce }),
      );
      return c.json(deferredPublic());
    }

    // -----------------------------------------------------------------------
    // CONTINUITY — a component GABI attached to an earlier answer, and the
    // modal it can open. ⚠️ NO GATEWAY IS INVOLVED: these arrive as ordinary
    // signed HTTP interactions on this same endpoint (conversation-flow.ts).
    // -----------------------------------------------------------------------

    case 'gabi_component': {
      // ⚠️ The posture first, before any storage is touched. While GABI_MENTIONS
      // is off she is not connected at all, so a button from before the flip
      // must say so in words rather than resurrect a Durable Object nobody
      // asked to wake — the object is the account's most expensive resource.
      if (!mentionsOn(c.env)) return c.json(ephemeralMessage(CONV_MSG.notListening));

      // "None of these" opens the free-text modal. ⚠️ A modal MUST be the
      // immediate response to the click — it cannot be sent as a followup — so
      // this branch never defers.
      if (decision.action === 'more') {
        return c.json(buildQuestionModal(decision.nonce, CONV_MSG.modalTitle));
      }

      if (!decision.actor.token) {
        return c.json(
          ephemeralMessage(
            'Discord sent no interaction token, so GABI has no way to reply with the answer. ' +
              'Nothing went wrong on the estate side — ask her again.',
          ),
        );
      }
      defer(c, resumeConversation(c.env, decision.actor, {
        kind: 'pick',
        nonce: decision.nonce,
        choice: decision.choice,
      }));
      return c.json(deferredPublic());
    }

    case 'gabi_modal': {
      if (!mentionsOn(c.env)) return c.json(ephemeralMessage(CONV_MSG.notListening));
      if (!decision.actor.token) {
        return c.json(
          ephemeralMessage(
            'Discord sent no interaction token, so GABI has no way to reply with the answer. ' +
              'Nothing went wrong on the estate side — ask her again.',
          ),
        );
      }
      defer(c, resumeConversation(c.env, decision.actor, {
        kind: 'typed',
        nonce: decision.nonce,
        text: decision.text,
      }));
      return c.json(deferredPublic());
    }

    case 'unknown_command':
      return c.json(
        ephemeralMessage(
          `Nothing answers /${decision.name} yet — the estate bot does not have that command wired up.`,
        ),
      );

    case 'bad_component':
      return c.json(
        ephemeralMessage(
          'This button is not one the estate bot recognises — it may belong to an older message. ' +
            'Nothing was recorded.',
        ),
      );

    case 'unsupported':
      return c.json({ error: 'unsupported_interaction_type', type: decision.type }, 400);

    case 'poll_vote': {
      if (!decision.user) {
        return c.json(
          ephemeralMessage(
            'Discord sent no user on this interaction, so the vote could not be attributed ' +
              'and was NOT counted. Vote on the club page instead.',
          ),
        );
      }
      const sa: ServiceAccount | null = serviceAccountOrNull(c.env.FIREBASE_SERVICE_ACCOUNT);
      if (!sa) {
        return c.json(
          ephemeralMessage(
            'Voting from Discord is not fully set up on the server yet (a configuration gap, ' +
              'not a permissions problem). Your vote was NOT recorded — vote on the club page.',
          ),
        );
      }
      defer(
        c,
        processPollVote({
          sa,
          ref: decision.ref,
          discordUserId: decision.user.id,
          applicationId: c.env.DISCORD_APPLICATION_ID || decision.applicationId,
          interactionToken: decision.token,
        }),
      );
      return c.json({ type: ResponseType.DEFERRED_UPDATE_MESSAGE });
    }
  }
});

// ---------------------------------------------------------------------------
// The cron handler — ⚠️ WIRED BUT NOT TRIGGERED ON THIS ACCOUNT.
//
// The gateway Durable Object heals itself from the inside (each alarm schedules
// the next), but an alarm cannot fire on an object nobody has ever created, and
// a broken chain has no way back. This handler was the second, independent
// poker for it, on a 2-minute cron.
//
// ⚠️ THE CRON COULD NOT BE INSTALLED — measured at deploy 2026-08-17: *"This
// account has reached the Workers Free limit of 5 cron triggers per account"*.
// The `[triggers]` block was removed from wrangler.toml (leaving it makes every
// future deploy exit with a partial-failure banner); the handler stays, because
// restoring the redundancy is then ONE line the day a trigger is freed or the
// account moves to Workers Paid. Until then `POST /admin/gateway/start` is the
// only starter, and that is written down in wrangler.toml and the runbook
// rather than left to be rediscovered.
//
// ⚠️ With the posture off it does NOTHING — no object is created and no Durable
// Object duration is accrued, so shipping this dark costs exactly zero.
// ---------------------------------------------------------------------------
async function scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
  if (!mentionsOn(env)) return;
  const stub = gatewayStub(env);
  if (!stub) {
    console.error(
      'GABI mentions are on but the GABI_GATEWAY Durable Object is not bound; nothing can listen. ' +
        'Check wrangler.toml.',
    );
    return;
  }
  ctx.waitUntil(
    stub
      .fetch('https://gateway.internal/start', { method: 'POST' })
      .then(() => undefined)
      .catch((err) => console.error('GABI gateway poke failed:', err instanceof Error ? err.message : err)),
  );

  // ⚠️ **TIER 2's TRIGGER, and the reason this cron gained a second job**
  // (docs/info/gabi-memory-design.md §2). There is no expiry EVENT in the
  // conversation store — the 30-minute window is applied lazily on the next
  // read — so "distil it when the conversation goes quiet" had nothing to hang
  // off. This is that hook: a sweep every two minutes, worst-case staleness two
  // minutes, and no new scheduling infrastructure.
  //
  // ⚠️ SEPARATE from the poke rather than folded into it. They fail for
  // different reasons and must be able to fail independently: a distillation
  // that throws must never stop the gateway being kept alive, which is the job
  // people actually notice.
  //
  // ⚠️ It is a no-op with GABI_MEMORY off, inside the Durable Object, so a dark
  // posture costs exactly one cheap round trip.
  ctx.waitUntil(
    stub
      .fetch('https://gateway.internal/conv/sweep', { method: 'POST' })
      .then(() => undefined)
      .catch((err) =>
        console.error('GABI memory sweep failed:', err instanceof Error ? err.message : err),
      ),
  );
}

// ⚠️ The Durable Object class must be exported from the Worker's entrypoint or
// Cloudflare cannot construct it — a binding alone is not enough, and the
// failure reads as "class not found" at deploy rather than at runtime.
export { GabiGateway } from './gateway.js';

/**
 * ⚠️ The Hono app is now a NAMED export and the default is a handler object.
 *
 * A Worker with a cron needs a `scheduled` handler beside `fetch`, and a bare
 * Hono instance has no place to put one. Nothing about HTTP behaviour changed —
 * `app.fetch` below is the same handler that used to be the default export —
 * but tests drive the app through `app.request(...)`, which only exists on the
 * Hono instance, so both shapes are exported rather than one being faked.
 */
export { app };

export default { fetch: app.fetch, scheduled };
