/** Bindings for the estate Discord Worker. All four are wrangler secrets —
 * see wrangler.toml's trailing comment for the exact `wrangler secret put`
 * names and custody notes. Everything is optional at the type level because
 * a missing secret must produce a WORDED 503/ephemeral answer, never a
 * crash (the estate's no-bare-status rule). */
export interface Env {
  ENVIRONMENT?: string;
  /** Pinned to the shared estate project (`audiobook-catalog`) in
   * wrangler.toml, exactly as every sibling Worker pins it. The canonical
   * verifier asserts it as BOTH issuer and audience — remove it and the
   * link ceremony would accept any Firebase project's tokens, which is not
   * a smaller check but no check. A plain var, not a secret: it is a
   * project name, and it appears in every browser bundle already. */
  FIREBASE_PROJECT_ID?: string;
  /** Comma-separated estate break-glass addresses, mirroring auth-worker's
   * var of the same name. Read ONLY by the command-registration gate. */
  OWNER_EMAILS?: string;
  /** Portal → General Information → Public Key (64 hex chars). Verifies
   * every incoming interaction's Ed25519 signature. */
  DISCORD_PUBLIC_KEY?: string;
  /** Portal → General Information → Application ID. Also arrives on every
   * interaction payload; the env value wins when both exist. */
  DISCORD_APPLICATION_ID?: string;
  /** Portal → Bot → Reset Token. Still NOT consumed by the poll-VOTE path
   * (those edits ride the interaction token). Consumed by exactly two things:
   * the slash-command registration route (commands.ts) and phase 3's sync
   * tick (poll-sync.ts), which posts and edits real channel messages with it —
   * the first place §1.2's shared blast radius is actually exercised. */
  DISCORD_BOT_TOKEN?: string;
  /** Portal → OAuth2 → **Client Secret**. A DIFFERENT credential from the bot
   * token: it authenticates the APPLICATION during the identity-link code
   * exchange and can mint no bot powers. ⚠️ NOT SET YET — the link ceremony
   * ships dark behind its absence and answers a worded "linking is not
   * configured yet" page until the owner sets it (docs/access/discord-bot.md
   * §3 step 7). It also derives the HMAC key for the pending-link cookie, so
   * rotating it invalidates in-flight link attempts and nothing else. */
  DISCORD_CLIENT_SECRET?: string;
  /** The same service-account JSON auth-worker holds — Firestore REST
   * access for vote writes. See src/firebase-sa.ts. */
  FIREBASE_SERVICE_ACCOUNT?: string;
  /** The shared secret gating `POST /polls/sync` (phase 3, src/poll-sync.ts).
   * The SAME value is held by the audiobook pipeline, which calls the route on
   * `club_announcements.py`'s cadence. A THIRD credential class, deliberately
   * distinct from the bot token and the client secret: leaking it lets someone
   * make the bot re-render its own poll messages sooner than it would have —
   * it grants no Discord powers, reads no Firestore of its own, and cannot
   * post anything a poll doc does not already say. ⚠️ SHIPS DARK while unset:
   * the route answers a worded 503 and `/api/health` reports
   * `configured.poll_sync_token: false`. */
  POLL_SYNC_TOKEN?: string;
  /** ⚠️ THE MODERATION KILL SWITCH — a plain var in wrangler.toml, declared
   * there (2026-08-16, owner order) BEFORE any moderation code existed, with
   * the required behaviour written into the comment beside it. `"on"` and
   * nothing else enables `/timeout` and `/cleanup`; absent, empty, `"true"`,
   * `"1"` and every typo all mean OFF, and every moderation code path answers
   * a worded "switched off" ephemeral while it is. Flipping it is the OWNER's
   * evidence-gated step — never a side effect of a deploy, and never done by
   * an agent. See src/moderation.ts. */
  MODERATION_ENABLED?: string;
  /** Override for the estate index `/have` queries (default:
   * `https://index.heygabi.ai`). A var, not a secret — the host is public and
   * the call carries no credential at all, which IS the scope decision
   * (design §4 decision 4). Exists so a test or a future lane can point
   * elsewhere without editing code. */
  INDEX_BASE_URL?: string;
  /** Where `/gabi` sends people — the site that actually runs the GABI panel
   * (default: `https://padhard.heygabi.ai`, the only instance whose
   * `GABI_PANEL` posture is on). A var, not a secret: it is a public hostname
   * that appears in the bot's own replies. ⚠️ NOT a credential and NOT a
   * capability — following the link proves nothing; the site does its own
   * Firebase sign-in and its own role check, which is exactly why shape (b)
   * needs no new custody. Exists so a test can point elsewhere. */
  GABI_PANEL_URL?: string;
  /** ⚠️ THE AUDIOBOOK SITE, and it exists because the estate index does NOT
   * hold a narrator. Measured 2026-08-18 against `apps/index-worker/migrations/
   * 0001_entry.sql` and the live host: the `entry` table has no narrator, no
   * duration and no genre column, so the owner's own canonical question ("who
   * narrates The Way of Kings?") is unanswerable from `/api/search` alone. The
   * audiobook site publishes `catalog.csv` — 200, `text/csv`, CORS `*`, 1,079
   * rows, narrator and duration filled on every one — and that is what the
   * Tier-0 tools read (src/catalog-data.ts).
   * ⚠️ A var, not a secret, and the call carries NO credential: the surface is
   * already published to the open internet, which IS the scope decision, the
   * same one `/have` records. Default in code is the live host; this exists so
   * a test or a future lane can point elsewhere. */
  CATALOG_BASE_URL?: string;
  /** ⚠️ THE CONVERSATIONAL KILL SWITCH — phase A of "GABI answers when you
   * @mention her" (src/mentions.ts, src/gateway.ts). A plain var in
   * wrangler.toml, affirmative-only in the exact idiom of MODERATION_ENABLED
   * above and the library's own `GABI_PANEL`: `"on"` and nothing else enables
   * it; absent, empty, `"true"`, `"1"`, `"yes"` and every typo all mean OFF.
   * ⚠️ OFF means the gateway **never opens a WebSocket** — an off bot is not
   * merely silent, it is not connected, and costs nothing. Flipping it is the
   * OWNER/conductor's decision, never a side effect of a deploy, and it is
   * pinned both ways by test/mentions.test.ts. */
  GABI_MENTIONS?: string;
  /** The key that gives her a brain in Discord — a NEW secret, deliberately
   * separate from the library Worker's `ANTHROPIC_API_KEY` so the two spends
   * are separately capped, separately rotated and separately auditable.
   * ⚠️ SHIPS DARK while unset, and that is a LADDER not a failure: with it,
   * intent is classified and small talk answered by claude-haiku-4-5; without
   * it, src/mentions.ts's keyword router still answers lookups and still nudges
   * toward the panel. ⚠️ A missing key must NEVER produce an error message in a
   * channel — the absence is logged as a worded line and nothing else. */
  ANTHROPIC_API_KEY_GABI?: string;
  /**
   * ⚠️ **THE TIER-1 KILL SWITCH — the delegated WRITE verbs** (`delegated.ts`).
   *
   * Affirmative-only, the exact idiom of `MODERATION_ENABLED` and
   * `GABI_MENTIONS` above: `"on"` and nothing else. Absent, empty, `"true"`,
   * `"1"`, `"yes"` and every typo all mean OFF.
   *
   * ⚠️ **OFF means no write, no site call and no credential read** — but it
   * does NOT mean silence. A DM'd ISBN still gets *"adding books from Discord
   * is switched off"* rather than falling through to a shelf search for a
   * thirteen-digit number, which returns nothing and reads as broken. The
   * switch removes the capability; it must not remove the sentence.
   *
   * ⚠️ **It ships `"on"`, and that is the OWNER'S EXPLICIT DECISION rather than
   * a default** (2026-08-17: *"Can I dm her an isbn or a photo and she adds it
   * to the catalog?"* → the T0–T4 ladder → *"that looks good, start with
   * that"* → *"all of it"*). The switch exists because a capability like this
   * must have an off lever that is one line and needs no code change — not
   * because the decision to enable it was unmade.
   */
  GABI_DELEGATED_WRITES?: string;

