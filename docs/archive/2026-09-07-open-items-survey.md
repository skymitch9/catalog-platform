# Open-items survey across all four repos — 2026-09-07 09:47 Phoenix

> **Audience:** the owner (the "present me all deferred things" mandate) and later Claude sessions.
> **Status:** TRACKED, one-off data dump — an ARCHIVE snapshot, not a living doc; the four `docs/TODO.md` files stay the source of truth.
> **Last verified:** 2026-09-07 — every line is the TODO body's own claim as read that morning (read-only Opus survey, 288k tokens, 26 tool uses). NOT checked: any live URL, D1, R2 or Worker; `DONE.md`/`KNOWN_ISSUES.md` bodies; `docs/info/`/`docs/access/` files; source and tests. Line numbers are heading lines in each repo's `docs/TODO.md` at that moment and drift as sections move.

Classification: **DEFERRED** = owner parked it in his own words · **ACCESS-INCREASING** = blocked pending his confirmation (widens permissions / spends / flips enforcement / changes a deploy target) · **OWNER-ONLY** = a human action no agent can take · **BUILDABLE-OPEN** = open and buildable without him (should not exist under the mandate) · **UNCLEAR**.

## DEFERRED — the owner parked these in his own words
1. catalog-platform · "☐ Leftovers of the sixteen owner answers" (L13, deferral block L99) — **8 · Diva's items #8/#9/#605** — owner: *"Ignore for now"* · REC: keep parked.
2. catalog-platform · same block (L99) — **10 · export `ESTATE_APP_TOKEN_LIBRARY`/`_LIBRARY2` into the CLI shell** — owner: *"Okay we do later"* · rides the billing soak (item 4) · REC: keep parked.
3. catalog-platform · same block (L99) — **11 · Justin's shelf steps** — owner: *"He's working on it"* · REC: keep parked.
4. catalog-platform · "1. Toggle what can bill the LLM" item 5 (L1775) — **billing phase 4 soak → enforce** — owner, 2026-09-06 13:41: ***"Later."*** · REC: keep parked; nothing under it may run.
5. catalog-platform · "⏸ DEFERRED BY OWNER 2026-09-02 — anything needing the other computer" (L1347) — ABS shelf-box steps §3–§5 · REC: keep parked.
6. library_catalog · "⏸ DEFERRED BY OWNER 2026-08-17 — 🧰 Tech debt (7 items)" (L1948) — revoke the stale broad Cloudflare token, donor printed-volume, audiobook `scripts/` lint, the cp1252 print class, apex CSP `frame-src` asymmetry, dead `dl_ebooks`, the TBR legacy fallback (53 docs) · REC: present the seven; the Cloudflare-token one is also owner-only.
7. library_catalog · status board (L2093) — **Ebook reader PWA/offline** — owner: *"Add pwa back on the table for later"* · REC: keep parked; the `download`-capability constraint must survive.
8. library_catalog · "Open work, not blocked" (L3231) — **cross-project TODO page on heygabi.ai** — *"we will swap to it later"* · REC: keep parked.
9. library_catalog · Blocked list (L3068) — **~100 physical books unscanned**, *"Don't wait for books to be scanned to move on."* · REC: park by his order.
10. library_catalog · "Open work, not blocked" (L3232) — **Gamefound** — excluded, no books · REC: cancel (settled).
11. Board_Game_Catalog · "What still wants a person" (L70) — **`copy.edition_id` stays null** — owner: *"that'll probably be null forever… I don't super care"* · REC: cancel/leave.
12. audiobook_catalog · "⏸ DEFERRED BY OWNER 2026-08-18 — PC restart" (L1926) — *"dont restart until i confirm"* · 18 days past *"might end up being tomorrow"*; the box runs the live pipeline · REC: ask; never reboot on the note.
13. audiobook_catalog · shelf SSO (L724) — **Cloudflare Access-for-SaaS app §3.2 is NOT NOW**; §3.3/§3.4 cannot start until re-taken · REC: keep parked until Justin's ABS steps land.
14. audiobook_catalog · "☐ BLOCKED ON JUSTIN — Port the EPUB + PDF readers to the SHELF" (L746) — owner Q10, 2026-09-05: *"We will go to shelf only once Justin finishes his part but for now we keep both."* · REC: keep parked.
15. audiobook_catalog · "🔻 Low priority" (L2816) — **paid content-warning backfill (~700 books, $25–50)** vs organic · REC: keep parked (organic).

