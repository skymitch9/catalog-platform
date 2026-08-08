# Diagrams

> **Audience:** Claude sessions. **Status:** PLANNING — none of this is built.
> Last verified: **2026-08-07**. Figures in the "today" diagram were measured on
> that date; everything in the target diagrams is proposed.

Mermaid, matching the convention already used in
`Board_Game_Catalog/docs/DESIGN.md`. Renders in VS Code and on GitHub.

---

## 1. Today

Three catalogs, three hosts, two identity systems, no connection between them.

```mermaid
graph TB
    subgraph pc["Your PC"]
        oa["OpenAudible library<br/>~1,073 .m4b"]
        pipe["Python pipeline<br/>3×/day"]
    end

    subgraph gh["GitHub Pages — free, public"]
        prod["skymitch9.github.io/audiobook_catalog/<br/><b>.git = 377 MB</b> · covers 242 MB"]
    end

    subgraph goog["Google"]
        fs[("Firestore<br/>18 collections<br/>clubs · reviews · profiles")]
        fbauth["Firebase Auth<br/>Google SSO"]
    end

    subgraph cfl["Cloudflare"]
        acc["Cloudflare Access<br/>Google SSO"]
        bgw["board-game-catalog<br/>.workers.dev"]
        bgd[("D1 · 775 items")]
    end

    oa --> pipe
    pipe -->|"commit + push"| prod
    prod -.->|"browser fetch"| fs
    prod -.-> fbauth
    acc --> bgw --> bgd

    nolink["❌ no connection<br/>❌ two sign-ins<br/>❌ no cross-format view"]
    prod -.- nolink
    bgw -.- nolink

    classDef problem fill:#3d1f1f,stroke:#c53030,color:#fff
    class nolink,prod problem
```

**What is wrong with it**

| Problem | Evidence |
|---|---|
| Repo approaching the Pages ceiling | `.git` **377 MB** at 378 commits, against a ~1 GB soft limit. Covers regenerate unconditionally every build, so history grows per rebuild |
| Two identity systems | Firebase Auth for audiobooks, Cloudflare Access for games — same Google account, two sessions |
| No cross-format answer | Nothing can say "I own this in audio and paperback" |

---

## 2. Target

```mermaid
graph TB
    subgraph people["People"]
        vis["🌐 Visitor"]
        own["👤 Owner"]
    end

    subgraph goog["Google — UNCHANGED, not up for discussion"]
        fbauth["Firebase Auth<br/>Google SSO"]
        fs[("Firestore<br/>clubs · reviews · profiles<br/>leaderboard · warnings")]
    end

    subgraph cf["Cloudflare — one domain"]
        pages["<b>Cloudflare Pages</b><br/>&lt;domain&gt;<br/>public read · all three"]
        games["<b>Worker + D1</b><br/>games.&lt;domain&gt;<br/>manual add · scanning"]
        lib["<b>Worker + D1</b><br/>library.&lt;domain&gt;<br/>manual add · scanning"]
        idx[("<b>Worker + D1</b><br/>index.&lt;domain&gt;<br/>cross-format index")]
        r2[("<b>R2</b><br/>covers.&lt;domain&gt;<br/>242 MB, out of git")]
    end

    subgraph pc["Your PC"]
        pipe["Python pipeline<br/>unchanged"]
    end

    vis --> pages
    own --> games
    own --> lib
    own --> fbauth
    vis --> fbauth

    fbauth -->|"ID token"| games
    fbauth -->|"ID token"| lib
    pages -.->|"browser fetch"| fs

    pipe -->|"build + commit"| pages
    pipe -->|"upload changed covers"| r2
    pipe -->|"POST projection"| idx
    games -->|"cron: push projection"| idx
    lib -->|"cron: push projection"| idx
    pages -.->|"fetch: own this in any format?"| idx
    pages --> r2

    classDef unchanged fill:#1e4620,stroke:#2f855a,color:#fff
    classDef new fill:#2a4365,stroke:#3182ce,color:#fff
    class fbauth,fs,pipe unchanged
    class idx,r2,lib new
```

Green is untouched. Blue is new.

**Read it as three independent claims**

1. **The pipeline does not change.** It still walks the local library, reads MP4
   atoms and uploads to Drive. It gains two steps: upload changed covers to R2,
   POST a projection to the index.
2. **Firestore does not change.** All 18 collections and ~9,600 lines of
   Firebase-bound JS keep working exactly as they do. This is the constraint
   that makes the whole move cheap.
3. **Each catalog keeps its own database.** The index holds a *projection*, not
   the data. Nothing is merged.

---

## 3. Why an index rather than static JSON exports