  /**
   * ⚠️ **The bot's bearer for the two library instances' delegated door.**
   *
   * One value, THREE holders, the same NAME on all three — the estate's
   * established pairing idiom (`DONOR_TOKEN`'s): minted once, piped here and to
   * BOTH `library_catalog` Workers.
   *
   * ⚠️ **It authorises no write.** It proves only *"this request came from the
   * estate's Discord Worker"*. The destination site then resolves the
   * on-behalf-of Firebase uid to its own `app_user` row and checks THAT
   * person's capability. So the worst a leak buys is the ability to act for
   * people who already hold the capability, on a surface whose every write is
   * stamped and revertible.
   *
   * ⚠️ **SHIPS DARK while unset**: `delegated.ts` answers a worded "not wired up
   * yet" line, `/api/health` reports `configured.estate_app_token_discord:
   * false`, and nothing crashes.
   *
   * ⚠️ It is read by exactly ONE module — `delegated-exec.ts` — and
   * `test/delegated.test.ts` fails the build if that stops being true. The
   * lookup and chat paths must stay credential-free by construction.
   */
  ESTATE_APP_TOKEN_DISCORD?: string;

  /**
   * The two library instances GABI may be asked to write to. Vars, not secrets:
   * they are public hostnames that appear in her own replies.
   *
   * ⚠️ **TWO, because there really are two Workers with two D1 databases** —
   * `library` (the main shelf) and `library2` (padhard). That is measured
   * reality, not future-proofing: `library_catalog/docs/access/second-instance.md`
   * documents one build deploying to two targets, and a build that knew about
   * only one would silently write the wrong household's catalog for anybody who
   * holds a role on both.
   *
   * Absent means that instance is not offered at all — which is the honest
   * behaviour for a single-instance estate, and the reason these default in
   * code rather than being required.
   */
  LIBRARY_MAIN_URL?: string;
  LIBRARY_FRIEND_URL?: string;