## ACCESS-INCREASING / NOT APPROVED — blocked pending the owner's confirmation
16. catalog-platform · Leftovers item **17** (L25) — **should `discord-worker` (GABI) become a `deploy.yml` target?** · REC: ask; recommendation on file is yes.
17. catalog-platform · LLM billing "WHAT IS LEFT" item 3 (L1747) — **mint a Discord Worker app token + add `discord` to `CONSUMER_APPS`** — also makes that bearer a valid `/seen` bearer (`test/dev-access.test.ts` guards it by name) · REC: needs the owner.
18. catalog-platform · "+ Add a verse" phase 4 (L1856) — **an outbound notice channel (email / GABI DM)** — needs a mail credential or a Discord bearer · REC: needs the owner.
19. catalog-platform · "🔴 SHADOW GATE — `AUDIOBOOK_SWEEP_MODE`" (L259) + library (L398, L510) — **flip shadow→enforce** — gate `cronPlanTicks ≥ 42` AND `seriesVolumeTicks ≥ 42` on both hosts; achieved ~1 and 0; earliest 2026-09-13; a 2026-09-06 flip was refused on the evidence · REC: keep parked; do not blank the etag.
20. catalog-platform · "🔴 SHADOW GATE — `R2_PRUNE_MODE`" (L374) — five shadow runs matching `--dry-run` key-for-key, at least one non-empty · REC: keep parked; arrange the non-empty half (09:12–09:15 UTC).
21. Board_Game_Catalog · "☐ Billing phase 3 — 3 of 5 steps left" (L400) + (L452) — **flip `BILLING_POLICY` "off"→"shadow"**, three files, one commit, deploy · two agent attempts refused by the permission system on `apps/worker/wrangler.toml` · REC: owner errand (~2 min + deploy) or a permission rule for that file. 🔴 Delete `billing_policy` id 1 before any later enforce.
22. library_catalog · "Billing phase 3 landed INERT" (L1279, L1305) — **owner writes a throwaway deny rule for `library` and `library2` from Spending, then flips to shadow one instance at a time** · REC: needs the owner.
23. library_catalog · provisioner follow-ups (L640) — **`PEERS` ships `[]`** — a peer entry reads another household's holdings and redeploys every instance · REC: keep parked.
24. library_catalog · covers piece 3 (L1723, L1622) — **un-refuse `cover` from `REFUSED_FIELDS`** — makes every details run able to spend the ~6¢ paid rung · REC: needs the owner (cost decision).
25. library_catalog · AUDIT 2026-08 (L3262) — **rotate `PEER_TOKEN` on both Workers, then deploy both** — the old value is still valid and in this public repo's history · REC: owner, promptly.
26. library_catalog · "OWNER ACTION — custody gaps" (L1428) — **`ESTATE_APP_TOKEN_LIBRARY`, `INDEX_PUSH_TOKEN`, `AUDIOBOOK_MAPPING_TOKEN`** have no readable master · REC: owner.
27. catalog-platform · "STEP 3 of the 1Password adoption" (L1372, L1418) — **three rotation ceremonies** (`_LIBRARY2`, `_AUDIOBOOK`, `_BOOKS`) · *"A session must not do this"* · REC: owner, one pair at a time.
28. catalog-platform · "STEP 4 — `audiobook_catalog/.env`" (L1532) — ~30 keys + 4 JSON documents into 1Password · REC: owner-assisted; agents may not open the file.
29. audiobook_catalog · estate-search grey pass (L110, L144) + catalog-platform federation leftovers (L533) — **`gh workflow run promote.yml`** for the audiobook re-vendor · ⚠️ the survey's reading is STALE here: this promote ran at 09:12 Phoenix (tag `prod-20260907-160634`, see audiobook `DONE.md`); the on-disk TODO lines were not yet updated when read.
30. audiobook_catalog · viewer phase 0a item 2 (L1859) — **settle the R2 token's SCOPE**; if account-wide, mint an `estate-ebooks`-scoped token and revoke the broad one · REC: owner console.
31. audiobook_catalog · role model Phase 3a (L2536 item 1) — **one Worker commit still owed (`3000435`)**; `AUTH_ROUTES_WARNINGS` and the two moderation deletes must not flip before it lands · REC: deploy is the conductor's; flag flips are the owner's.
32. audiobook_catalog · Phase 3a (L2581 item 2) + `access/AUTH_ROUTE_FLAGS.md` — **flip the four site flags and exercise them signed in** · REC: needs the owner.
33. audiobook_catalog · **Phase 3b — the owner-gated `firestore.rules` deploy** (L2612) — 45 probe lines, 0 organic decisions · REC: keep parked until one manager and one moderator each exercise a gated action.
34. audiobook_catalog · **Phase 4c — `POST /api/upload`** (L2690) — four owner forks (inbox location, promotion path, who approves, what validation refuses) · REC: needs the owner, one at a time.
35. audiobook_catalog · **Phase 6 — rules shrink** (L2808) + **0b club-permissions tightening deploy** (L2865) — preconditions met (3/3 clubs claimed) · REC: needs the owner; its own reviewed rules deploy.
36. audiobook_catalog · audio player owner action 1 (L1576) — **`firebase deploy --only firestore:rules`** for `audio_positions` / `_dev` · rules NOT compile-checked (SA lacks `rulesets.test`) · REC: owner runs it, then the smoke script.
37. audiobook_catalog · "STEP 11 Link sibling catalogues" (L495, L516) — **deploy firestore rules + the catalog-platform auth-worker/heygabi-home mirrors** or the remote trigger stays REFUSED · REC: conductor/owner deploy; it writes another app's production D1.
38. audiobook_catalog · machine keys (L582–L589) — **owner hard-kills the test keys**, Justin mints/installs the shelf key, legacy env secrets retire on an observed `Last used` · REC: owner + Justin.