The earlier plan had each catalog export a JSON file the static site would join
on `normalise(title)|normalise(author)`. That needs the same normalisation
implemented identically in Python and two TypeScript apps — and this codebase
has already shipped that exact bug, when the Python promote gate and the JS site
resolver drifted on author-splitting and promotes failed silently.

```mermaid
graph LR
    subgraph bad["❌ Three exporters, three implementations"]
        p1["Python<br/>normalise()"] --> j1["audiobooks.json"]
        t1["TS<br/>normalise()"] --> j2["games.json"]
        t2["TS<br/>normalise()"] --> j3["library.json"]
        j1 & j2 & j3 --> site1["static site<br/>joins on key"]
        drift["drift is silent<br/>and has happened before"]
        site1 -.- drift
    end

    subgraph good["✅ One index, one implementation"]
        p2["Python"] --> ix[("index<br/><b>normalise() on write</b>")]
        t3["TS"] --> ix
        t4["TS"] --> ix
        ix --> site2["site queries<br/>never normalises"]
    end

    classDef problem fill:#3d1f1f,stroke:#c53030,color:#fff
    classDef ok fill:#1e4620,stroke:#2f855a,color:#fff
    class drift,site1 problem
    class ix,site2 ok
```

Normalising **once, on write** means the drift cannot happen. The site compares
only strings the index handed it.

---

## 4. The ISBN ladder (library_catalog)

The Board Game Catalog's finding was that barcodes are a *weak* primitive —
measured 2/4 on GameUPC. **For books that reverses**, which is why this ladder
looks inverted compared to `barcode-ladder.md`.

```mermaid
flowchart TD
    scan["📷 Camera"] --> filt{"EAN-13 with<br/>978/979 prefix?<br/>checksum valid?"}
    filt -->|"no — price add-on<br/>or retail UPC"| keep["keep scanning<br/>do NOT look it up"]
    filt -->|"yes"| r0

    r0{"rung 0<br/>local edition.isbn13"} -->|hit| own["✅ Already yours<br/>free · offline · instant"]
    r0 -->|miss| r1

    r1{"rung 1<br/>Open Library"} -->|hit| conf
    r1 -->|miss| r2

    r2{"rung 2<br/>Google Books"} -->|hit| conf
    r2 -->|miss| r3

    r3["rung 3<br/>Claude vision on the cover<br/>~$0.004"] --> conf

    noisbn["no barcode at all:<br/>pre-1970 · ebooks · Kindle"] --> r3

    conf["👤 Confirm screen"] --> write["write back to<br/>edition.isbn13"]
    conf --> special{"limited or<br/>crowdfunded edition?"}
    special -->|"~5% of rows"| research["tiered research<br/>publisher → crowdfunding → retail"]
    special -->|"ordinary paperback"| done["done — never pay"]

    classDef free fill:#1e4620,stroke:#2f855a,color:#fff
    classDef paid fill:#3d2f00,stroke:#b7791f,color:#fff
    class r0,r1,r2,own,done free
    class r3,research paid
```

⚠️ **The prefix filter is not optional.** Books usually carry *two* barcodes —
the Bookland EAN-13 and either a 5-digit price add-on or a separate retail UPC
on mass-market paperbacks. A scanner will happily decode the wrong one.

⚠️ **The research gate is not optional either.** `cost-reduction.md` records
what happens without it: asking "what does this row not know" instead of "what
is worth *buying* for this row" put 616 dice trays in front of a web-search
model and cost $8.30.

---

## 5. Sequencing

```mermaid
graph LR
    subgraph s1["1 · Finish Board Game Catalog"]
        a["re-measure the<br/>two thresholds"]
        b["scan history view"]
        c["four data calls"]
    end

    subgraph s2["2 · Platform — independent"]
        d["domain +<br/>Cloudflare Pages"]
        e["covers → R2"]
        f["index Worker"]
    end

    subgraph s3["3 · library_catalog"]
        g["phase 0<br/>verify"]
        h["phases 1–5"]
    end

    subgraph s4["4 · Combined"]
        i["cross-format view"]
    end

    a --> g
    b --> g
    g --> h
    d --> e --> f
    f --> i
    h --> i

    classDef blocking fill:#3d2f00,stroke:#b7791f,color:#fff
    class a,b blocking
```

Amber blocks the fork. Everything in stage 2 is decoupled and can start today.

**Why the thresholds block.** `matchIndexedTitle`'s 60%-containment, title-only
rule is unsafe for books — titles collide across authors constantly, and Kindle
rows carry ASINs rather than ISBNs so they can *only* be matched by name. Fixing
it once in the Board Game Catalog means the fork inherits a correct matcher.
Forking first means fixing it twice, differently.