  /**
   * ⚠️ **THE DOCS KILL SWITCH — GABI reads the estate's own documentation**
   * (src/estate-docs.ts; design docs/info/gabi-docs-assistant-design.md
   * phase 4).
   *
   * Owner ask 2026-08-17, verbatim: *"let's make sure GABI can read all of our
   * docs and stuff so she can even help me if needed for let's say I don't have
   * a Claude code session open."* Phases 1/2/5/6 answered that in a BROWSER;
   * this is the half that answers it in Discord, which is where the owner
   * actually is when no session is open.
   *
   * Affirmative-only in the exact idiom of `MODERATION_ENABLED`,
   * `GABI_MENTIONS` and `GABI_DELEGATED_WRITES`: `"on"` and nothing else;
   * `"true"`, `"1"`, `"yes"` and every typo mean OFF.
   *
   * ⚠️ **IT SHIPS OFF, and that is a departure from `GABI_DELEGATED_WRITES`
   * rather than an oversight.** Tier 1 shipped `"on"` because the owner approved
   * that capability in words. This one reaches PII plus an operations runbook —
   * break-glass SQL, deploy levers, secret NAMES and where they live, the
   * `/admin` grant grammar, and household members' emails and role assignments.
   * Design §7's owner step 4 is explicit that flipping it is *"a deliberate act,
   * never a side effect of a deploy."*
   *
   * ⚠️ OFF does not mean silent: a docs question still gets *"reading the estate
   * docs from Discord is switched off"* rather than falling through to a shelf
   * search that finds nothing and reads as broken. The switch removes the
   * capability; it must not remove the sentence.
   *
   * ⚠️ **ON IS NOT A GRANT.** With this on, every docs question is still checked
   * per-asker against the estate directory by the auth Worker — a non-devops
   * household member gets a worded refusal and GABI never sees a byte of the
   * corpus on their behalf.
   */
  GABI_DOCS?: string;

  /**
   * ⚠️ **The bot's bearer for the estate docs corpus (door B).**
   *
   * One value, TWO holders, same NAME on both: here and `apps/auth-worker`.
   *
   * ⚠️ **IT IS NOT `ESTATE_APP_TOKEN_DISCORD` ABOVE, and the two must never be
   * merged.** That one is shared with BOTH library Workers for the Tier-1
   * delegated writes. Reusing it here would mean a leak from either library
   * instance also opened break-glass SQL, deploy levers, secret names and
   * household members' emails — and re-minting it to add the auth Worker as a
   * fourth holder would break Tier 1, since a secret cannot be read back. A
   * fresh trust edge gets a fresh pair; that is the estate's standing rule and
   * this is the case it was written for.
   *
   * ⚠️ **IT AUTHORISES NO READ.** It proves only *"this request came from the
   * estate's Discord Worker"*. Every call also carries the asker's PROVEN email
   * (the one `link.ts` verified server-side and stored on the `discord_links`
   * document), and the auth Worker resolves THAT email against the directory and
   * applies `devopsAllows()` — the same predicate the browser door uses. So the
   * worst a leak buys is reading the corpus on behalf of people who could
   * already read it, and revoking someone's devops in `/admin` shuts the door on
   * their next question with no deploy.
   *
   * ⚠️ **SHIPS DARK while unset**: `estate-docs-exec.ts` returns a null port,
   * the docs tools are never described to the model, `/api/health` reports
   * `configured.estate_app_token_discord_docs: false` and
   * `gabi_docs_ready: false`, and every other answer is unchanged.
   *
   * ⚠️ Read by exactly ONE module — `src/estate-docs-exec.ts` — and
   * `test/estate-docs.test.ts` fails the build if that stops being true.
   */
  ESTATE_APP_TOKEN_DISCORD_DOCS?: string;