## OWNER-ONLY — a human action no agent can take
39. catalog-platform · item **7 · Space Knight `9781986619233`** (L31) — pick up Book 3 and read the barcode; the SQL must not run on current evidence.
40. catalog-platform · item **9 · GABI steps 5–7** (L90, L1309–L1339) — re-run `POST /admin/commands/register` with an admin Firebase token, opt one club in, `/rsvp` + `/progress`, look at the club PAGE.
41. catalog-platform · federation leftovers ④ (L525) — sign in, confirm Padhard's rows on `/universes/` and `/series/`, the `library2` row on `/status/` (`vis_library2` is owner-only).
42. catalog-platform · apex `/status` probe row (L432) — eyeball the bottom row of the Workers section.
43. catalog-platform · soft pauses item 0 (L1618) — the live round trip (GPU busy, `Wow.exe`) — needs a devops token no session holds.
44. catalog-platform · billing item 1 (L1690) — reload `/admin/` → Spending, see rule id 1 drawn. Do not switch `sweep.details`/`games` back on.
45. catalog-platform · billing item 2 (L1737) — render the per-member Spending drawer signed in; ☐ its `deploy:home` half.
46. catalog-platform · "Request a catalog" (L980, L1093, L1032, L1127, L1188) — no signed-in request has ever been filed; file one of each kind as the second approved account, accept one at `/admin/`, confirm the sealed key reads back stored.
47. catalog-platform · sealed key (L1135) — first real provisioning: envelope opens, R2 object gone afterwards (also library L568, L605).
48. catalog-platform · `count_phrase` on Groq (L1228) — one live `@mention` producing a `converse_tools` line with `outcome ≠ ineligible`.
49. catalog-platform · "+ Add a verse" (L1891, L1898, L1901) — the bell's owner review; first real use flips `landed`.
50. Board_Game_Catalog · (L14, L969, L985) — eyeball `/api/export.json` as a contributor, no `email` field.
51. Board_Game_Catalog · (L15) — eyeball the estate search box after the grey-paragraph cut (deploy `79360f3a`).
52. Board_Game_Catalog · "SCAN TARGET" (L79) — add one game from each door on the phone.
53. Board_Game_Catalog · "SECOND-INSTANCE MACHINERY" (L307, L317) — load one page signed in so a real `/seen` proves the token.
54. Board_Game_Catalog · "the family score" (L582) — rate two Dice Throne rows, both pages show the same number (`user_item` holds zero rows).
55. Board_Game_Catalog · audit pass (L1039) — scan a box, let it fail, scan again: one row not two (finding 16).
56. Board_Game_Catalog · (L74) — count the Dice Throne playmats on the shelf.
57. Board_Game_Catalog · (L73) — HELLDIVERS 2: Mystery Expansions (item 414) rename — waits on a pledge shipping.
58. Board_Game_Catalog · (L18) — audit finding 15, a one-line reword in `apps/worker/.dev.vars.example` (agents may not open it).
59. library_catalog · "347 has issues with copies editions" (L38, L118) — re-eyeball `/work/347` and `/work/445`.
60. library_catalog · SHELF round 3 (L654, L767) — `/work/263` six cards in one list, a padhard two-format work; the "cover" slip; are those copies actually signed.
61. library_catalog · EDITION NOTE (L784, L905) — see the Note field on ✎ Edit → Editions & copies survive a save; ☐ maybe rename #450/#470 from "Standard edition".
62. library_catalog · "Audio-verdict residue" (L913, L915) — press "Yes, this is it" once on `/work/347`.
63. library_catalog · OR-2 (L1553, L1585) — duplicates filter review on both instances.
64. library_catalog · "☐ OWNER REVIEW of three surfaces" (L1463) — `/work/493`, `/work/269`, the multi-select Type filter; plus run `sweep-special-editions.mjs` dry then `--commit` on both.
65. library_catalog · "📸 photograph the Illumicrate editions" (L2217) — works 224–228.
66. library_catalog · Illumicrate publisher fix (L2261, L2302) — review `/work/224`.
67. library_catalog · copy↔edition links (L2321, L2412) — review `/work/224` + `/work/229`; decide Tier B (357 main / 485 padhard).
68. library_catalog · ISBN backfill #507 tier D (L2557, L2580) — is his Book of Mormon the Stratford leather pocket edition or an ordinary paperback?
69. library_catalog · padhard #605 *Italian Affair* (L2655, L2670) — a question for Diva.
70. library_catalog · signed editions (L989, L1088) — padhard #136 *Mate*: link copy #320 to edition 135 after confirming with Diva.
71. library_catalog · signed editions (L1224) — five rows to link by hand (MAIN): works 220, 478, 32 — *Uncapped* needs a copy row created in the UI first.
72. library_catalog · "link the unlinked copies" (L1359) — 20 works with two printings of one format; padhard unmeasured.
73. library_catalog · Completionist Chronicles (L2730, L2746) — are 239–242 signed too? eyeball `/work/33` and `/work/34` formats.
74. library_catalog · crowdfunding rescan (L3110, L3177) — Realmkeeper volume count, two Grimoire "Legendary Book Box" tiers, *Unstoppable* title, "+ Books".
75. library_catalog · GABI (L2019, L2025) — her first conversation on her site on her key; the memory acceptance test incl. step 4.
76. library_catalog · GABI §12 (L2055) — confirm Samantha's Anthropic key sits in a capped workspace.
77. library_catalog · "Needs a signed-in eye" (L2068) — padhard's two FAILED `/queue` rows read the worded allowance sentence.
78. library_catalog · padhard details queue (L1811, L1867) — works 490 (retitle *"The Ex Hex"*) and 468 (supply by hand or `unknown`).
79. library_catalog · signed editions (L1241) — *"diva's catalog doesn't have editions like mine"* — measured as the theme; one answer outstanding.
80. library_catalog · ebook gate (L2100) — purge the edge cache for `/ebooks.json` and `/dev/ebooks.json`; the prod promote of `ebooks.heygabi.ai`.
81. library_catalog · ebook viewer (L2157, L2210) — the 393 MiB White Sand omnibus needs an R2 API token; §11's 8 owner decisions.
82. library_catalog · Blocked list (L3061–L3072) — BackerKit sign-in; four universe calls; two series at AUDIO?; #213/#215 series; three refused books; four cover URLs.
83. library_catalog · board-book intake (L2874, L2908) — one author spelling for *Make Believe Ideas*; the Korean series question (never guess the Korean).
84. audiobook_catalog · estate-search grey pass (L149) — one eyeball of `/dev/` search box and results.
85. audiobook_catalog · shelf-link button (L156, L187–L225) — the fourth button, three labels, the one Emberdark card, the ebooks count.
86. audiobook_catalog · cross-catalog links (L234, L246–L264) — three link cases plus the honest negative.
87. audiobook_catalog · TBR media tags (L275, L309) and read-state filter (L316, L373) — nobody has held a session on either lane.
88. audiobook_catalog · ESTATE SSO (L1318, L1337) — the four-step two-tab hop incl. §4c.
89. audiobook_catalog · Edit Club modal (L1361) — tick in Features, tick in Discord, Save, reopen.
90. audiobook_catalog · READER P1 (L1392, L1410) — open a book in a real WebKit browser.
91. audiobook_catalog · TBR account migration (L1499) — `✓ To Be Read` renders signed in; the signed-out sentence.
92. audiobook_catalog · audio player (L1524, L1562) — press play, with ears (8 checks); close-tab-and-return; second-device resume. 🔴 not one second of audio has ever been played.
93. audiobook_catalog · ebook readers (L1666, L1688, L1715) — Page dropdown, phone swipe, the dev curtain (second account), the PDF half.
94. audiobook_catalog · book-knowledge serving half (L1223) — ask GABI a real book-text question in Discord.
95. audiobook_catalog · OCR (L1253) — look at the GABI Knowledge page since `superseded` became a status.
96. audiobook_catalog · R2 archive (L1074, L1086) — decide the 14 orphaned root strays (~127 MB); a restore drill; ~$10.3/month.
97. audiobook_catalog · "did '630 / 7' mean literal hours?" (L964, L1006) — one question.
98. audiobook_catalog · shelf UX (L653–L666) — five steps on the box (hardlinks, compose volume, Add Library, `ABS_EBOOK_LIBRARY_ID`, cron lock).
99. audiobook_catalog · shelf SSO (L714–L723) — approve Justin in Tailscale, relay the temp ABS password, the ABS admin account.
100. audiobook_catalog · shelf base path (L898) + §8 (L913) — after `ROUTER_BASE_PATH` drops, sweep `/audiobookshelf/` links; §8 phone test; LAN loopback fence.
101. audiobook_catalog · shelf diff upload (L921, L934) — Tailscale still not installed on the pipeline PC; `SHELF_SERVER_*` keys unchecked.
102. audiobook_catalog · shelf UX (L735) — *"clean this site up a bit"* is not specified · ask before building.
103. audiobook_catalog · content-note delete (L2036) + club manager (L2075) — the moderator delete; a real browser claim/webhook/lifecycle walk on `/dev/`.
104. audiobook_catalog · role model measurement ② (L2405, L2425) — ledger holds ZERO organic decisions in 2½ days.
105. audiobook_catalog · m4b tag sweep (L2246, L2304) — owner runs `--commit`; next rung one author `--from-overrides-only --safe-copy`.
106. audiobook_catalog · misc (L2342, L2345) — rotate `PIPELINE_TRIGGER_TOKEN` (optional); sign out/in with Google once for the Admin Portal link.
107. audiobook_catalog · phase-2 leftovers (L1633, L1642) — re-derive the listening budget from a real session; whether *requesting* floors at admin+.

