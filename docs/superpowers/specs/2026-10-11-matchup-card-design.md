# Team matchup share card — design spec (revision 2)

Date: 2026-10-10 · Status: revision 2, **spec review 1 applied (2 blockers, 6 should-fixes, notes of fact); approved by spec review 2 on 2026-10-10; PR 1 built, see "17. As built (PR 1)"** · Repo state read: `origin/main` at `111e721` (matchup pages merged as #42 / #43). Every `file:line` below is that commit's.
Path in the repo: `docs/superpowers/specs/2026-10-11-matchup-card-design.md` (committed with PR 1).

Approved design: mockup `matchup-card-C2.html` (session scratchpad, not in the repo), screenshots `shots/card-C2-*.png`, and the "C2" section of `notes.md` beside it. The owner said "yes build it, keep one card per game".
Check scripts written for this spec (session scratchpad, `matchup-card/spec-work/`): `colour_ref.py` (the colour rule in Python), `colour-ref.mjs` (the same rule in JavaScript; the two agree on all 992 ordered pairs), `ring-check.mjs` / `ring2.mjs` (the ring colour), `measure.mjs` (real glyph widths read from the two font files). PR 1 copies `colour_ref.py` and `measure.mjs` to `docs/superpowers/specs/matchup-card-reference/`.

### Revision 2: review changes applied (`spec-review-1.md`)

| Finding | What changed | Where |
|---|---|---|
| **1 (blocker)** the readable table is missing | The share page shows the PNG, its buttons, then one plain HTML table per pane (7 rows, the model's own label lines), then the rank note. Tests added. Item 13 closed; the non-goal reworded to "no HTML redraw of the chart" | §1, §3, §8.1, §10, §14 item 13, §16 |
| **2 (blocker)** step 5 and the junk test contradict each other | Step 5 is stated as reachable only with unusable colours and as allowed to return an alike pair (`closest: true`); the junk test no longer asserts "not alike" and pins two literals; junk definitions added (darken → `null`, upper-casing, a junk rule colour). The rule, the golden and every real card are unchanged (sha256 still `ce10dda1…b747`) | §5.1, §5.3, §10 |
| **3** the `#D50A0A` test fails on ARI at TB and ATL at TB | Restated as an allow-list of colours over the element tree, ARI at TB added; one sentence says the 5 px rule is exempt from "not alike" | §5.3, §10 |
| **4** moving `listedSeason` breaks mocked tests | The helper goes to a new small module `lib/data/matchup-season.ts` that the route test does not mock; the 308 tests pass untouched. Line numbers corrected (`:452-457`, assertions `:454-455`); the call has two arguments | §3, §4.1, §10 |
| **5** the half-pixel keep-clear needs a measured gate | The label is a fixed 60 px column of three fixed rows (18 / 21 / 21); a pixel-scan script on the Satori PNG is a merge gate for PR 2 | §6.4, §11 |
| **6** nothing holds glyph coverage | The three non-ASCII characters allowed on the image are named; a test asserts a glyph for every character of every string the image can print | §6.2, §10 |
| **7** the plate is under-specified | A block table for the plate, heights summing to 630, and its test | §7, §10 |
| **8** wrong fixture name | `team-game-stats-2026-w1-3.json`; the `MatchupLoad` around the model is built by hand in the test | §10 |
| note 9 | The first lever if image renders show in Vercel usage: name the image only for indexable pairs | §12 |
| note 10 | `next/image` `unoptimized` is already used at `components/game/Scoreboard.tsx:9`; an image 503 shows the alt text and the table still reads | §8.1 |
| note 11 | `TeamRadarActions`' failed state is red, outside `app/matchup/`, as on the two live share pages | §8.1 |
| note 13 | The home half's cut uses `bandHalf`'s mechanism | §6.3 |
| note 14 | `matchupRingColour` takes the two CARD colours | §5.4 |
| note 15 | There is no K13 | §9 |
| note 17 | The table makes the numbers reviewable under `next dev` on Windows | §11 |

Accepted by the review and unchanged: the ring's own floor of 30 (§5.4) and the "Each label…" sentence left out on playoff-game cards (§6.3).

## 1. What ships

One 1200×630 image per game: both overlay radars side by side (away team's ball, home team's ball), each team in ONE colour of its own across the whole card, the stat and the league rank for both units on every spoke. Plus a share page that carries it as its link preview and repeats its 14 lines as a readable table under the picture, a Share block on the matchup page, and the matchup page's own link preview pointing at the same image.

The owner's requirements, in his words, and where each is met:

| Requirement | Where |
|---|---|
| "each team to use a different color, both teams shouldn't be in blue etc" | §5, the colour rule, tested over all 992 ordered pairs |
| "get rid of the red lines connecting the dots if they are more than 5 ranks apart" | §6: no gap bars, no red on the card unless red is a team's colour |
| "the actual stat should be listed too not just the rank" | §6.4: `11.3% · 1st` for the offense and `3.4% · 2nd` for the defense on every spoke |
| one card per game | one share URL and one image URL per ordered pair; no `ball`, no side |

Decisions taken on the designer's open questions (final for v1): distance threshold **40**; when the home team has nothing that clears the away colour, the away team switches; the header band follows the card colour; the middle ring is amber, grey only when a card colour is close to amber (defined in §5.4); numbers in ink with a team-coloured mark; "Turnovers" / "Sacks" labels as on the mockup with no extra note on the image; silver and gold fallbacks as built; a played game prints its final score as the matchup page header does; a pair with no game shows "VS".

## 2. What the code says today

| # | Finding | Evidence | Consequence |
|---|---|---|---|
| F1 | The matchup page has no preview image, by an earlier decision. | matchup spec `2026-10-10-team-matchup-design.md:30` ("No share card, no image route"), `:243` ("No `openGraph.images`"); `app/matchup/[away]/[home]/page.tsx:120-126`; test `__tests__/app/matchup-route.test.tsx:452-457` asserts both are `undefined` (the two assertions are `:454-455`) | This spec replaces those two lines. The test is edited on purpose in PR 2 (§10). |
| F2 | One loader, nothing per pair. | `lib/data/matchup.ts:259` `loadMatchup`; memo keys `:9-18`; 8 requests cold / 0 warm measured in `__tests__/data/matchup-requests.test.ts:84-91` | The card uses `loadMatchup` as it is. No new read, table, column or DDL. |
| F3 | The loader may hand back a load with no games. | `lib/data/matchup.ts:339-358`: a failed or unusable games read is logged and gives `game: null`, `records: null`, `swap: false`, `gamesAvailable: false` | Honest on a page rendered per request. On an image the CDN keeps for an hour it would be a confident "VS" card for a scheduled game. The image answers 503 (§4.2). |
| F4 | A season the site does not list is the newest season on the matchup page, not a 404. | `lib/data/matchup.ts:275` | The share page follows it. The image route cannot (it would draw the newest season under another URL): §4. |
| F5 | The played-game text exists and is the header's. | `lib/stats/matchup.ts:985-1004` `formatKickoff` ("Thu Oct 8 · Final: TB 24, DAL 16", away first); `:970-975` `gameWeekLabel`; printed by `components/matchup/MatchupHeader.tsx:84-85,99-104` | The card prints the same two strings. |
| F6 | "No {season} game between these teams" is a private constant of the header. | `components/matchup/MatchupHeader.tsx:28` | PR 1 moves it to `lib/stats/matchup.ts` as `matchupNoGameText(season)`; the header imports it; text unchanged. |
| F7 | A spoke's radius comes from its own pool, not from 32. | `lib/stats/team-radar.ts:122-126` `radarScore(rank, pool)`, `:129` `radarRadius`, `:917-920` `plottableScore`; used by `components/matchup/MatchupRadarChart.tsx:43,48-57` | The card plots `radarRadius(plottableScore(spoke))`. The mockup used `(32 − rank) / 31` (`template-c2.html` `rad()`): equal only when all 32 teams have that spoke. |
| F8 | The radar's rank label has no "of N". | `lib/stats/team-radar.ts:482-485` `spokeRankLabel` ("T-27th"); the ladder's cell uses `rankCellLabel` (`:488-492`, "T-27th of 31") | The card uses `spokeRankLabel`, as the page's own radar label does (`lib/stats/matchup.ts:476`). The mockup took its ranks from the ladder cells; they match whenever no pool is short. |
| F9 | The page's radar draws the defense in slate and has rect markers and svg text. | `MatchupRadarChart.tsx:39` (`#334155`), `:126-138` (`<rect>`), `:143-155` (`<text>`), gap bars `:108-124` | The card is a new drawing in `lib/og/`, not this component. The page chart is not touched (non-goal). |
| F10 | The page's header slabs are each team's primary. | `MatchupHeader.tsx:65` | Not touched. So LA is blue on the page and gold on the BUF-at-LA card (§5.6). |
| F11 | `matchup-links.ts` must import nothing, and only two files in `components/matchup/` may be client components. | `lib/stats/matchup-links.ts:4-10`; `__tests__/components/matchup/guards.test.ts:13-16` (exactly ten files), `:187-189` (exactly two client components), `:126-130` (no `red-\d00` outside three files), `:154-157` (pixel font users) | The Share block is a new client file under `app/matchup/[away]/[home]/`, takes ready-made URLs, and uses no red (§8.2). |
| F12 | The image query grammar and its one spelling already exist and are generic. | `lib/stats/compare-links.ts:38-45` `canonicalImageQuery`, `:48-50` `compareWeek`; `lib/stats/compare-card.ts:48-55` `rawQueryOf`, `:73-98` `parseCompareImageQuery` | Reused as they are, under matchup names (§4.2). |
| F13 | Image fonts: one loader, two families, no file fetched. | `lib/og/team-radar-image.tsx:49,51` (`PIXEL`, `SANS`), `:102-116` `radarImageFonts(load, label)` | Reused with the label `"Matchup card image"`. No new font. Press Start 2P is exactly 1 em wide per character (measured, and `lib/og/compare-card-image.tsx:78`). |
| F14 | Lowercase header keys, `STORED`, 404 stored / not stored, 503. | `app/api/compare-card/[a]/[b]/route.tsx:31,34,38-42,51-63` | Copied rule for rule (§4.2). |
| F15 | `/api/revalidate` already clears both layouts. | `app/api/revalidate/route.ts:22` (`/card`), `:24` (`/matchup`) | No change. |
| F16 | Card pages are out of the sitemap; no matchup pair is in it. | `app/sitemap.ts:38-39,123-125` | No change. |

## 3. Files

**PR 1 (pure, no visible change)**

| File | New / changed | Holds |
|---|---|---|
| `lib/stats/matchup-colours.ts` | new | §5: `labOf`, `colourDistance`, `coloursAlike`, `readableOnWhite`, `darkenToReadable`, `matchupCardColours(away, home)`, `matchupRingColour`. Pure; imports only `contrastOnWhite` / `RADAR_MIN_STROKE_CONTRAST` from `lib/stats/formatters.ts` (`:315,318`). No `lib/data`. |
| `lib/stats/matchup-card.ts` | new | The image query parser and hrefs (§4), `buildMatchupCard` (§6.1), `MATCHUP_CARD_LAYOUT`, `MATCHUP_CARD_KEEP_CLEAR_Y`, every sentence K1-K16 (§9). Pure: imports `lib/stats/matchup.ts`, `team-radar.ts`, `formatters.ts`, `box-score.ts` (`formatRecord`), `compare-links.ts`, `compare-card.ts` (`rawQueryOf`, `parseCompareImageQuery`), `matchup-colours.ts`, and types. Server-side only: never imported by a `"use client"` file (a test walks the imports). |
| `lib/stats/matchup-links.ts` | changed | + `matchupCardPath(awayId, homeId)`, `matchupCardHref(awayId, homeId, { season, defaultSeason })` (the `matchupHref` rule without `ball`, `:49-66`), and the Share block's six strings (K12). Still imports nothing. |
| `lib/stats/matchup.ts` | changed | + `matchupNoGameText(season)` (F6). Nothing else. |
| `components/matchup/MatchupHeader.tsx` | changed | imports `matchupNoGameText`; output byte-identical (its test stays green untouched). |
| tests, fixture, reference scripts | new | §10 |

**PR 2 (visible)**

| File | New / changed | Holds |
|---|---|---|
| `lib/og/matchup-card-image.tsx` | new | `matchupCardImage(model)`, `matchupPlateImage(model)` (§6, §7) |
| `app/api/matchup-card/[away]/[home]/route.tsx` | new | §4.2 |
| `app/card/matchup/[away]/[home]/page.tsx` | new | §8.1, including the two readable tables (markup in the page; no new component file) |
| `app/card/matchup/[away]/[home]/MatchupCardActions.tsx` | — | **not created**: the page uses `TeamRadarActions` as the compare card page does (`app/card/compare/[a]/[b]/page.tsx:21,302-305`) |
| `app/card/matchup/page.tsx`, `app/card/matchup/[away]/page.tsx` | new | `notFound()` only, no read (else `/card/matchup` falls through to the player card route `app/card/[slug]` and reads). `matchup` joins `compare` and `team` as a slug no player can have a card page under; no live slug is `matchup`. |
| `app/matchup/[away]/[home]/MatchupShare.tsx` | new | `"use client"`; §8.2 |
| `app/matchup/[away]/[home]/page.tsx` | changed | the Share block; `generateMetadata` gains the image (§8.3); `listedSeason` (`:83-93`) moves out |
| `lib/data/matchup-season.ts` | new | exported `listedMatchupSeason(requested, what)`: the page's `listedSeason` (`page.tsx:83-93`) moved here unchanged so the share page can call it too. It imports only `getSeasonWeeksCached` from `lib/data/compare-card.ts`. A module of its own on purpose: `__tests__/app/matchup-route.test.tsx:30` mocks `@/lib/data/matchup` as `{ loadMatchup, loadMatchupIndex }` only, so a helper placed there would be `undefined` in that file; here the five "308 and the season list" tests (`:162-192`) keep running the real function against the `getSeasonWeeksCached` mock (`:33`) and pass untouched. `lib/data/matchup.ts` is NOT changed. |
| `.claude/CLAUDE.md`, `memory/MEMORY.md`, this spec's "As built", matchup spec amendment | changed | §13 |

Not changed: `scripts/ingest.py`, the database, `lib/data/matchup.ts`'s reads, `MatchupRadarChart.tsx`, `MatchupSidePanel.tsx`, the page's colours, `app/sitemap.ts`, `app/robots.ts`, `app/api/revalidate/route.ts`, `next.config.mjs`, the other two cards.

## 4. URLs, validation, status codes

**Share page:** `/card/matchup/[away]/[home]` · **Image:** `/api/matchup-card/[away]/[home]`. Away first, as on `/matchup/[away]/[home]`.

### 4.1 Share page, in order

| # | Check | Answer | Reads |
|---|---|---|---|
| 1 | Both segments pass `parseMatchupTeamId` (`matchup-links.ts:90-92`, tested BEFORE upper-casing) and `getTeam`; the two teams differ | else `notFound()` | none |
| 2 | `?season=` through `parseMatchupSeason` (`:35-39`: one string, four digits, 1999-2100; anything else = none asked for). `ball` and every other key are ignored. | — | none |
| 3 | Each segment is already its upper-case id | else **308** `permanentRedirect(matchupCardHref(AWAY, HOME, { season: await listedMatchupSeason(requested, what) }))` (`what` = the log label, e.g. `"Matchup card (BUF at LA)"`): the matchup page's rule (`page.tsx:143-146`): the query is rebuilt, never echoed; an unlisted season is dropped | the memoised season list, only when the address names a season |
| 4 | `loadMatchup(away.id, home.id, requested)` | a failed core read rejects: `app/error.tsx`, a real 500 (no `loading.tsx` in the folder) | 8 cold / 0 warm |
| 5 | `load.swap` (no game in this order, one the other way) | **307** `redirect(matchupCardHref(HOME, AWAY, { season: load.season, defaultSeason: load.defaultSeason }))` (`page.tsx:154-156` without `ball`) | — |
| 6 | A requested season the site does not list | the newest season is shown (`matchup.ts:275`); canonical and `og:url` are the bare URL; the image URL names the season actually shown | — |
| 7 | State (§7) | card page, or a message page | — |

`generateMetadata` runs 1-3 itself with no read and returns the plain not-found object for an invalid pair, for a URL about to 308 and for a load about to 307 (`page.tsx:99-107`). It is not wrapped in React `cache()`: like the matchup page (`page.tsx:11-14`), metadata and body get the same memoised reads.

### 4.2 Image route, in order

Header keys are lowercase on every response (`cache-control`, `content-type`, `content-disposition`, `retry-after`); a test asserts exactly one `cache-control`. `STORED` = `public, max-age=0, s-maxage=3600`. `export const runtime = "nodejs"; export const revalidate = 0;`.

| # | Input | Status | `cache-control` | Reads |
|---|---|---|---|---|
| 1 | A segment that is not exactly an upper-case team id (`BUF`): lower or mixed case, an unknown id, a look-alike letter, a missing param | 404 | `STORED` | none |
| 2 | The same team twice | 404 | `STORED` | none |
| 3 | A query that is not the one spelling the page prints: nothing, or `season` (4 digits, 1999-2100), then `w` (1-22, no leading zero), then `download=1`, once each, no other key, in that order (`parseMatchupImageQuery` = `parseCompareImageQuery(rawQueryOf(req.url))`) | 404 | `STORED` | none |
| 4 | The seasons read (`getSeasonWeeksCached`) fails, or the list is empty on a real database | 503, body K14 | `no-store`, `retry-after: 60` | memo |
| 5 | `season` named and not in the list | 404 | `no-store` (it may exist after the next refresh) | none more |
| 6 | `loadMatchup(away, home, season ?? null)` rejects (seasons, rows, an empty answer for a season that has rows: `matchup.ts:268-332`) | 503 | `no-store`, `retry-after: 60` | memo |
| 7 | `load.gamesAvailable === false` (F3) | 503 | `no-store`, `retry-after: 60` | — |
| 8 | `load.swap` | 404 | `no-store` (which order is scheduled depends on the season's schedule) | — |
| 9 | `buildMatchupCard(...)` is a plate (§7: `uncovered`, `small-pool`, neither radar drawable) | 200 PNG, the plate | `STORED`; never an attachment, even with `download=1` | — |
| 10 | a card | 200 PNG | `STORED`; with `download=1` also `content-disposition: attachment; filename="<AWAY>-at-<HOME>-<season>-matchup.png"` (`-vs-` when the pair has no game), built from the two validated ids and the resolved season only | — |

Rules behind the table:

- **Case is strict on the image and a redirect on the page.** Nothing but the site prints image URLs and it always prints upper case; a redirect on an image would be a second cached object per card. A hand-typed lower-case image URL is a stored 404.
- **The season rule differs between page and image on purpose.** The page follows the matchup page (unlisted = newest, F4). The image never draws one season under a URL that names another: it would be stored for an hour under the wrong name. The page never prints such a URL (it writes `season=` from `load.season`).
- **A reversed scheduled pair** is a 307 on the page and a 404 on the image: by the time a preview fetcher asks for an image it has followed the page's redirect and read the canonical order's `og:image`.
- **No database** (`hasNoDatabase`): the seasons list is empty and `loadMatchup` throws (`matchup.ts:310-312`), so the route answers 503. (The compare image answers 404 there; this route follows its own loader. CI's build never calls a `revalidate = 0` handler.)
- **Never a wrong card, never a stored error:** every 503 is `no-store`; every answer that depends on data that can change is `no-store`; only junk and drawn images are stored.
- `w` is accepted for any week 1-22 and never checked against the current week (compare card spec §4: the page and the image can be a week apart).

### 4.3 Hrefs (all in `lib/stats/matchup-card.ts` except the page path)

- `matchupCardHref(away, home, { season, defaultSeason })` (in `matchup-links.ts`): bare for the default season, `?season=` for another the route's rule reads back.
- `matchupCardImageHref(away, home, season, { week, download })` = `/api/matchup-card/AWAY/HOME` + `canonicalImageQuery(season, compareWeek(week), download)`: always with the season; `w` only when the week is 1-22.
- `matchupCardDownloadFilename(away, home, season, hasGame)`.
- Absolute URLs (Copy Link, `og:url`, `og:image`, canonical) are built on the server from `process.env.NEXT_PUBLIC_SITE_URL || "https://yardsperpass.com"` (`page.tsx:109`). A Vercel preview therefore copies and previews the production address unless that variable is set for Preview (compare spec §17 item 12 R1).

## 5. The colour rule (`lib/stats/matchup-colours.ts`)

Deterministic, pure, no dependency. Input: two teams' `primaryColor` and `secondaryColor` (`lib/data/teams.ts:10-41`). All hex output is upper-case `#RRGGBB`.

### 5.1 Building blocks

- **Linear channel:** `c = v / 255; c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4` (the site's own, `formatters.ts:320-323`).
- **Readable on white:** `contrastOnWhite(hex) >= RADAR_MIN_STROKE_CONTRAST` (3.0; `formatters.ts:315,318-326`).
- **CIELAB, D65:** `X = (0.4124 r + 0.3576 g + 0.1805 b) / 0.95047`, `Y = 0.2126 r + 0.7152 g + 0.0722 b`, `Z = (0.0193 r + 0.1192 g + 0.9505 b) / 1.08883` on linear channels; `f(t) = t > 0.008856 ? cbrt(t) : 7.787 t + 16/116`; `L = 116 f(Y) − 16`, `a = 500 (f(X) − f(Y))`, `b = 200 (f(Y) − f(Z))`.
- **Distance:** CIE76, the straight-line distance between two Lab triples.
- **Darken until readable** (`darkenToReadable`): a readable colour is returned unchanged. Otherwise for `n = 1 … 19`, each channel becomes `Math.round(v × (20 − n) / 20)` (whole twentieths, half rounds up), and the first readable result is returned. Integer steps on purpose: the mockup's script subtracted 0.05 nineteen times in floating point and rounded half-to-even, which lands one shade lower on some channels (see §14 item 2).
- **Junk input, defined** (never real data: `teams.ts` is a static file of valid hexes): a colour is usable only if it matches `/^#[0-9a-fA-F]{6}$/`. Every usable input is **upper-cased before any comparison** (step 3 of the chain skips by string equality). `darkenToReadable` of an unusable value returns `null` (the reference scripts would produce `NaN` there; the TypeScript must not). `readableOnWhite`, `labOf` and `coloursAlike` are never called with an unusable value: the chain drops such candidates first.

### 5.2 "Alike": `coloursAlike(a, b)`

True when any one holds (constants exported, each named in a test):

| Test | Constant | Rule |
|---|---|---|
| distance | `COLOUR_ALIKE_DISTANCE = 40` | `colourDistance(a, b) < 40` |
| both very dark | `COLOUR_DARK_MAX_L = 25` | both `L < 25` (navy, black, dark green, brown read as "dark") |
| same family | `COLOUR_FAMILY_MIN_CHROMA = 20`, `COLOUR_FAMILY_MAX_HUE = 30` | both chromas `hypot(a, b) >= 20` and their hue angles `atan2(b, a)` are under 30 degrees apart (the short way round) |

Order of evaluation: distance, both dark, family. A colour with chroma under 20 has no hue to compare.

### 5.3 The chain: `matchupCardColours(away, home)`

1. **Away, first choice:** its primary if readable; else its primary darkened (PIT `#BF890E`, NO `#9E8D6A`); else its secondary if readable; else ink `#0F172A`.
2. **Home**, the first of these that is readable and not alike the away colour: primary · secondary · secondary darkened · primary darkened.
3. **Else the away team gives way:** for the away team's secondary, then its secondary darkened (skipping one that is unreadable or equal to its first choice), run step 2 again; the first hit wins (`awaySwitched: true`).
4. **Else** home is slate `#64748B`, then ink `#0F172A`, the first not alike the away team's first choice. Not reached by any of today's 992 pairs.
5. **Else**, so the function is total: the usable, readable candidate farthest from the away team's first choice, among home's four own candidates, slate and ink; the result carries `closest: true`. **Reached only when a team's colours are unusable** (none of the 992 real pairs reaches step 4, let alone 5), and **its result may be alike the away colour**: with both home colours junk, slate and ink are both alike 8 of the 32 away first choices (DAL `#041E42`: 38.9 from slate, 12.5 from ink, so the answer is `#041E42` / `#64748B`, `homeFrom: "grey"`, `closest: true`). No third neutral is added for a case that cannot occur.

Returns `{ away, home, awayFrom, homeFrom, awaySwitched, awayRule, homeRule, ring, closest }`. `awayFrom` / `homeFrom` ∈ `primary | primary-darkened | secondary | secondary-darkened | grey | ink` (in step 5 `homeFrom` is the chosen candidate's own name; the Python reference's `-closest` suffix is the `closest` flag here). `closest` is `false` for steps 1-4. The golden holds the other eight fields; `closest` is asserted `false` for all 992. **`awayRule` / `homeRule`** (the 5 px rule under each half of the band) is the team's colour NOT in use: its secondary when the card colour came from its primary, else its primary. If that colour is unusable, the rule is drawn in the team's card colour (the band simply has no stripe).

**The 5 px rule is exempt from the "not alike" guarantee**, by the approved mockup (`shots/card-C2-BUF-LA.png`, notes.md "The thin rule under each half…"): in 32 ordered pairs a team's rule is exactly the other team's card colour (CIN at DEN: Denver's navy band on an orange rule) and in more it is merely alike it (BUF at LA: LA's gold band on a `#003594` rule, 3.0 from Buffalo's band). It is a stripe of the team's own second colour, not an encoding. Nobody should "fix" it.

An unusable value is skipped as a candidate; with nothing usable a team falls to ink (away) or step 4 (home). All four unusable: ink `#0F172A` / slate `#64748B` (step 4; 40.5 apart). The function never throws and gives the same answer on every call.

### 5.4 The middle-of-the-league ring: `matchupRingColour(awayCardColour, homeCardColour)`

Its two arguments are the two CARD colours (§5.3's `away` and `home`), not the teams' primaries.

- Amber `#F59E0B` (the page's ring, `MatchupRadarChart.tsx:77`) unless a card colour is **close to amber**; then slate grey `#94A3B8`.
- **Close to amber, exactly:** `labOf(c).L >= COLOUR_DARK_MAX_L && coloursAlike("#F59E0B", c)`. So: within 40 of amber, or in amber's colour family (golds, oranges, the darkened golds), and not a very dark colour.
- Why the lightness clause (a change from the mockup, §14 item 3): Cleveland's brown `#311D00` is in amber's hue family but is 83 away from it and nobody mistakes one for the other. Without the clause the ring went grey for CLE at DAL, IND and LV, where the home team is drawn in silver 11-13 away from that grey: the very clash the grey ring exists to avoid.
- **What is guaranteed, and tested over all 992:** the ring is at least `MATCHUP_RING_MIN_DISTANCE = 30` from both card colours (smallest today: 30.3, grey beside Miami's teal in CIN at MIA; amber's smallest is 56.7). It is NOT guaranteed to pass `coloursAlike` at 40 against both teams: no neutral grey can (measured: the best light grey reaches 38, and is too faint to see). The ring is a thin dotted guide (1.5 px, dash 5,3), never a team's line (3 px, dash 8,5, square markers), so it gets its own, lower floor.
- Counts today: amber 637 pairs, grey 355.

### 5.5 What the rule gives (threshold 40; from `colour_ref.py`, equal to `colour-ref.mjs` on all 992)

Home colour came from: primary 548, secondary 192, secondary darkened 149, primary darkened 32, away gives way 71 (grey or ink: 0). Away colour: primary 859, primary darkened 62 (PIT, NO), secondary 37, secondary darkened 34. 48 distinct colours in all. Closest two teams on any card: 40.3 (GB at LV and GB at PHI: dark green beside silver).

Named pairs for the table test (away at home):

| Pair | Away | from | Home | from | Ring | Rules (away / home) |
|---|---|---|---|---|---|---|
| BUF at LA | `#00338D` | primary | `#CC8200` | secondary darkened | grey | `#C60C30` / `#003594` |
| LA at BUF | `#003594` | primary | `#C60C30` | secondary | amber | `#FFA300` / `#00338D` |
| TB at DAL | `#D50A0A` | primary | `#041E42` | primary | amber | `#FF7900` / `#869397` |
| LAC at KC | `#0080C6` | primary | `#E31837` | primary | amber | `#FFC20E` / `#FFB81C` |
| KC at TB | `#BF8A15` | secondary darkened (away gave way) | `#D50A0A` | primary | grey | `#E31837` / `#FF7900` |
| TB at KC | `#D50A0A` | primary | `#BF8A15` | secondary darkened | grey | `#FF7900` / `#E31837` |
| KC at SF | `#E31837` | primary | `#AA9158` | secondary darkened | grey | `#FFB81C` / `#AA0000` |
| PIT at NO | `#BF890E` | primary darkened | `#101820` | secondary | grey | `#101820` / `#D3BC8D` |
| NO at PIT | `#9E8D6A` | primary darkened | `#101820` | secondary | grey | `#101820` / `#FFB612` |
| BAL at PIT | `#241773` | primary | `#BF890E` | primary darkened | grey | `#000000` / `#101820` |
| DAL at NE | `#041E42` | primary | `#C60C30` | secondary | amber | `#869397` / `#002244` |
| NE at DAL | `#002244` | primary | `#869397` | secondary | amber | `#C60C30` / `#041E42` |
| MIA at NYJ | `#008E97` | primary | `#000000` | secondary | amber | `#FC4C02` / `#125740` |
| JAX at PHI | `#9F792C` | secondary (away gave way) | `#004C54` | primary | grey | `#006778` / `#A5ACAF` |
| GB at NYJ | `#BF890E` | secondary darkened (away gave way) | `#125740` | primary | grey | `#203731` / `#000000` |
| GB at PHI | `#203731` | primary | `#8C9295` | secondary darkened | amber | `#FFB612` / `#004C54` |
| CIN at DEN | `#FB4F14` | primary | `#002244` | secondary | grey | `#000000` / `#FB4F14` |
| DET at LAC | `#0076B6` | primary | `#B3880A` | secondary darkened | grey | `#B0B7BC` / `#0080C6` |
| CLE at DAL | `#311D00` | primary | `#869397` | secondary | **amber** | `#FF3C00` / `#041E42` |
| CLE at CHI | `#FF3C00` | secondary (away gave way) | `#0B162A` | primary | grey | `#311D00` / `#C83803` |
| HOU at TEN | `#03202F` | primary | `#4B92DB` | secondary | amber | `#A71930` / `#0C2340` |

### 5.6 Should the matchup PAGE adopt this rule?

**Not in these PRs.** The page draws one team's colour per radar (offense) over a slate defense, and its slabs are each team's primary. After this ships a team can be one colour on the page and another on the card (LA: blue slab, gold card). That is the price of "both teams shouldn't be in blue" on a picture that shows both at once; the page never shows two team colours in one chart. Named as a follow-up for the owner to decide after he has seen the card live.

## 6. The image (`lib/og/matchup-card-image.tsx`)

### 6.1 One model: `buildMatchupCard(input)`

Input: `{ away: Team, home: Team, load }` where `load` is the `MatchupLoad` with `gamesAvailable === true` (callers check first; the builder returns a plate saying K11 if handed one without). Output, plain data, printed by the image, the share page and both metadata functions:

```ts
type MatchupCardModel =
  | { kind: "card"; season; defaultSeason; throughWeek: number | null; hasGame: boolean;
      colours: MatchupCardColours;            // §5
      band: { away: BandHalf; home: BandHalf; seam: "AT" | "VS" };
      subLine: string; showHowTo: boolean;    // §6.3
      panes: [Pane, Pane];                     // away ball, home ball
      legendLine: string;                      // K5
      title: string; previewTitle: string; description: string; alt: string }
  | { kind: "plate"; season; defaultSeason; throughWeek: number | null; hasGame: boolean;
      colours; band; message: string; title; previewTitle; description; alt };
type BandHalf = { id; name: string /* upper-cased */; nameSize: 24 | 20 | 16; color; textColor; ruleColor; meta: string };
type Pane =
  | { drawn: true; offId; defId; offColor; defColor;
      off: Vertex[]; def: Vertex[];            // plottable spokes only, pane coordinates
      labels: SpokeLabel[] }                   // always 7, RADAR_AXES order
  | { drawn: false; offId; defId; offColor; defColor; message: string };
type SpokeLabel = { key: RadarAxisKey; name: string; offLine: string; defLine: string;
                    box: { left; top; width; height; align: "start" | "center" | "end" } };
```

- `panes[0]` = `model.awayBall.overlay` (away offense over home defense), `panes[1]` = `model.homeBall.overlay` (`lib/stats/matchup.ts:301-313,487`). A team's colour is the same in both panes: `offColor` of pane 0 = `defColor` of pane 1 = `colours.away`.
- A vertex: spoke `i` of `overlay.off` / `overlay.def` with `plottableScore(spoke) !== null`, at `radarPoint(G, G.r × radarRadius(score), i)` (F7). A spoke with no value has no vertex; the outline bridges it, as on the page (`MatchupRadarChart.tsx:48-57`).
- A label line: `spoke.value === null || spoke.rank === null` → `"—"`; else `` `${fmtRadarPct(spoke.value)} · ${spokeRankLabel(spoke)}` `` (`team-radar.ts:477-485`). Label names are the overlay's own `spokes[i].label` (`matchup.ts:293-296,475`, from `OVERLAY_LABELS` `:363-371`): Explosive pass · Pass success · Sacks · Turnovers · Stuffs · Run success · Explosive run.
- `throughWeek` = `compareWeek(load.model?.throughWeek ?? null)`: `model` is `null` in the `uncovered` state (`lib/data/matchup.ts:211`; the page reads it the same way, `page.tsx:114`). A week outside 1-22 prints no week and sends no `w`.

### 6.2 Satori rules (the two live images' rules; each held by a test)

Inline styles only; every `div` is `display: flex`; no grid. Inside `<svg>` only `<path>`, `<line>`, `<circle>` with plain numbers: no `<rect>`, `<polygon>`, `<text>`. Plain elements only: no components, no fragments. Fills use 8-digit hex. Fonts: `radarImageFonts(undefined, "Matchup card image")`; families `PIXEL` (Press Start 2P) and `SANS` (the Noto Sans regular inside next/og). One weight; nothing is bold. Capitals are typed, not styled. No logos.

**Glyphs.** For a character no registered font has, next/og tries to fetch a font over the network at request time, so every character the image prints must be in the family it is set in. The only non-ASCII characters allowed on the image are `·` (U+00B7), `—` (U+2014) and `’` (U+2019, in `matchupUncoveredHeading`, which goes on a plate); all three are in the bundled Noto Sans, and Press Start 2P has A-Z, 0-9, space, `.`, `:` and `·` (read from both files' cmap). `→` is NOT in Noto Sans: it stays in K9 and K12, which are HTML only. A test holds this (§10).

### 6.3 Layout: `MATCHUP_CARD_LAYOUT` (1200×630), top to bottom

| y | Block | Height | Content |
|---|---|---|---|
| 0-76 | **Band** | 76 | Two halves, 600 px each, padding 0 40. Left = away on `colours.away`, right = home on `colours.home`, right-aligned. Name: `PIXEL`, in a 520 px box 32 px tall, `nowrap`, `overflow: hidden`, cut at its end on both halves as `bandHalf` does (`lib/og/compare-card-image.tsx:78-82,102`: the right half is right-aligned only while the name fits, else left-aligned so its start is never lost). Meta under it: `SANS` 16 px, opacity 0.92, margin-top 1. Text colour `textColorForBackground(colour)` (`formatters.ts:296`). **Seam box:** absolute, left 568, top 11, 64×54, radius 4, 3 px white border, ink background, `PIXEL` 16 px white: `AT` when `load.game !== null`, else `VS`. |
| 76-81 | **Rule** | 5 | Two 600 px halves: `colours.awayRule`, `colours.homeRule`. |
| 81-113 | **Sub-band** | 32 | Background `#F8FAFC`, 1 px bottom border `#E2E8F0`, padding 0 40, `space-between`. Left: K3 (`SANS` 15 px `#475569`, max-width 500, `nowrap`, `overflow: hidden`). Middle, only when `showHowTo`: K4 (same style). Right: `YARDSPERPASS.COM` (`PIXEL` 10 px `#64748B`). |
| 113-510 | **Body** | 397 | Pane (599) · divider (2 px `#E2E8F0`, margin-top 14, margin-bottom 10) · pane (599). Each pane: a 34 px legend row, then the 599×363 radar area. |
| 510-630 | **Footer** | 120 | Background `#F8FAFC`, 1 px top border, padding 14 40 0, items right-aligned: K5 (`SANS` 15 px `#64748B`), then `YARDSPERPASS.COM · DATA: NFLVERSE` (`RADAR_CARD_SITE_LINE`, `team-radar.ts:685`; `PIXEL` 10 px `#94A3B8`, margin-top 12). |

Heights sum to 630 (a test). **`MATCHUP_CARD_KEEP_CLEAR_Y = 510`** = band + rule + sub-band + body: nothing a reader needs is below it, at any x, and the bottom-left corner (x < 250, y > 510) is empty (both footer lines are right-aligned; K5 is 907 px wide at most, so it starts at about x = 253). The two live cards use 546; this card uses 510 because X's title label reaches about y = 512 on a phone by the designer's estimate.

**Band name size** (Press Start 2P, 1 em per character): 24 px up to 16 characters, 20 px up to 26, 16 px beyond. The longest of the 32 names, "WASHINGTON COMMANDERS" (21), is 420 px at 20; a 16-character name at 24 ("CLEVELAND BROWNS") is 384 px. The box is 520, so the third step is never used by today's names; it is there so a renamed team cannot overflow. A test walks all 32 names.

**Band meta:** `formatRecord(record)` plus ` · away` / ` · home` only when the pair has a game (`MatchupHeader.tsx:75`); widest real form `12-4-1 · home` = 103 px.

**`showHowTo`** = the pair has no game, or its game is a regular-season game (`normalizeGameType(game.game_type) === "REG"`). Measured at 15 px with the real font: the widest regular-season left line ("Week 18 · Sat Jan 10 · Final: WAS 38, NYG 35 · 2026 through Week 18") is 478 px, K4 is 432, the site name 160: 1,070 of the 1,120 available, 25 px between items. A playoff round ("Conference Championship · Sun Jan 24 · Final: WAS 38, LAC 35 · …") is 606 px and would not fit beside K4 (1,198), so K4 is left out for a playoff game and the left line's max-width becomes 900. This case was not in the mockup (§14 item 4).

### 6.4 A pane

**Legend row** (34 px, centred): a 46×14 svg sample (a 4 px line in the offense's colour with a round dot r 5.5), `{OFF} offense` (`SANS` 19 px ink, margin-left 8), `over` (15 px `#64748B`, margin 0 12), a dashed sample in the defense's colour (dash 8,5, with a white-filled square 10×10 as a closed path), `{DEF} defense`. Widest: about 400 px of 599.

**Radar** (svg 599×363). Geometry `MATCHUP_CARD_RADAR = { w: 599, h: 363, cx: 300, cy: 189, r: 116, gap: 10, lh: 21, f: 17, sw: 1.5, dot: 6 }` (a `RadarGeometry`, `team-radar.ts:855-863`, so `radarPoint`, `radarAngle`, `radarPathD` are reused). Drawn in this order:

| Element | Spec |
|---|---|
| outer ring | path at radius `r`, no fill, stroke `#E2E8F0` 1.5 |
| middle ring | path at `r × radarRadius(RADAR_MID_SCORE)`, no fill, stroke `colours.ring` 1.5, dash `5,3` |
| hub ring | path at `r × RADAR_HUB`, fill white, stroke `#E2E8F0` 1.1 |
| 7 spokes | line from the hub ring to the outer ring, `#EEF2F7` 1.1 |
| defense outline | path through `def` (3+ vertices), fill `defColor` + `14`, stroke `defColor` 3, dash `8,5`, round joins |
| offense outline | path through `off`, fill `offColor` + `22`, stroke `offColor` 3.4, round joins |
| defense markers | per vertex a closed square path, half-side 5.5, fill white, stroke `defColor` 2.6 |
| offense dots | per vertex a circle r 6, fill `offColor`, stroke white 1.3 |

No gap bars. No red unless a team's colour is red.

**Labels:** seven positioned `div`s over the svg. Each is a fixed column: `position: absolute`, `flexDirection: column`, `height: 60`, `overflow: hidden`, with exactly three children of explicit height, each a row with `alignItems: "center"`: the spoke name (`height: 18`; `SANS` 14 px `#475569`), then two stat rows (`height: 21` each; a mark and the text, `SANS` 17 px ink `#0F172A`, line-height 1). 18 + 21 + 21 = 60: nothing in a label is sized by its content. Horizontal alignment is **per row** (each row is its own flex row with `justifyContent` start / center / end by the box's `align`), as the mockup draws them: a right-hand label's three rows each start at the box's left edge, a left-hand label's each end at its right edge. Marks are 11×11 inline svgs with 6 px to their right: a circle in the offense's colour; a white-filled square with a 2.5 px outline in the defense's colour (svg, not a bordered `div`, so Satori's box model is not in play). The numbers are always ink; only the mark carries the team colour.

Box for spoke `i` (angle `radarAngle(i)`; `x`, `y` = the point at `r + gap` = 126 from the centre):

| cos | left | width | content aligned |
|---|---|---|---|
| > 0.3 | `x` | `599 − x` | start |
| < −0.3 | 0 | `x` | end (the text ends at the ring side) |
| else (the top spoke) | `x − 90` | 180 | centre |

top = `y − 60` when sin < −0.3 · `y` when sin > 0.3 · `y − 30` otherwise. The seven boxes, in pane coordinates (pinned by a test; card y = pane y + 147):

| i | Spoke | left | width | top | bottom | align | bottom on the card |
|---|---|---|---|---|---|---|---|
| 0 | Explosive pass | 210.0 | 180.0 | 3.0 | 63.0 | centre | 210.0 |
| 1 | Pass success | 398.5 | 200.5 | 50.4 | 110.4 | start | 257.4 |
| 2 | Sacks | 422.8 | 176.2 | 187.0 | 247.0 | start | 394.0 |
| 3 | Turnovers | 354.7 | 244.3 | 302.5 | 362.5 | start | **509.5** |
| 4 | Stuffs | 0.0 | 245.3 | 302.5 | 362.5 | end | **509.5** |
| 5 | Run success | 0.0 | 177.2 | 187.0 | 247.0 | end | 394.0 |
| 6 | Explosive run | 0.0 | 201.5 | 50.4 | 110.4 | end | 257.4 |

- **The top box is 180 wide, not the mockup's 240** (§14 item 5): at 240 it overlaps the boxes of spokes 1 and 6 (180-420 against 398.5 and 201.5). The mockup's "no two labels intersect" check measured the drawn text, which is narrower; a test here can only measure boxes. At 180 the gaps are 8.5 px each side.
- **The keep-clear margin is half a pixel for the BOX** (509.5 against 510). Any change to the band, rule, sub-band or legend heights, to `cy`, `r`, `gap` or the 60 px label height must re-derive this table. The three rows are fixed at 18 / 21 / 21 so the content is exactly 60 tall (the mockup's 14 px × 1.3 name line made it 60.2). By the font's own metrics the lowest ink of a 17 px line centred in its 21 px row is about 4 px above the box bottom (about y = 505.6), but only if Satori lays the rows out as specified: that is measured on the rendered PNG, by a script, as a merge gate (§11).
- **Text fit, at real glyph widths** (Noto Sans regular, advances read from the bundled file): the widest possible stat line is `100.0% · T-32nd` = 126 px, 143 with its mark; `100.0% · T-27th` is 122 / 139. The narrowest side box is 176 (Sacks), so the worst case keeps 33 px; the top box (180) keeps 37. The widest spoke name, "Explosive pass", is 95 px. A side label grows away from the ring, inside its own pane, so the two panes' labels can never meet across the divider.
- **Clearance from the chart:** each box is at least 9.7 px from the outer ring's nearest corner and crosses no ring edge (computed; a test repeats it).

### 6.5 A pane that cannot be drawn

`overlay.drawn === false` (a team with no games, or a side with fewer than 4 real spokes: `matchup.ts:461`, `team-radar.ts:355-357`): the legend row stays; in place of the radar one centred sentence (`SANS` 18 px `#475569`, 460 px wide box, wraps): `matchupNoGamesNote(teamName, season)` when that pane's offense or defense team has `games === 0` (the away team's name first when both), else `MATCHUP_NO_OVERLAY_NOTE` (`matchup.ts:1012-1017`). The other pane still draws. When NEITHER pane can be drawn the model is a plate (§7).

## 7. States: what each surface shows

| Loader state | Image | Share page | Share page metadata | Share block on `/matchup/…` |
|---|---|---|---|---|
| `ready`, at least one pane drawn, games available | the card (a pane that cannot be drawn carries its sentence) | the card page (§8.1) | title K1, description K2, image | shown |
| `ready`, neither pane drawn | plate: the first applicable of `matchupNoGamesNote` / `MATCHUP_NO_OVERLAY_NOTE` | message page, no buttons | title K1, the sentence as description, image (the plate) | hidden |
| `small-pool` | plate: `MATCHUP_SMALL_POOL_NOTE` (`matchup.ts:1009`) | message page | same | hidden |
| `uncovered` | plate: `matchupUncoveredHeading(season, firstSeason)` (`:1093-1097`) | message page with the page's "See AWAY and HOME in {default}" link | same | hidden |
| `gamesAvailable: false` (any state) | **503** `no-store` | message page: K11, link to the matchup page; no image element, no buttons | title K1, description K11, **no image** | hidden |
| a core read failed | **503** `no-store` | throws → `app/error.tsx`, real 500 | throws | the matchup page itself is the error card |
| a spoke with no value or rank | no vertex on that spoke for that unit (the outline bridges it); its label line is `—` | as the image | — | — |
| `load.swap` | 404 `no-store` | 307 | not-found object | n/a (the matchup page redirected) |

The **plate** (`matchupPlateImage`) keeps the card's five blocks and their heights, so both teams keep their card colours and the plate is recognisably the same object:

| y | Block | Height | On the plate |
|---|---|---|---|
| 0-76 | band | 76 | exactly the card's: both halves, names, meta, seam box `AT` / `VS` |
| 76-81 | rule | 5 | exactly the card's |
| 81-113 | sub-band | 32 | drawn, same background and border. Left: the season part of K3 only, `{season} through Week {w}` or `{season} season` (no game line, no "No … game" text: a plate is about missing ranks, and `small-pool` has a game line that would crowd it). No K4. Right: `YARDSPERPASS.COM`, as on the card |
| 113-510 | message | 397 | white; one block centred both ways: the sentence, `SANS` 26 px `#475569`, in a 900 px wide box, `textAlign: center`, wraps (the longest, `MATCHUP_SMALL_POOL_NOTE`, is two lines). No legend row, no svg, no divider |
| 510-630 | footer | 120 | same background and top border; the site line only (`RADAR_CARD_SITE_LINE`, `PIXEL` 10 px `#94A3B8`), right-aligned, padding 46 40 0 so it sits where it does on the card. No K5 |

Heights sum to 630. Never an attachment. Every message page is HTTP 200, `noindex, follow`.

A played game: K3 carries `formatKickoff`'s "Final: TB 24, DAL 16", exactly as the page header (F5). The ranks already include that game.

## 8. Pages

### 8.1 Share page `/card/matchup/[away]/[home]`

`export const revalidate = 3600`. No `loading.tsx`, no `not-found.tsx`, no `opengraph-image.tsx` in the folder (a test). Server component; the only client code is `TeamRadarActions`.

Card state, top to bottom, in a `max-w-[1080px]` column, never wider than the window:

1. A visually hidden `<h1>`: K6.
2. **The image itself**: `next/image` with `unoptimized`, `src` = `matchupCardImageHref(away, home, season, { week })` (the same URL as `og:image`, so one CDN entry), `width={1200} height={630}`, `className="h-auto w-full"`, `alt` = K7, inside a 1 px slate border. The page does not redraw the CHART in HTML: one drawing, one truth. `next/image` with `unoptimized` is already used at `components/game/Scoreboard.tsx:9` and costs no Vercel image optimisation. On a phone the picture is about 340 px wide and its numbers cannot be read; item 4 is for that. If the image route answers 503 while the page rendered, the visitor sees the alt text and the tables still read.
3. `TeamRadarActions` (`pagePath` = `matchupCardHref(...)`, `downloadHref` = the image href with `download: true`): **Copy Link** / **Download Image**, the other cards' strings and failure sentence ("Copy failed: use the address bar": here the address bar does hold the card). Its failed state is `bg-red-700` (`TeamRadarActions.tsx:64`), as on the two live share pages; this page is outside `app/matchup/`, so the matchup pages' red rule does not apply.
4. **The 14 lines as two readable tables**, one per pane, in pane order (away ball, then home ball), side by side from `md`, stacked below it. Built only from `model.panes[i]`: no second chart, no second calculation.
   - `<caption>`: `{OFF} offense over {DEF} defense` (K15's words), left-aligned, 14 px semibold ink.
   - Columns: the spoke name · `{OFF} offense` · `{DEF} defense`. The two header cells each carry the unit's mark before the words (a 10 px round dot / an outlined square in that team's card colour, as on the image), so the table reads against the picture.
   - Seven rows in `RADAR_AXES` order. Each cell is the pane's `labels[i].offLine` / `labels[i].defLine` string **verbatim** (`11.3% · 1st`, `—`): the same strings the image prints.
   - A pane with `drawn: false` prints its `message` sentence where its table would be (the other pane keeps its table).
   - Plain server-rendered HTML: `<table class="w-full">`, ink text (`text-slate-900`), 13 px with `px-1.5` cells below `sm` and 14 px with `px-2` from `sm`, `tabular-nums`, 1 px slate row borders, no red, no client code, no `overflow` wrapper. It must not scroll sideways at 320 px (296 px inside the page's 12 px gutters): the two value columns are `whitespace-nowrap` (the longest value, `100.0% · T-32nd`, is 97 px at 13 px, 109 with padding, so 218 for both), which leaves 78 px for the name column; it may wrap ("Explosive pass" breaks at the space; "Explosive" is about 56 px at 13 px).
   - No table in any message state.
5. **The rank note directly under the tables:** `matchupRankNote(...)` (M6, `matchup.ts:1038-1050`: what the ranks are among, and that for sacks, takeaways and stuffs a defense making more ranks higher: the note the image has no room for, and the direction the tables' Sacks, Turnovers and Stuffs rows need). Then, 13 px slate, max 80 characters wide: K5 (the legend line); `MATCHUP_FORMULA_LINE` (`:1076-1078`); K8 when a team is not in its primary colour.
6. Links: K9 "See the full matchup →" to `matchupHref(away, home, { season, defaultSeason })`, and each team's page. Every link INTO a matchup or card page has `prefetch={false}`.

Message states: the compare card page's message layout (`app/card/compare/[a]/[b]/page.tsx:194-211`): heading K6, the sentence, the links; no image, no buttons.

**Metadata** (card and plate states): `title: { absolute: K1 }`; description K2 (or the plate's sentence); `robots: { index: false, follow: true }`; `alternates.canonical` = `og:url` = the page's own absolute URL, bare or with `?season=` for a real past season (only one order of a scheduled pair survives the 307, so there is no compare-style split); `openGraph: { title: K1b, description, url, type: "website", images: [{ url, width: 1200, height: 630, alt: K7 }] }`; `twitter: { card: "summary_large_image", title: K1b, description, images: [url] }`. The image URL always carries `season` and, when known, `w`. K1b has no season and no site name so X's label stays short.

### 8.2 Share block on the matchup page

`app/matchup/[away]/[home]/MatchupShare.tsx`, `"use client"`. It is `components/compare/CompareShare.tsx` (`:33-105`) with three differences: its strings come from `matchup-links.ts` (K12); the failed-copy state is `bg-slate-600`, not `bg-red-700` (on matchup pages red has one job, CLAUDE.md line 38); the heading is K12's. Props `{ shareUrl, cardHref, downloadHref }`, all built by the server page: Copy Link copies the share page's absolute URL (never `window.location`), Download opens the image route with `download=1`, "Open share card →" is a `next/link` with `prefetch={false}` (compare spec §17 item 12 COST-1). It imports React, `next/link` and `matchup-links.ts` only.

**Where:** in `app/matchup/[away]/[home]/page.tsx`'s ready branch, after `{header}` and the no-games notes (`:220-223`) and before the tabs wrapper (`:224`): under the team header, above the two possession tabs, in normal flow (`mt-4`), one row on desktop and stacked on a phone. It does not change with the tab (one card per game). Nothing is `fixed`, `sticky` or absolutely positioned; it pushes the tabs down by its own height and covers nothing.

**When:** exactly when the share page is a card: `load.state === "ready"`, `load.gamesAvailable`, and `buildMatchupCard(...).kind === "card"`. Keyed by `cardHref` so "Copied!" never carries to another pair.

### 8.3 The matchup page's own link preview

`generateMetadata` (`page.tsx:98-127`) keeps its title, description, canonical and robots rule and adds, when `load.gamesAvailable`: `openGraph.images` and `twitter: { card: "summary_large_image", title, description, images }` with `matchupCardImageHref(away.id, home.id, load.season, { week })`. In the plate states that URL draws the plate, never a broken image. With `gamesAvailable: false` no image is named (the image would be a 503), which is today's behaviour. `?ball=home` previews the same card. `og:url` and the canonical stay the matchup page's own.

### 8.4 Sitemap, robots, revalidate

- Share pages: `noindex, follow`, not in the sitemap (F16). No matchup pair is added either.
- `app/robots.ts` is not touched. **Never disallow `/card/matchup/` or `/api/matchup-card/`:** X's and Facebook's preview fetchers obey robots.txt and every shared link would lose its picture.
- `/api/revalidate`: no change (F15). It does not clear the in-process memo (a minute) or the CDN's copy of an image (up to an hour per URL): the cards' accepted behaviour. A new week is a new `&w=` URL.

## 9. Copy (constants and functions in `lib/stats/matchup-card.ts` unless noted; each has a test on its literal text; there is no K13, the numbering skips it)

| ID | Where | Text |
|---|---|---|
| K1 | share page `<title>`, absolute | `{Away name} at {Home name}: Matchup Card {season} — Yards Per Pass` (`vs` when the pair has no game) |
| K1b | `og:title`, `twitter:title` | `{Away name} at {Home name}` / `… vs …` |
| K2 | share page description | `{AWAY} offense over the {HOME} defense and {HOME} offense over the {AWAY} defense, by league rank through Week {w}: the rate and the rank for seven stats.` (the week clause dropped when unknown) |
| K3 | sub-band left | game: `{gameWeekLabel} · {formatKickoff} · {season} through Week {w}` (empty parts dropped) · no game: `No {season} game between these teams · {season} through Week {w}` · week unknown: `… · {season} season` |
| K4 | sub-band middle | `Each label: the stat · its league rank · farther out = better rank` |
| K5 | image footer; share page | `Solid line, round dots = offense. Dashed line, squares = defense. Outer ring = 1st of {teamsPlayed}, {amber/grey} dotted ring = middle of the league.` The word follows `colours.ring`. `{teamsPlayed}` is `model.teamsPlayed` (the mockup's fixed "32" is false until every team has played). 907 px at 15 px. |
| K6 | share page `<h1>` | `{Away name} at {Home name}: matchup card, {season}` |
| K7 | image alt | `{Away name} at {Home name} matchup card, {season}` |
| K8 | share page, per team not in its primary | `{Team name} are drawn in their second colour on this card so the two teams never share one.` (`a darker shade of their colour` when `…From` is `primary-darkened`) |
| K9 | share page links | `See the full matchup →` · `{Team name} team page →` |
| K10 | 404 title, absolute | `Matchup Card Not Found — Yards Per Pass` |
| K11 | share page, games unavailable | `The matchup card is unavailable right now. Try again in a few minutes.` |
| K12 | Share block (`matchup-links.ts`) | `Share this matchup` · `Copy Link` · `Copied!` · `Download Image` · `Open share card →` · `Copy failed: open the share card and copy its address` |
| K14 | image 503 body | `Matchup card image temporarily unavailable. Try again in a few minutes.` |
| K15 | pane legend | `{ID} offense` · `over` · `{ID} defense` |
| K16 | seam | `AT` / `VS` |

"Turnovers" and "Sacks" are printed as on the mockup; the offense line is the rate it gives up and the defense line the rate it takes. The image says nothing more; the share page's M6 line does.

## 10. Tests

CI does not run vitest: run it locally before each merge, with the repo as the working directory.

**PR 1**

- `__tests__/stats/matchup-colours.test.ts`
  - Building blocks: Lab of `#FFFFFF` (100, 0, 0), `#000000`, a known mid colour to 2 dp; distance symmetric and 0 for equal colours; `readableOnWhite` at the 3.0 edge; `darkenToReadable`: LA `#FFA300` → `#CC8200`, KC `#FFB81C` → `#BF8A15`, PIT `#FFB612` → `#BF890E`, NO `#D3BC8D` → `#9E8D6A`, a readable colour unchanged, pure white ends at a readable grey, never NaN.
  - `coloursAlike`, one case per branch and its edge: BUF/LA primaries (distance 3.0); two navies (both dark); KC red / TB orange and royal / powder blue (family); a grey against anything (no hue test); 39.9 / 40.0.
  - **The table test: all 32 × 31 = 992 ordered pairs.** For each: both colours are `#RRGGBB` and readable on white; `coloursAlike(away, home)` is false; `homeFrom` is never `grey` or `ink`; `closest` is `false`; the ring is amber or grey, and at least 30 from both colours; `awayRule` / `homeRule` is the team's colour not in use. Then the 21 named pairs of §5.5, literal hexes. Then the whole table against the golden `__tests__/stats/fixtures/matchup-card-colours.expected.json`, written by `docs/superpowers/specs/matchup-card-reference/colour_ref.py` (`py -3 -I colour_ref.py lib/data/teams.ts <out>`; sha256 of today's output `ce10dda1…b747`). Never re-captured to make a test pass; a team colour change in `teams.ts` is the one legitimate reason, and the test says so.
  - Totals as a tripwire: primary 548, away gave way 71, amber 637.
  - Junk in: `""`, `"#FFF"`, `null`, `undefined`, `"red"`, `"#GGGGGG"` for any one, two, three or all four of the colours: no throw; both outputs are `#RRGGBB` and readable on white; both rule colours are `#RRGGBB`; a second call gives the same answer. **"Not alike" is NOT asserted here** (step 5 may return an alike pair, §5.3); it is asserted only over the 992 real pairs. Two literals pinned: all four junk → `#0F172A` / `#64748B`, `homeFrom: "grey"`, `closest: false`; DAL away with both home colours junk → `#041E42` / `#64748B`, `homeFrom: "grey"`, `closest: true`. Also: `darkenToReadable` of each junk value is `null`; a lower-case input (`"#00338d"`) gives the same answer as its upper-case form; a team whose two colours are the same string does not loop.
  - Purity: the file imports nothing from `lib/data`, React or Next.
- `__tests__/stats/matchup-card.test.ts`
  - URL helpers: `parseMatchupImageQuery` over every href the page can print (round trip through `rawQueryOf`), and `w=0`, `w=23`, `w=05`, repeated keys, another order, an unknown key, `?&`; the download file name; `matchupCardHref` bare / `?season=`.
  - `buildMatchupCard` from the committed rows `__tests__/stats/fixtures/team-game-stats-2026-w1-3.json` put through `buildMatchup` (`matchup-2026-w1-3.expected.json` is an expected-output file, not rows). The `MatchupLoad` around the model (`game`, `records`, `gamesAvailable`, `swap`, `season`, `defaultSeason`, `isLatestSeason`, the lineup fields) is built by hand in the test: no fixture holds a schedule. Every label line equals `fmtRadarPct` + `spokeRankLabel` of the model's own spoke; pane 0 is the away ball; a team's colour is the same in both panes; vertices equal `radarPoint(…, radarRadius(plottableScore))`; a missing spoke has no vertex and a `—` line; a tied rank prints `T-`; one pane undrawn → that pane's sentence; neither → plate; `small-pool` and `uncovered` → plate with the page's own sentence; `AT` / `VS`; a played game's K3; a playoff game drops K4; every K string.
  - **Geometry pin:** the seven boxes of §6.4 to 0.1; no two boxes intersect (per pane, and pane 0's against pane 1's with the 601 px offset); no box touches the outer ring polygon (corner-in-polygon and edge crossings) and each is ≥ 9 px from it; every box inside its pane; every box's card bottom ≤ `MATCHUP_CARD_KEEP_CLEAR_Y`; `MATCHUP_CARD_KEEP_CLEAR_Y` is 510 and equals band + rule + sub-band + body; heights sum to 630.
  - **Text fit at real glyph widths:** a small test helper (`__tests__/og/helpers/font-advance.ts`, about 35 lines: cmap format 4 + `hmtx`, the code of `measure.mjs`) reads the two font files the image registers. Asserted with 6 px to spare: `100.0% · T-32nd` + mark in the narrowest side box and in the top box; "Explosive pass" at 14 px; every one of the 32 upper-cased team names at its `nameSize` in 520 px; the widest regular-season K3 + K4 + the site name in 1,120; K5 in 1,120; Press Start 2P's advance is one em for A-Z, 0-9 and space.
  - **Glyph coverage** (the same helper reads the cmap): glyph id ≠ 0 for every character of every string the image can print, each in the family it is set in. Noto Sans: K3 in all its forms (every `gameWeekLabel` round name, a `formatKickoff` with a date, a time and a final score, the no-game form), K4, K5 with both ring words, K15, the three plate sentences (`MATCHUP_SMALL_POOL_NOTE`, both `matchupUncoveredHeading` forms, `MATCHUP_NO_OVERLAY_NOTE`), `matchupNoGamesNote` for all 32 team names, the seven spoke names, `fmtRadarPct` and `spokeRankLabel` output for 0, 1, a mid value, every rank 1-32 tied and not, and `—`, records with and without ` · away` / ` · home`. Press Start 2P: K16, both site lines, the 32 upper-cased names. And the reverse guard: the set of non-ASCII characters across all of those is exactly `·`, `—`, `’`.
- `__tests__/stats/matchup-links.test.ts`: still imports nothing; the new path and strings.
- `MatchupHeader.test.tsx` passes untouched (F6).

**PR 2**

- `__tests__/og/matchup-card-image.test.tsx` (the compare image test's shape, `__tests__/og/compare-card-image.test.tsx`): plain elements only; every `div` flex; inside svg only `path` / `line` / `circle`; no `NaN` / `undefined` / `null` in any `d`, coordinate or text; block heights; the band halves' colours, names, sizes, text colours and rule colours; seam `AT` / `VS`; **a colour allow-list over the whole element tree** (every `color`, `backgroundColor`, border colour, `fill` and `stroke`): each is one of the file's fixed neutrals (white, ink `#0F172A`, `#475569`, `#64748B`, `#94A3B8`, `#E2E8F0`, `#EEF2F7`, `#F8FAFC`), `colours.away`, `colours.home`, `colours.awayRule`, `colours.homeRule`, `colours.ring`, or a card colour with the `14` / `22` tint suffix, and nothing else; run for BUF at LA, TB at DAL, KC vs TB and **ARI at TB** (TB is drawn in orange there and its rule is its own primary `#D50A0A` while neither card colour is red: a team's own colour, allowed; a search for the single hex would wrongly fail it, as it would for ATL at TB); no line joining an offense vertex to a defense vertex (no gap bar); defense outline dashed and first, offense solid and after; markers are paths, dots circles; the middle ring's colour is `colours.ring` and K5's word matches it; labels are divs, 7 per pane, at the model's boxes; label text is ink and each mark is its unit's colour; each label is a 60 px column of three rows of height 18 / 21 / 21; the pane sentence; **the plate's five blocks** (§7: band, rule and seam as the card's; the sub-band with the season text only and no K4; one message block of 397 with the sentence and no svg; a 120 px footer with the site line and no K5; heights sum to 630), for `small-pool`, `uncovered` and neither-pane-drawn; fonts shared, no font read in this file. **No PNG checksum:** neither live card pins the bytes (they pin the element tree), and the bytes change with next/og.
- `__tests__/app/matchup-card-image-route.test.ts`: every row of §4.2 with its status and exact `cache-control`; no read for rows 1-3 (mocks' call counts); 20 requests in an outage = one read; exactly one lowercase `cache-control`; `download=1` header only on a card; the plate is never an attachment; `runtime` / `revalidate` exports; two different pairs add no memo key (`matchupMemoKeys`, `compareCardMemoKeys`).
- `__tests__/app/matchup-card-page.test.tsx`: §4.1 rows (404 with no read, 308 target and that it uses `permanentRedirect`, 307 target and `redirect`, unlisted season = newest with a bare canonical); the image element's `src` equals `og:image`; buttons' hrefs; **the tables:** exactly 2 tables × 7 body rows in the card state, in document order after the image and the buttons and before the rank note; each caption is `{OFF} offense over {DEF} defense`; every cell equals `model.panes[i].labels[j].offLine` / `defLine` (and so the image's label text: one assertion walks the image's element tree and the page for the same model and compares the 28 strings); a missing spoke's cell is `—`; one pane undrawn → one table and that pane's sentence; no `<table>` in any message state; no class on the tables' markup matches `red-\d00` or `overflow-`; the explanatory lines; K8 for BUF at LA and absent for TB at DAL; each message state; metadata (absolute title, `noindex`, canonical = `og:url`, image with `season` and `w`, `NEXT_PUBLIC_SITE_URL`); a failed core read rejects from page and metadata; `/card/matchup` and `/card/matchup/BUF` 404 with no read; the folder has no `loading` / `not-found` / `opengraph-image` file.
- `__tests__/app/matchup-route.test.tsx`: **the "no preview image" test at `:452-457` is rewritten on purpose** (its two `undefined` assertions are `:454-455`); this is the ONLY existing test in that file that changes. The mock factory at `:30` and the five 308 tests at `:162-192` are untouched and still run the real `listedMatchupSeason` (it lives in `lib/data/matchup-season.ts`, which the file does not mock). The rewritten test: now the image URL for a ready pair, a plate URL for small-pool, and still undefined when `gamesAvailable` is false. Lines 111-115 (no `opengraph-image` under `app/matchup/`) stay as they are and stay true. New: the Share block is present exactly in the card state, sits between the header and the tabs in document order, and its three URLs.
- `__tests__/components/matchup/guards.test.ts`: `:187-189` unchanged (still exactly two client files in `components/matchup/`); `MatchupShare.tsx` is added to `PAGES` (`:17`, so the no-`fixed`, no-overflow and no-red rules cover it) and to the `it.each` reach list (`:191`); a new line: the client files under `app/matchup/` are exactly `error.tsx` (an error boundary has to be one) and `MatchupShare.tsx`.
- `MatchupShare.test.tsx`: Copy Link copies `shareUrl`; "Copied!" only on success; both fallback branches; the failure text and that its class is not red; `prefetch={false}`.
- A bundle walk: no `"use client"` file reaches `matchup-card.ts` or `matchup-colours.ts`.

**Chaos pass** (after PR 2, before review): null / `"NaN"` / missing columns in rows; 0 rows, 1 team, 7 teams (`small-pool`), 8 teams; a team with no games (one pane sentence); both with no games (plate); every spoke missing on one side; exactly 3 and 4 real spokes; all 32 tied on a spoke (`T-1st` × 14); a rate of exactly 0 and exactly 1 (`0.0%`, `100.0%`); rejected rates (outside 0-1); a 1,000-row answer; duplicate `(game_id, team_id)`; games read failing / empty / junk rows; a game with no date, no time, no weekday; a stale unplayed row; a playoff game; a played game with a 3-digit score; division rivals (both orders, no redirect); every invalid URL of §4 on both routes including `%00`, 300-character segments, `ſf`, `BUF/BUF`, `buf/la`, `?season=2025&season=2024`, `?w=5` alone, `?download=1&season=2026`; a team colour that is not a hex; 200 different pairs in a row (no new memo key, no read after the first); the image and page hit together cold.

Before each merge, as separate commands: `tsc --noEmit`, `next lint`, vitest, pytest, the placeholder build.

## 11. Rendering check and rollout

**Local PNGs.** next/og's loader fails on Windows (CLAUDE.md line 34), so the image route's success path cannot run under `next dev` here, and the share page's picture will show as broken locally. Render through a patched scratch copy of the bundled `@vercel/og` (never edit `node_modules`). Both earlier harnesses still exist and work the same way (`og-patched.mjs` + `render.mjs`): session scratchpad `8c6c07a2-…/scratchpad/compare-card/render-pr2/` and `…/team-radar/review-pr3-render/`. Render and look at, at full size and scaled to 360 px wide:

BUF at LA (twin blues; grey ring) · TB at DAL (played: final score) · LAC at KC · KC vs TB (no game; away gave way) · WAS at JAX (21- and 20-character names) · PIT at NO and BAL at PIT (darkened gold, near-black) · GB at PHI (the closest pair, 40.3: dark green beside silver) · CIN at MIA and BAL at NO (the grey ring nearest a team colour, 30-34) · CLE at DAL (amber ring beside brown and silver) · a synthetic worst case (every line `100.0% · T-32nd`) · one pane undrawn · the three plates · a playoff sub-band · the no-fonts fallback. Compare each real pair with its `shots/card-C2-*.png`.

**Pixel-scan gate (a merge gate for PR 2; a script, not an eye; its numbers are written into "As built").** On the Satori PNG of the synthetic worst case and of BUF at LA, a script decodes the PNG and asserts: (a) inside the body, the lowest row between y = 480 and y = 510 that holds any non-white pixel is ≤ 507; (b) at y ≥ 510 nothing is drawn but the footer's background, its top border and its two right-aligned lines: every pixel with x < 250 and y > 511 is the footer background `#F8FAFC`. If (a) fails, the fix is a smaller radar (r 110, table of §6.4 re-derived), never a label under the line.

**The share page under `next dev` on Windows** shows a broken picture (the loader bug above); its two tables carry the same 28 strings, so the numbers can be reviewed locally without the patched renderer.

**Vercel preview (the final check for any image change):** both font files readable inside the new function (else `experimental.outputFileTracingIncludes` for the route; snippet in the team radar spec §15 item 19); `&download=1`; a `?season=` link; the 308 and 307 as real status codes; response headers of each row of §4.2 with `curl -I`.

**One real post on X, on a phone, before the Share block is announced:** the title label must sit under y = 510 on the picture. If it reaches the bottom labels, the fix is a smaller radar (r 110), not moving labels under the line.

| PR | Contains | Safe alone because | Verify |
|---|---|---|---|
| 1 | colour rule, card model, layout numbers, copy, link helpers, `matchupNoGameText` move, golden, reference scripts, tests | nothing imports the new modules yet; the header's output is byte-identical | vitest; `/matchup/BUF/LA` on local dev looks as it does live |
| 2 | image module and route, share page and its two 404 stubs, `MatchupShare`, matchup page metadata, docs and memory | additive; the matchup page gains one block and two meta tags | the local PNG list; Vercel preview; chaos pass; then the X post |

## 12. Cost on Vercel Hobby

- **Each distinct valid image URL is one function run and one render** (hundreds of milliseconds of CPU). What bounds it, as on the other cards: junk never renders and is stored by the CDN (rows 1-3 of §4.2); a drawn image is stored for an hour per URL (`s-maxage=3600`); the query has one spelling; the memos mean a render costs no database request while warm.
- **URL space:** 992 ordered pairs × seasons × (`w` absent or 1-22) × (`download` or not): about 45,000 per season at the very most, about 1/20 of the compare card's 850,000. A week's real traffic is the 15 or so scheduled pairs.
- **Database:** 0 requests warm. A cold image instance pays `loadMatchup`'s 8 (two waves, about 10 s at the read limit), of which the card uses 4 (seasons, rows, games; the slug list and three player tables are read and unused). Accepted for v1: one loader, no second code path. If cold image starts prove slow, the follow-up is an option on `loadMatchup` to skip the lineup reads, not a second loader.
- **The share page and the matchup page are dynamic:** one function run per view, as today. The page's `<img>` is the same URL as `og:image`, so it is served from the CDN's copy.
- **Prefetch is off** on every link into a card or matchup page (`prefetch={false}`): the Share block's "Open share card", the share page's links back. Neither route folder may gain a `loading.tsx` (a prefetch would then render up to it).
- **The matchup page now names an image**, so each crawler visit to a matchup URL can cause one image render per hour per URL. That is every pair in every listed season, most of them `noindex`; the unscheduled pairs are reachable only through the picker, so crawler reach is small. If image renders show up in Vercel usage, the first lever is to name the image only for indexable pairs (`ready` with a game).
- **Optional owner step** (compare spec §12): if a Vercel Firewall rate-limit rule exists or is added, it should also cover `/api/matchup-card/` and `/card/matchup/`. Not robots.txt (§8.4).
- No `maxDuration` is set anywhere in the repo and the plan's function limit is still unrecorded (matchup spec item 22): unchanged, and worth the one look in Vercel → Settings → Functions.

## 13. Docs and memory to update (PR 2, end of session rule)

- This spec: an "As built" section per PR.
- `docs/superpowers/specs/2026-10-10-team-matchup-design.md`: an amendment line at `:30` and `:243` and at S19 pointing here ("superseded by the matchup card spec: the page now names the card as its preview image and has a Share block").
- `.claude/CLAUDE.md`: line 33 (three client files on the matchup routes: the toggle, the picker, and `app/matchup/[away]/[home]/MatchupShare.tsx`; `matchup-links.ts` now also holds the card path and the Share words; `lib/stats/matchup-card.ts` and `matchup-colours.ts` are server-side pure modules no client file may reach); line 34 (a fourth image route handler, same rules); line 38 (the Share block uses no red; no `loading.tsx` under `app/card/matchup/` either).
- `memory/MEMORY.md`: a "Matchup card" block: routes and status table in one paragraph, the colour rule's constants and the "never re-capture the golden" rule, keep-clear 510 with half a pixel of margin, the ring floor of 30, the 503 for unavailable games, what is still to confirm live.
- User-facing docs: none exist for cards; the glossary is not touched.

## 14. Where the code or the measurements contradict the mockup or the decisions

1. **The matchup spec and a test say "no image".** `2026-10-10-team-matchup-design.md:30,243` and `matchup-route.test.tsx:452-457`. Superseded here, edited on purpose in PR 2.
2. **Darkened colours shift by one shade on some channels.** The mockup's script subtracted 0.05 repeatedly in floating point and rounded half-to-even; the spec uses whole twentieths, half up. 155 of the 992 pairs differ from the mockup's `team-colours.json`, each by 1 on one or two channels (PIT's gold: mockup `#BF880D`, spec `#BF890E`). The two colours visible in the approved mockup, LA `#CC8200` and KC `#BF8A15`, are unchanged, and so is which colour every team gets.
3. **The ring rule as built had a hole, and threshold 40 does not carry over to it.** As built (and at 30), three pairs (CLE at DAL, IND, LV) drew the grey ring beside a silver team 11-13 away from that grey. Applying 40 to the ring is impossible with any neutral (107 pairs would have no ring colour). Settled in §5.4: very dark colours are not "close to amber", and the ring has its own floor of 30 from both team colours. Amber 637 pairs, grey 355.
4. **The sub-band does not fit its own worst case.** A playoff round with a final score is 606 px; with the "Each label…" sentence and the site name that is 1,198 px in 1,120. Settled in §6.3: the sentence is left out for a playoff game.
5. **The top label's 240 px box overlaps its two neighbours' boxes.** The mockup's check measured text, not boxes. Settled in §6.4: 180 px.
6. **The mockup's radius is `(32 − rank) / 31`; the page's is per-spoke pool** (F7). The card follows the page. Identical once all 32 teams have every spoke.
7. **"Outer ring = 1st of 32" is hard-coded in the mockup.** K5 prints `teamsPlayed`.
8. **The mockup's ranks came from the ladder cells**, which can read "T-27th of 31"; the card prints the radar's form, without "of N" (F8).
9. **The mockup's label content was 60.2 px in a 60 px box** with half a pixel of keep-clear margin. The name line is fixed at 18 px (§6.4).
10. **Decision "a played game prints its final score as the matchup page header does":** confirmed in code (F5); nothing to change.
11. **Decision "pairs with no game show VS":** the code's test is `load.game !== null`, which is also false when the games read failed (F3). The image answers 503 there, so a failed read can never produce a stored "VS" card for a scheduled game.
12. **Notes.md says the Share block is "the Compare page's Share block as it is".** It cannot be that file: its failed state is red, and matchup pages reserve red (guards test `:126-130`). Same block, own file, slate failure state (§8.2).
13. **The share page shows the PNG; the two live card pages redraw their card in HTML** "so it reads on a phone" (`app/card/compare/[a]/[b]/page.tsx:4-5`). **Closed in revision 2 (review finding 1, decided for the owner): the PNG plus a readable table.** The chart is not redrawn (a second two-colour chart could drift from the picture, and the matchup page's own chart cannot be it: F9); under the picture and its buttons the page prints the 14 lines as two plain HTML tables built from the same model (§8.1 item 4), so the numbers read on a phone. A cold share-page view causes one image render.

**Decided:** the ring's floor of 30 instead of 40 (item 3) and the "Each label…" sentence left out for playoff games (item 4) were accepted by spec review 1; item 13 is closed as above. No design question is open.

## 15. Risks

| Risk | Handling |
|---|---|
| The rule passes and the eye disagrees | The render list in §11 names the closest pairs (GB at PHI / LV 40.3, CAR at DAL 40.9, CLE at NYJ 40.9, NO at NYJ 41.1) and the tightest ring cases. Solid + dots against dashed + squares still separates the units in grey. |
| X's label is taller than estimated | 510 instead of 546; a real post on a phone before the block is announced |
| Half a pixel of keep-clear margin | The geometry pin test derives from the constants; §6.4 says what must be re-derived |
| A team is one colour on the page and another on the card | Stated to the owner (§5.6); K8 says so on the share page |
| Fans expect gold for PIT / NO, not darkened gold or black | Decided ("silver/gold fallbacks as built"); K8 covers the share page |
| Satori draws something differently from Chrome (opacity, dashes, 8-digit hex, wrapping) | Only constructs the two live images already use; local PNGs, then a Vercel preview |
| Font files not traced into the new function | Same loader and literal paths as the two live routes; the `outputFileTracingIncludes` snippet is ready |
| Kerning: Satori's line widths differ from summed advances | Every fit has 25+ px of real slack except K3 + K4 (25 px between items) and the tests ask for 6 |
| A degraded matchup page view now has no preview image | Same as today; the next view has it |
| The image is up to an hour behind the page after a same-week correction | Accepted, as for both live cards |
| The share page's picture is a broken image under `next dev` on Windows | Known loader bug; documented in §11 |
| `teams.ts` colours change | The golden and 21 named pairs fail loudly; re-run the reference script and look at the affected cards |

## 16. Non-goals

No per-side cards (`?ball=` means nothing on the card). No change to the matchup page's colours, chart, ladder or tabs. No new font and no font download. No new table, column, read or DDL; `scripts/ingest.py` untouched. No headshots or logos. No HTML redraw of the CHART on the share page (the 14 lines are repeated as a plain table, §8.1). No signed image URLs. Nothing about accessibility.

## 17. As built (PR 1)

Built 2026-10-10 on branch `feat/matchup-card-logic` from `origin/main` `111e721`, test-first (each implementation commit follows a commit of its failing tests). Nothing imports the two new modules yet, and the matchup header's output is unchanged: no visible change.

**Files.** New: `lib/stats/matchup-colours.ts`, `lib/stats/matchup-card.ts`, `__tests__/stats/matchup-colours.test.ts` (60 tests), `__tests__/stats/matchup-card.test.ts` (108), `__tests__/og/helpers/font-advance.ts`, the golden `__tests__/stats/fixtures/matchup-card-colours.expected.json`, `docs/superpowers/specs/matchup-card-reference/colour_ref.py` and `measure.mjs`, this spec. Changed: `lib/stats/matchup-links.ts` (+ `matchupCardPath`, `matchupCardHref`, the six K12 strings; still imports nothing), `lib/stats/matchup.ts` (+ `matchupNoGameText`, nothing else), `components/matchup/MatchupHeader.tsx` (imports it), `__tests__/stats/matchup-links.test.ts` (+ 7 tests; the 57 existing ones untouched), `.claude/CLAUDE.md`, `memory/MEMORY.md`. No existing golden or pinned test was edited; `MatchupHeader.test.tsx` passes untouched.

**Checks.** vitest 3166 tests / 115 files → 3341 / 117; `tsc --noEmit` clean; `next lint` clean (the four old warnings); placeholder-env `next build` green; pytest 824 passed, 20 skipped, 1 xfailed (unchanged). The golden was written by the committed `colour_ref.py` before the first test run and hashes to `ce10dda1dd1dd78ef502cfa31682c99460df9c40986116a1c64e6697db07b747`; the TypeScript equalled it on the first run. A test holds that hash (computed with CRLF read as LF, because git checks the file out with CRLF here).

**Differences from the text above, and decisions the text left open:**

1. **This file's name** is `2026-10-11-matchup-card-design.md`, not `2026-10-10-…` (line 4 corrected). The two stale `:452-453` references (F1, §14 item 1) now read `:452-457` (review 2, builder note 1).
2. **`measure.mjs` is the scratch script with its two font paths made relative to the repo root** (they were absolute session paths); run it as `node docs/superpowers/specs/matchup-card-reference/measure.mjs` from the repo root. `colour_ref.py` is committed byte for byte.
3. **`buildMatchupCard`'s `load` is typed `MatchupCardLoad`**, declared in `matchup-card.ts`: the eight fields of `MatchupLoad` the builder reads (`state`, `model`, `season`, `defaultSeason`, `game`, `records`, `gamesAvailable`, `firstSeason`). `MatchupLoad` is assignable to it (a test holds that), so callers pass the loader's answer as it is, and the module imports nothing from `lib/data`, not even a type.
4. **Type names:** §6.1's `BandHalf` / `Pane` / `SpokeLabel` are exported as `MatchupCardBandHalf` / `MatchupCardPane` / `MatchupCardSpokeLabel`; a vertex is `{ key, x, y }` (`MatchupCardVertex`), `key` being the spoke it sits on, so a drawing can tell which spokes are bridged. `labOf` returns `{ L, a, b }`.
5. **K6 and K7 say "vs" for a pair with no game**, as K1 and K1b do (§9 writes them with "at" only). A card whose seam says VS should not have a heading and alt text that say "at".
6. **K8 returns `null` for `grey` and `ink`** as well as for `primary`: the neutrals are no team's colour, no real pair uses them, and §9 has no sentence for them.
7. **The plate model has no sub-line field** (as §6.1's type); the plate's sub-band text is `matchupCardSeasonLine(season, throughWeek)`, exported for PR 2. A plate's `description` is its sentence.
8. **A plate for a load that should not happen:** `gamesAvailable: false` → K11 (as §6.1); a `ready` load with no model → K11; a `ready` load whose model is `small-pool` → the small-pool sentence. The builder never throws.
9. **`parseMatchupImageQuery` is `parseCompareImageQuery`, exactly** (§4.2 row 3). So `?w=5` and `?download=1` with no season are accepted as the newest season, as on the compare route (`canonicalImageQuery` can spell them); the page never prints either. §10's chaos list names "`?w=5` alone" among the invalid URLs: with this parser it is a valid one. Left as the spec's stated implementation; PR 2's route test should pin whichever answer is wanted.
10. **`matchupCardImageHref` does not encode its two ids** (the compare card's helper does not either); callers pass validated upper-case ids. `matchupCardPath` / `matchupCardHref` do encode them, like `matchupHref`. The download file name keeps letters only, three at most, upper-cased.
11. **Layout constants beyond §6.3's table:** `MATCHUP_CARD_PANE_TOP` (147 = band + rule + sub-band + legend row), `MATCHUP_CARD_LABEL_BOXES` (the seven boxes), `MATCHUP_CARD_SITE_NAME` (`YARDSPERPASS.COM`), and in `MATCHUP_CARD_LAYOUT` the widths the drawing needs (`half` 600, `padX` 40, `nameBox`, `seam`, `subLineMaxWidth` 500 / `subLineMaxWidthAlone` 900, `paneMessageWidth` 460, `plateMessageWidth` 900, the label's `rows` / sizes / mark). Fixed colours, paddings, stroke widths and dash patterns are the image file's (PR 2).
12. **Measured, as the tests hold them:** nearest label box to the outer ring 9.75 px (Sacks and Run success); top box to its neighbours 8.5 px; lowest box bottom 509.52 on the card (0.48 px above 510); `100.0% · T-32nd` 126.3 px at 17; K3 worst regular-season 477.7, K4 432.0, the site name 160, K5 907.3 (it starts at x = 252.7); the playoff K3 605.7.
13. **Not built here, by §10's own split:** the bundle walk ("no `"use client"` file reaches `matchup-card.ts` or `matchup-colours.ts`") is listed under PR 2 and belongs with the first client file that could reach them (`MatchupShare.tsx`). Today nothing imports either module.
14. **Junk colours, pinned beyond §10's two literals:** a team that is not an object at all is two unusable colours; a junk primary with a light secondary is ink and its rule is ink (review 2, builder note 3: step 1 does not darken the secondary); a junk primary with a readable secondary takes the secondary, and its rule is that same colour.