  /**
   * The estate's auth Worker, which serves the docs corpus behind its devops
   * gate. A var, not a secret: it is a public hostname (`auth.heygabi.ai`) and
   * the credential is the bearer, not the address. Exists so a test or a future
   * lane can point elsewhere; the default in code is the live host.
   */
  AUTH_BASE_URL?: string;

  /**
   * ⚠️ **TIER 0c — the household's own BOOK TEXT, and it ships OFF.**
   *
   * Affirmative-only `"on"`, the exact idiom of `GABI_DOCS` above. Design §4.6
   * pins it: *"Posture `GABI_BOOKS`, affirmative-only `on` — ships dark."*
   * Flipping it is the owner's own deliberate act (design §9, owner step 2),
   * never a side effect of a deploy.
   *
   * ⚠️ OFF does not mean silent, for the same reason the docs posture's does
   * not: a question about what HAPPENS in a book must not fall through to a
   * catalogue lookup that returns a narrator and reads as an answer. See
   * `BOOKS_MSG.switchedOff`.
   *
   * ⚠️ **ON IS NOT A GRANT.** Every book call is still resolved per-asker
   * against the estate directory's `vis_ebooks` by the audiobook Worker — the
   * same predicate the ebook shelf and the byte streams use.
   */
  GABI_BOOKS?: string;

  /**
   * ⚠️ **The bot's bearer for the book-text routes (door B).**
   *
   * One value, TWO holders, same NAME on both: here and
   * `apps/audiobook-worker`.
   *
   * ⚠️ **IT IS ITS OWN PAIR** — not `ESTATE_APP_TOKEN_DISCORD` (shared with both
   * library Workers for Tier-1 writes) and not `ESTATE_APP_TOKEN_DISCORD_DOCS`
   * (the auth Worker's docs corpus). This one opens the household's **derived
   * book text**, which the owner's standing directive is explicit about: *"I
   * don't want people scraping my books."* Derived full text is a MORE
   * attractive scrape target than the files — smaller, cleaner, searchable — so
   * a leak from a library instance or from the docs corpus must not open it.
   *
   * ⚠️ **IT AUTHORISES NO READ.** It proves only *"this request came from the
   * estate's Discord Worker"*. Every call also carries the asker's PROVEN email,
   * and the audiobook Worker resolves THAT against `vis_ebooks`.
   *
   * ⚠️ **SHIPS DARK while unset**: `book-knowledge-exec.ts` returns a null port,
   * the book tools are never described to the model, `/api/health` reports
   * `gabi_books_ready: false`, and every other answer is unchanged.
   *
   * ⚠️ Read by exactly ONE module — `src/book-knowledge-exec.ts` — and
   * `test/book-knowledge.test.ts` fails the build if that stops being true.
   */
  ESTATE_APP_TOKEN_BOOKS?: string;

  /**
   * The estate's audiobook Worker, which serves the book-text routes behind the
   * `vis_ebooks` gate. A var, not a secret: it is a public hostname
   * (`audiobook-api.heygabi.ai`) and the credential is the bearer, not the
   * address. Exists so a test or a future lane can point elsewhere; the default
   * in code is the live host.
   */
  AUDIOBOOK_API_URL?: string;

  /**
   * ⚠️ **TIER 2 — GABI REMEMBERS YOU BETWEEN CONVERSATIONS, and it ships OFF.**
   *
   * Affirmative-only `"on"`, the idiom of `GABI_DOCS` and `GABI_BOOKS`.
   * `docs/info/gabi-memory-design.md` §9 owner step 1: a feature that writes
   * down what people say about themselves is not one to enable as a side effect
   * of a deploy.
   *
   * ⚠️ OFF means she is exactly the bot she was before it existed: the 30-minute
   * verbatim window still works, nothing is written, nothing is read, and no
   * prompt changes. There is no "switched off" sentence because nobody asks a
   * question only memory could answer — they simply notice she does not
   * remember, which is the pre-feature behaviour.
   *
   * ⚠️ ON IS NOT A GRANT. A profile is built ONLY from that person's own
   * messages, is capped at 2 KB, and can be shown and cleared by them at any
   * time with `/gabi memory`.
   */
  GABI_MEMORY?: string;