## BUILDABLE-OPEN — open, not deferred, an agent could do it
108. catalog-platform · KI-14 residues (L142) — `audiobook_catalog` untracked `frontend/` — nothing has named the writer · REC: read-only forensics, then propose.
109. catalog-platform · federation leftovers (L541) — a measured push cadence for `library2` on `/status`, then `INDEX_CADENCE` · REC: measure first.
110. catalog-platform · federation leftovers (L547) — `PHYSICAL_SOURCE_INSTANCE` in the audiobook `suggest.ts` — the join must carry an instance first · REC: build the join half or record blocked-by-dependency.
111. catalog-platform · LLM billing item 6 (L1785) — phase 5, the audiobook Python policy client (A1–A9) · REC: build (the soak is deferred, this is not).
112. Board_Game_Catalog · (L67) — accessory-implies-the-game sweep (221 accessories vs 186 expansions) · REC: build the REPORT, never the writes.
113. Board_Game_Catalog · family score (L633) — family badge on a search/collection row — *"deliberately left for the owner to ask for"* · REC: keep parked pending his ask.
114. library_catalog · three intake bugs (L2820–L2849) — typed ISBN not stored on `/add?mode=type`; "AND WE…" defaults to record-no-copy; a save can fail silently after hydration · REC: build (intake path ranks first in his own order).
115. library_catalog · copy↔edition links (L2338, L2380) — root cause of the NULL `edition_id`s never established · REC: build the two cheap checks.
116. library_catalog · cover guard (L1804) — strip `._SX50_`/`._SY\d+_`/`._UY\d+_` in `verifyCoverUrl` and re-verify · REC: build.
117. library_catalog · audiobook residue (L1892, L1939) — re-run the link sweep after a bulk import; verify work 514 · REC: build/verify.
118. library_catalog (L2993) + audiobook_catalog (L2226) — edit any detail, an audit log, adding a book with no author — designed, nothing built · REC: the `work_key`-while-unknown answer goes to him first.
119. audiobook_catalog · F3/F6/B17 residuals (L436) — `load_state()` raises a bare `JSONDecodeError` on a corrupt `ingest_state.json` · REC: build (refuse loudly, name the file). ⚠️ pipeline code = ASK first.
120. audiobook_catalog · (L443) — seven scripts re-derive `ROOT_DIR` · REC: build, not during a nightly run. ⚠️ pipeline code = ASK first.
121. audiobook_catalog · (L457) — `laneForSource` maps `pdf-ocr` → `deferred-pdf` for two callers meaning opposite things · REC: build.
122. audiobook_catalog · (L469) — DELETE the ebook row's trigger-string fallback, gated on one run carrying `summary.ebookManifestState` · REC: build once measured.
123. audiobook_catalog · viewer phase 0a item 2 (L1859) — an independent bucket listing vs `ebook_files_manifest.json` · REC: build.
124. audiobook_catalog · smaller follow-ups (L1302–L1316) — PH 10–14 transcripts reach 14; nine double-packed books; chunking on EPUB prose (a migration — ask); the conservative twin join · REC: build the first two.
125. audiobook_catalog · TBR migration (L1477) — the library half of the legacy-fallback removal · REC: build; not urgent.
126. audiobook_catalog · phase-2 leftovers (L1639) — a `moov`-atom / faststart survey with ffprobe · REC: build.
127. audiobook_catalog · the ebook bucket ⇄ manifest reconciler (L2748, L2782) — shipped, not deployed, no caller/schedule/surface; 168 objects vs 162 rows · REC: build after the owed deploy.
128. audiobook_catalog · Phase 4d — the Drive ⇄ role reconciler for the new rungs (L2731) · REC: build report-only beside `drive_role_parity.py`.
129. audiobook_catalog · Phase 5 — uid-binding on member self-writes (L2798) · REC: build the measurement first.
130. audiobook_catalog · TESTING AUDIT (L2109) — the owner's 2026-08-16 ask, estate-wide, never done · REC: build.
131. audiobook_catalog · ROLE LADDER + file-level permissions (L2148) — one open owner question (cumulative vs two axes) · REC: ask, then build.
132. audiobook_catalog · Discord bot backlog (L2852) — (c)–(h) and P1–P4 unbuilt · REC: present; each needs a per-club opt-in toggle.
133. audiobook_catalog · shelf sign-in / drive poll (L417) — that a queued run actually STARTS has never executed · REC: forced end-to-end exercise or wait for a real new book.
134. audiobook_catalog · machine keys (L593, L596) — `test/backups.test.ts` fails `tsc -p tsconfig.test.json` (4 × TS2532); the `site/ebooks.json not found` guard annotation · REC: build both, small.

## UNCLEAR
135. catalog-platform · "GABI's registry lane" (L440, L486) — the 40% fallback did not reproduce in 221 samples · *"Do NOT chase this speculatively"* · REC: leave armed.
136. catalog-platform · federation leftovers (L551) — no instance ever provisioned by either script · rides item 47.
137. audiobook_catalog · "UNBUILT — the EBOOK library's half of 'say 2'" (L1878/L1890) — *"Ask before building"* · REC: ask (count CSV rows, or wait for KI-6).
138. audiobook_catalog · misc (L2319) — *Invent Short Story - Dakota Krout.epub* — CC 7.5 or a mislabelled duplicate · REC: leave in `_unresolved`.
139. library_catalog · "Staged, waiting on the user to run" (L3183) — four dry-run-verified commands plus an optional paid ~$1.50 rung; unclear whether the four were ever run · REC: re-measure before running.
140. Board_Game_Catalog · (L19) — KI-8, KI-9, KI-10; KI-9 blocked on the owner's `wrangler.toml` · rides item 21.

## Per-repo counts and BOM readings (measured by first bytes)
| Repo | `## ` headings | Sections holding open work | `TODO.md` | `DONE.md` |
|---|---|---|---|---|
| catalog-platform | 15 | 13 | no BOM | no BOM |
| bookbuddy/library_catalog | 31 | 24 | BOM ✅ | BOM ✅ |
| boardbuddy/Board_Game_Catalog | 7 | 6 | no BOM | no BOM |
| bookbuddy/audiobook_catalog | 32 | 28 | no BOM | BOM ⚠️ (pair inconsistent) |

No secret VALUES appear in any of the four files (names, one key id and one public JWK path only).