  /**
   * ⚠️ **PERSONALITY — she picks a voice per person and drifts gradually.**
   *
   * Affirmative-only `"on"`, the house idiom — but ⚠️ **this one SHIPS ON**, and
   * that is a departure from `GABI_BOOKS` / `GABI_MEMORY` rather than an
   * oversight. Those open a gated corpus and a durable note about a person, and
   * each needed the owner's consent. This one changes WORDING: he ordered it
   * explicitly, it reveals nothing, it stores nothing beyond a trope name, and
   * the failure mode of getting it wrong is *she sounds odd* rather than *she
   * leaked something*.
   *
   * ⚠️ OFF IS SILENT — she is exactly the bot she was yesterday. There is no
   * "personality is switched off" sentence, because nobody asks a question only
   * a personality could answer.
   *
   * ⚠️ TONE, NEVER TRUTH. With it on, every refusal, spoiler bound, cap sentence
   * and availability grounding is unchanged — see `personality.ts`'s header for
   * the three structural reasons that holds.
   */
  GABI_PERSONALITY?: string;

  /**
   * ⚠️ **TIER 0d — the asker's OWN shelf (TBR, reviews, "not reviewed").**
   *
   * Affirmative-only `"on"`, and it **ships off**: this reaches a named person's
   * personal reading list, so it follows the `GABI_BOOKS` precedent rather than
   * the personality one.
   *
   * ⚠️ ON IS NOT A GRANT. Every query is built from the asker's OWN uid and
   * display name, read server-side from `discord_links`; no tool parameter could
   * carry somebody else's identity. Another person's REVIEWS are public site
   * content and answerable; another person's TBR is never offered.
   *
   * ⚠️ Reads the service account this Worker already holds — no new secret, no
   * new trust edge (design §5's as-built note).
   */
  GABI_SHELF?: string;

  /**
   * ⚠️ **BOOK SUGGESTIONS, format-aware** (owner ask 2026-08-18: *"I also need
   * Gabi to give book suggestions and clarify if I want audio physical or
   * ebook"*).
   *
   * Affirmative-only `"on"`, and **it ships ON** — `GABI_PERSONALITY`'s
   * precedent rather than `GABI_BOOKS`'s. The owner ordered the OUTCOME, and
   * this lane opens **no new corpus**: it composes from the public catalogue
   * plus the asker's own shelf, each of which already has its own posture and
   * its own gate. The switch exists so there is a lever, not because a new door
   * was opened.
   *
   * ⚠️ **ON IS NOT A GRANT, AND THE THREE FORMATS ARE THREE DIFFERENT GATES.**
   * Audio is the public slice and ungated. Ebook is refused unless the estate
   * says `vis_ebooks` — asked of the audiobook Worker, never decided here.
   * Physical is refused unless the asker is KNOWN on the library instance the
   * print row came from, asked with the delegated `whoami` verb: the owner's own
   * *"a linked person who can view a book from the table she's suggesting"*.
   *
   * ⚠️ It adds **no secret and no trust edge** — every port it uses is one this
   * Worker already builds.
   */
  GABI_SUGGEST?: string;

  /**
   * ⚠️ **TIER 2 — GABI's CATALOG-FIX CONFIRM LANE, and it ships OFF.**
   *
   * The confirm grammar: propose a change to an EXISTING field, restate exactly
   * what will change, and apply on the asker's borrowed authority only when a
   * human presses (`docs/info/gabi-confirm-lanes-design.md`; `src/confirm.ts`).
   *
   * Affirmative-only `"on"`, the exact idiom of `MODERATION_ENABLED`,
   * `GABI_MENTIONS`, `GABI_DELEGATED_WRITES` and `GABI_DOCS`: `"on"` and nothing
   * else; absent, empty, `"true"`, `"1"`, `"yes"` and every typo all mean OFF.
   *
   * ⚠️ **IT SHIPS OFF, and that is a departure from `GABI_DELEGATED_WRITES`
   * rather than an oversight.** Tier 1 is additive-with-undo; this MUTATES data a
   * person already has, on their borrowed authority. Flipping it is the OWNER's
   * evidence-gated step — never a side effect of a deploy, never done by an
   * agent — exactly like the moderation switch.
   *
   * ⚠️ **OFF means the whole lane is invisible: no proposal is offered, no
   * confirm button is rendered, and a stale button from before a flip answers a
   * worded "switched off" rather than acting.** The switch removes the
   * capability; the destination still checks the asker's own role TWICE (at
   * propose and at press) even when it is on — GABI owns no permissions.
   */
  GABI_CONFIRM_T2?: string;

  /** The Durable Object holding the one outbound WebSocket to Discord's
   * gateway (src/gateway.ts). Declared in wrangler.toml's [[durable_objects]]
   * / [[migrations]] pair. ⚠️ Optional at the type level for the same reason
   * every binding here is: a missing binding answers in words, never a crash. */
  GABI_GATEWAY?: DurableObjectNamespace;
}

export type AppBindings = { Bindings: Env };
