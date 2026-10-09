# Comparison share card — design spec (revision 3)

Date: 2026-10-09 · Status: revision 3, **approved with changes R1–R4 by the re-review, all four applied here** · PR 1 and PR 1b merged; PR 2 built on branch `compare-card-pr2` (§14-§16) · Repo state read: `origin/main`
Mockup: `compare-card-mockup.html` (session scratchpad, not in the repo; Jon approved it 2026-10-09: "looks great, keep going").
Reference numbers: `docs/superpowers/specs/compare-card-reference/` (`extract.py`, `build_data.py`, `crosscheck.py`, `te_check.py`, `rev2_measure.py`). `build_data.py` runs from the repo: it reads the three season tables from `__tests__/stats/fixtures/compare-2026-w4-rows.json` and writes the expected file to the path it is given (it reproduces `compare-pool-all.expected.json` byte for byte, checked 2026-10-09). The others are a record of checks against saved live pages that are not committed; each says at its top what it needs.

### Review changes applied (revision 2 → 3)

| Finding | What changed | Where |
|---|---|---|
| **R1** PR 1 would break its own pin | In PR 1 `ComparisonTool` turns the mask back into NaN before calling the chart, so the chart's props are what they are today. PR 1b switches to the mask props and replaces the **radar half** of the pin only; the table half stays byte-identical. `__tests__/components/OverlayRadarChart.test.tsx` is listed under PR 1b | §6.3, §9, §10 |
| **R2** slug index order | `getPlayerSlugIndex` passes `{ order: ["slug"] }` to `fetchAllRows` | §6.1 |
| **R3** C4z with both pools short | Wording for a WR-vs-TE pair whose two pools are both short, with a test | §8 C4z, §10 |
| **R4** C4z is a state Jon has not seen | Named in the PR 1b note to Jon, next to the radar change | §11 |

### Review changes applied (revision 1 → 2)

| Finding | What changed | Where |
|---|---|---|
| **C1** pool B is the design | Rewritten throughout with the stat card's pools as the only design. `buildComparison` takes the whole season table and ranks each player in his own pool, through pool functions exported from `tecmo-card.ts` that the card builders also call. Settled: WR vs TE, which position picks the pool, a player under the line, pools of 0 or 1, "radar only", the two sentences `/compare` gains, the two existing sentences re-checked, what the rule is not, goldens, the direct tie test | §2 F1, §3, §6.2–6.4, §8 C4 / C4z / C6, §10, §11 |
| **I1** PR 1's pin | Own commit on the unmodified component; capturing mock; cells, winner class, header colours; both data paths with `null` and `"NaN"`; the `stuff_avoidance` quirk pinned | §10 PR 1 |
| **I2** image route reads | Zero per-pair reads: memoised slug list + memoised tables keyed `(group, season)`; page and `/compare` metadata use two `getPlayerBySlug` calls; `getPlayersBySlugs` dropped; season before player lookup; unknown slug = `no-store` 404; empty slug list = 503; `w` 1–22; risk row rewritten with the Vercel rule text and why signed URLs are not in v1 | §4, §6.1, §12 |
| **I3** `og:url` | The page's own order-preserving URL; canonical differs on purpose | §4, §5 |
| **I4** C6 does not fit | One full-width line (36–1164), each player pluralised separately, measured; OVR "—" for a player under the line | §3, §8 C6, §10 |
| **M1** NaN across the boundary | Values + a `missing` mask; no NaN leaves the server. `OverlayRadarChart` gets two optional mask props | §6.3, §9 |
| **M2** doubled site name | C1 and C15 are `title: { absolute }` | §8 |
| **M3** 34+ character names | Fixed 430 px box, `nowrap`, `overflow: hidden`; tests at 34, an apostrophe name, "AMON-RA ST. BROWN" | §3, §10 |
| **M4** right table header | B's header is right-aligned to the table edge; each header capped at 240 px | §3 |
| **M5** identical short names | C6 and the headers use full names when the two short names are equal | §8 C6, C9 |
| **M6** `/compare` season rule | Metadata uses the body's season; pair image only for a season in `data_freshness`; test with `season=1998`; cache note | §7 |
| **M7** site origin | Share URL built on the server from `NEXT_PUBLIC_SITE_URL` with the apex fallback | §7 |
| **M8** `noindex` + canonical | Stated that the canonical only matters if indexing is switched on, and must never be copied into `og:url` | §4 |
| **M9** stale reason | Archetypes are off the card for space, not for a technical reason | §3 |
| **M10** two legends | `OverlayRadarChart`'s own line is reworded to C5 (PR 1b); the share page shows it once | §8 C5 |
| **M11** file name and headers | Built from the validated slugs only; every header key lowercase on every response; one-header test | §4 |

## 1. The request and the decisions

Jon posted two player cards in one X post; X cropped both. He said yes to **one image with both players side by side, shareable from the Compare page.**

What ships: a 1200×630 image, a share page that carries it as its link preview, Share buttons on `/compare`, `/compare?p1=&p2=` links that preview the same image, and (first) the Compare page's radar moved to the stat card's pools.

Decisions, binding. The session's `decisions.md` (2026-10-09) is not in the repo, so its text is copied here in full:

> **Comparison card — Jon's decisions (2026-10-09)**
>
> Jon reviewed the clickable mockup (https://claude.ai/artifact/T2ef6PkrNgn7VCZz2vh6Ad) and said: "looks great, keep going".
> He did not answer the individual questions, so the controller takes every recommendation in the spec:
> - J1: keep the order picked on Compare (A left/solid, B right/dashed); A-vs-B and B-vs-A are two mirrored links.
> - J2: B — switch the Compare page AND the card to the stat card's pools (qualified players, same position), as its own small PR (1b) before the card ships, so a player has one radar shape everywhere. This changes what /compare shows today; say so plainly in the PR and tell Jon when it ships.
> - J3: comparison share pages are noindex.
> - J4: show each player's OVR on the card.
> - J5: no headshots in the first version.
> - J6: a pasted /compare?p1=&p2= link shows the comparison image (PR 3); canonical stays bare /compare.

The same decisions as this spec uses them:

| # | Decision |
|---|---|
| J1 | Order is kept: first player left / solid, second right / dashed. A-vs-B and B-vs-A are two mirrored links. |
| J2 | **B.** The Compare page and the card rank each player against the stat card's pool (qualified players at his position). Own PR (1b), before the card ships. This changes what `/compare` shows today: the PR text says so and Jon is told when it ships. |
| J3 | Share pages are `noindex`. |
| J4 | Each player's OVR is on the card. |
| J5 | No headshots in the first version. |
| J6 | A pasted `/compare?p1=&p2=` link previews the comparison image; the canonical stays bare `/compare`. |

Pattern followed: the team radar share cards (`2026-10-06-team-radar-design.md` §15) and the read resilience rules (`2026-10-06-read-resilience-design.md`).

## 2. What the code says today

| # | Finding | Consequence |
|---|---|---|
| F1 | **Before PR 1b** `/compare` ranks each radar axis against every row of the position's season table (`ComparisonTool.tsx` `sortedPools`): all 49 QBs, all 97 RBs, all 362 receiver rows (172 WR + 97 TE + 93 RB). The stat card (`lib/stats/tecmo-card.ts`) ranks against qualified players only, and for receivers against the row's own position. So a player has two radar shapes on the site (Lamb's aDOT: 69th on Compare, 36th on his card). | PR 1b moves Compare to the stat card's rule (§6.2). The card never exists with the old pool. |
| F2 | The stat card plots a missing QB / RB axis at the centre (`computeRadarValues`, 0) and leaves a gap for WR / TE (`radarMissing`). Compare does the same today. | Kept: values and mask come from the same calls the card builders make. |
| F3 | All 362 receiver rows have `yards_per_route_run = null` for 2026. | Every 2026 WR / TE comparison has a 5-point radar with a grey YPRR label. |
| F4 | `ensureContrast`, the palette and the three `*_COMP_STATS` tables live inside a `"use client"` component. | PR 1 moves them, unchanged, to a pure module. |
| F5 | `ensureContrast` only moves colour 2. A light primary (PIT, NO) is drawn on white as is. | The card passes each colour through `radarStrokeColor` first. `/compare` gets the same in PR 3. |
| F6 | Player 2's search is filtered to player 1's exact position (`player_slugs.position`), but `/compare?p1=<WR>&p2=<TE>` renders (same table). | Comparable = same table group: QB · WR/TE · RB/FB. A WR-vs-TE pair is ranked per player (§6.2). |
| F7 | With both players chosen and one without a row, `/compare` renders nothing and says nothing. | PR 3 adds C10. |
| F8 | Colours and team chips on `/compare` come from `player_slugs.current_team_id`, also for past seasons. | The card uses the season row's `team_id`; `/compare` too from PR 3. |
| F9 | Season rows carry no week. | One new loader returns seasons and weeks in one read. |
| F10 | Stat rows use short names (`J.Allen`); `player_slugs.player_name` is the full name. | Band = full name; table headers = short name. |
| F11 | All 1,310 live slugs match `^[a-z0-9]+(-[a-z0-9]+)*$`, which is exactly what `make_slug` and its three collision suffixes can emit. None is `compare` or `team`. | The share URL accepts exactly that shape. |
| F12 | `getRBRadarVal(…, "stuff_avoidance")` returns 1 (best) for a parsed `null` `stuff_rate` (`isNaN(null)` is false) and NaN for the raw string `"NaN"`. The stat card shares the function. No 2026 RB row has a null `stuff_rate`. | Known quirk: pinned in PR 1, not fixed here (fixing it would move stat cards). |

## 3. The card (1200×630)

> **As built, read §16 and §16b first.** The layout numbers below are the first design's: the keep-clear line is y = 546 (not 522), the bottom band 84 px, the radar is radius 140 at centre y 311, and the legend sits under the radar, above the line (§16 items 1-2, §16b item 6).

Every block is a flex `div`; the radar is `<svg>` with `<path>`, `<line>`, `<circle>` only (Satori rules, as `lib/og/team-radar-image.tsx`).

| y | Block | Content |
|---|---|---|
| 0–92 | **Band**, two halves | Left = player A on A's plot colour; right = player B on B's, mirrored. Full name in Press Start 2P inside a fixed 430 px box (`whiteSpace: nowrap`, `overflow: hidden`): 20 px up to 21 characters, 16 px up to 26, 13 px beyond (fits 33; a longer name is cut at the box, never under the badge). Then `QB · Buffalo Bills · 4 games` (position = the season row's). Text colour from `textColorForBackground`. Navy `VS` block on the seam. **OVR badge** per half (J4): the stat card's number, or "—" when it is `null` (a player under the line). The band is the legend: the half's colour is that player's outline colour. |
| 92–96 | Rule | `#0f172a` |
| 96–128 | Sub-band | Left, 15 px: C3 · C4, e.g. `2026 season · Through Week 4 · Radar: percentile among the 42 qualified quarterbacks (14+ pass attempts a game).`. Right: `YARDSPERPASS.COM` in the pixel font. |
| 128–494 | **Body** | Left 590 px: overlay radar, centre (295, 325), radius 132; A solid on top, B dashed; amber dashed ring at the 50th percentile; labels are positioned `div`s, 17 px, grey when both players are missing that axis. If either player's pool has fewer than 2 players: no radar, C4z in the pane (§6.2). Right: table, 7 rows × 46 px (ends y 493). Header: A = line sample + short name from the table's left edge; B = short name + dashed sample **right-aligned to the table's right edge (x 1176)**; each capped at 240 px (`M.Valdes-Scantling` is 142). |
| 497–520 | **C6 line** | Only when a player is under the line. One line, 13 px, centred, running the full width 36–1164 (worst case measured 1,057 px of 1,128). The lowest radar label ends near y 490. |
| 522–630 | **Footer strip** | Left: C5. Right: `YARDSPERPASS.COM · DATA: NFLVERSE`. Nothing here is needed to read the card. |

**X label keep-clear strip.** X draws the link's title in a dark pill over the bottom-left of the image. The pill is a fixed size on screen, so on a phone it is about a sixth of the picture's height and, with two long names, most of its width. Rule: **nothing essential below y = 522, at any x** (`COMPARE_CARD_KEEP_CLEAR_Y`). The preview title (C1b) has no season and no site name, to keep the pill short. A unit test checks that no axis label, table row, band text, sub-band text or the C6 line reaches below the line. The pill's real size is an estimate until PR 2's live check.

**Better value.** Green pill (`#dcfce7`, text `#166534`); no bold (the image has one weight). Rule = `/compare`'s: higher wins unless `higherBetter` is false; a tie or a missing value highlights neither.

**Rows on the card** (keys of `/compare`'s tables, same label, same formatter object):

| Group | Rows |
|---|---|
| QB | Pass Yds · Pass TD · INT · EPA/DB · CPOE · ANY/A · FPts |
| WR / TE | Targets · Receptions · Yards · TDs · EPA/Tgt · CROE · FPts (PPR) |
| RB / FB | Carries · Rush Yds · Rush TD · YPC · EPA/Car · Success% · FPts (PPR) |

**Not on the card, for space:** archetypes, percentile numbers on the spokes, table sub-lines. Headshots: J5.

**Colours.** `comparePlotColors(teamA, teamB)`: each team's `radarStrokeColor(primary, secondary)`, then `ensureContrast` unchanged. Allen (BUF `#00338D`) vs Stafford (LA `#003594`) are nearly the same blue (distance 13, threshold 150), so B becomes `#dc2626`. Solid / dashed always differs too.

## 4. URLs and validation

> **As built, read §16b first.** The share page no longer makes two `getPlayerBySlug` calls: page, metadata and image share one loader that reads nothing per slug (§16b items 1 and 10). The image query must also be SPELLED as the page prints it (§16b item 3).

**Share page:** `/card/compare/[a]/[b]` · **Image:** `/api/compare-card/[a]/[b]`

- **Order is kept** (J1). Both orders are valid and mirrored. No redirect.
- **`og:url` = the page's own URL, order kept**, with `?season=` by the site rule (bare for the newest season). Facebook and LinkedIn re-scrape `og:url`; if it named the other order a shared "Stafford vs Allen" link would preview as "Allen vs Stafford".
- **Canonical = the alphabetical order.** It differs from `og:url` on purpose. Every share page is `noindex, follow` (J3), so the canonical does nothing today; it only matters if indexing is ever switched on (then the surface is one page per pair, not two). Nobody should "fix" the difference by pointing `og:url` at the canonical. A test covers a non-alphabetical pair.
- `app/card/compare/page.tsx` and `app/card/compare/[a]/page.tsx` only call `notFound()` with no read. Two route tests.
- Not in the sitemap.

**Image route, in order.** Header keys are lowercase on every response (`cache-control`, `content-disposition`, `retry-after`, `content-type`); a test asserts exactly one `cache-control`. "Stored" = `public, max-age=0, s-maxage=3600`.

| # | Check | Answer when it fails | Database |
|---|---|---|---|
| 1 | Both slugs match `^[a-z0-9]+(-[a-z0-9]+)*$`, 1–100 characters; `a !== b` | 404, stored | none |
| 2 | Query is the exact form: nothing, or `season` (4 digits, 1999–2100), `w` (**1–22**), `download=1`, once each, no other key (`parseCompareImageQuery` = `parseRadarImageQuery` plus the `w` range) | 404, stored | none |
| 3 | Seasons + weeks (memo) | read fails, or the list is empty on a real database: 503 `no-store`, `retry-after: 60`, body C14 | memo |
| 4 | Season is in the list (absent = newest) | 404 `no-store` (it may exist after the next refresh) | none |
| 5 | Slug list (memo) | read fails, or **0 rows on a real database**: 503 `no-store`. Either slug not in the list: **404 `no-store`** (a rookie gets his row at the next refresh) | memo |
| 6 | Same group, and the group has a stat table (QB · WR/TE · RB/FB; `player_slugs.position`, FB → RB) | 404, stored (it can never be a card) | none |
| 7 | Season table (memo, key `(group, season)`) | read fails, or 0 rows for a listed season: 503 `no-store` | memo |
| 8 | Both players have a row | plate image with C10, stored, never an attachment | none |
| 9 | — | PNG, stored. `download=1` adds `content-disposition: attachment; filename="<a>-vs-<b>-<season>.png"`, built from the two validated slugs and the validated season only |  |

`w` is accepted for any week 1–22, never tied to the current week: the page (cached up to an hour) and the image memo (a minute) can be a week apart, and a link the page itself printed must never get a stored 404.

**Share page, in order.** (1) slug shape and `a !== b`: `notFound()`, no read. (2) `?season=`: absent or not a number = newest; outside 1999–2100 = `notFound()`, no read (`resolveRadarCardSeason`). (3) one wave: `getSeasonWeeks()` ∥ `getPlayerBySlug(a)` ∥ `getPlayerBySlug(b)`; any failure throws. (4) season not listed, a slug unknown, or not comparable: `notFound()`. (5) the season table; failure or 0 rows throws. (6) card, or the C10 message page.

Different groups are a 404, not a message: no button produces that URL and it can never be a card. A real pair with no stats yet gets a message (Jon's standing "add messages" decision).

## 5. Behaviour: states × surfaces

| State | Share page | `generateMetadata` | Image route | `/compare` |
|---|---|---|---|---|
| ready | card (HTML: band with OVR, `OverlayRadarChart`, C4, 7-row table, C6 / C7 when they apply), Copy Link, Download Image, links C12 | title C1 (`absolute`), description C2, `noindex, follow`, canonical alphabetical, `og:url` own order, `og:image` + `twitter:image` = image route with `?season=YYYY&w=N` | PNG | radar + C4 + C6 (PR 1b); Share block (PR 3) |
| too few qualified players (a pool under 2) | card with C4z in place of the radar; table, buttons | as ready | PNG with C4z in the radar pane | C4z in place of the radar; table (PR 1b) |
| no stats (A, B or both) | 200, C10, links to `/compare?p1=&p2=` and each stat card; no buttons | title C1, description C10, `noindex`, image = route (plate) | plate | C10 where nothing renders today (PR 3) |
| failed read | throws → `app/error.tsx`, real 500 | throws | 503 `no-store` | unchanged |
| unknown slug / not comparable / same player / bad season | `notFound()` | title C15 (`absolute`), `noindex` | 404 (§4) | unchanged |
| past season | that season's card; team = that row's | `?season=` kept in canonical and `og:url`; image URL names it | same | Share link carries `?season=` |

Freshness is the radar card's (spec §15 item 17): page reads up to an hour in Next's data cache, cleared by `/api/revalidate` (`revalidatePath("/card", "layout")` covers the path); image through 60 s memos and up to an hour per URL on the CDN; a new week is a new `&w=` URL.

## 6. Data

### 6.1 Reads

> **As built, read §16b first.** `getPlayerBySlug` is not used; a failed memoised read is kept ten seconds, not dropped (§16b items 1-2); "4 requests, 2 waves" below is now: seasons and the slug list started together, then the season table (§16b item 10).

| Loader | Used by | Notes |
|---|---|---|
| **new** `getSeasonWeeks()` in `lib/data/queries.ts`: `data_freshness` `select season, through_week`, newest first | page, image, `/compare` metadata | Season list and "Through Week N" from one read. Throws through `queryError`. `getAvailableSeasons` is untouched. |
| existing `getPlayerBySlug(slug)`, called twice in one wave | page, `/compare` metadata | Cache entries are per player (bounded by the slug count, shared with `/card/[slug]` and `/player/[slug]`), never per pair. On `/compare`, `p1`'s read is the same one the body already makes. |
| **new** `getPlayerSlugIndex()` in `lib/data/players.ts`: `fetchAllRows("player_slugs", "slug, player_id, player_name, position, current_team_id", {}, { order: ["slug"] })` | **image route only**, behind the memo | About 1,310 narrow rows, two pages. **Read in a fixed order (`order: ["slug"]`, the fourth argument of `fetchAllRows`):** the pages come from `range()`, and unordered pages can skip or repeat a row; a skipped row here is a real player answered 404 for a minute. A test asserts the option is passed. Returns a `Map` by slug. Throws through `queryError`. |
| existing `getQBStats` / `getReceiverStats` / `getRBSeasonStats(season)` | page, image | The loaders `/compare`'s server path and `/card/[slug]` use; rows arrive through `parseNumericFields`. |

- **Image route memos** (`memoised` from `lib/data/team-radar-card.ts`, exported; in-flight promise stored, rejection dropped, 60 s): one key for seasons, one key for the slug list, and season tables keyed `(group, season)` with the season already checked against the list. At most 2 + 3 × (seasons the site has) entries. **Nothing is keyed by slug or pair.**
- **Counts.** Image: **0 database requests while warm**; cold at most 3 loads (seasons 1 request, slug list 2, table 1). Page: seasons + two player reads in one wave, then the table (4 requests, 2 waves, about 10 s worst case: the accepted `/card` behaviour). An unknown slug on the image route costs no read.
- **Heavy?** The receiver table is `select *` over 362 rows, about 330 KB (perhaps 500 KB by Week 18): the read `/card/[slug]` and `/compare` already make, under Next's 2 MB entry limit, and held once per `(group, season)` per instance. Not narrowed: a second column list would be a second place for numbers to drift.
- **Share page:** `revalidate = 3600`; loader wrapped in React `cache()` keyed on plain values `(a, b, requestedSeason | null)` (the page's test file needs the `cache` stand-in).
- **Image route:** `runtime = "nodejs"`, `revalidate = 0`. Fonts: `radarImageFonts()` as is.

### 6.2 The pool rule (J2 = B)

**One rule, the stat card's, called, not copied.** PR 1b exports the pool step from `lib/stats/tecmo-card.ts`:

- `qbCardPool(all)` = `all.filter(qbEligible)` (attempts ÷ his own games ≥ 14)
- `rbCardPool(all)` = `all.filter(rbEligible)` (carries ÷ games ≥ 6)
- `wrCardPool(all, position)` = `all.filter((r) => r.position === position).filter(wrEligible)` (targets ÷ games ≥ 2, the row's own position)

`buildQBCardData`, `buildWRCardData` and `buildRBCardData` call these instead of their inline filters. Proof that the stat card did not move: `tecmo-card-2025-anchors.test.ts` and the `wr-te-2025-pool.json` golden pass untouched.

`buildComparison({ group, rowA, rowB, all })` takes the **whole season table** and derives each player's pool itself:

| Question | Answer |
|---|---|
| WR vs TE | Each in his own pool: the WR against qualified WRs, the TE against qualified TEs. C4 has a two-count form. |
| Which position picks the pool | The **season row's** `position`, as on the stat card. The table (group) is still picked from `player_slugs.position`, as today. They can differ (a converted player, a past season): he is then ranked, and labelled in C4 and the band, by his row's position, which is what his stat card for that season does. A receiver-table row whose position is `RB` is ranked against qualified `RB` rows of that table and C4 says "RBs"; the stat card does the same. |
| A player under the line | Ranked against the qualified pool (he is not in it), exactly like his stat card. His OVR is `null` → "—". C6 says so, on the image, the share page and `/compare`. |
| Pool of 0 or 1 (either player's) | No radar. C4z replaces it; the table still shows. With 0 the stat card's numbers are all 0 or all missing; with 1 they are only 0 or 100. From 2 up the radar is drawn; no other minimum, because the stat card applies none. |
| What 1b changes | **The radar only.** The stat table has no percentiles; a test asserts every table cell and highlight is byte-identical before and after 1b. |
| What the rule is not | Not the leaderboards' "PFR qualified" rule (14 / 6.25 / 1.875 per **team** game, 17-game cap), not the 100-dropback archetype rule, not CLAUDE.md's older "200+ routes" line, not `seasonHasRouteData`. It is never called "PFR". A player can be qualified on a leaderboard and under the line here (WR 1.875 vs 2, RB 6.25 vs 6, per team game vs per own game). |

**Sentences `/compare` gains in PR 1b:** C4 (or C4z) under the radar, and C6 under it when a player is under the line.

**Existing sentences re-checked under B:**
- Page subtitle "Compare two same-position players…": kept. It describes the pickers (player 2's search is filtered to player 1's position; an existing test covers the filter, and one is added if not). A hand-typed WR-vs-TE link is announced by C4's two-count form.
- `OverlayRadarChart`'s "outer ring = league best · dashed = 50th percentile": **reworded to C5** in PR 1b. Under B a player under the line can sit on the outer ring without being the league's best.

### 6.3 The shared function

`buildComparison` (in `lib/stats/compare.ts`, pure) returns, per player: `values: number[]` (0–100, **never NaN**), `missing: boolean[]`, `poolSize`, `poolPosition`, `eligible`; plus `axes`, `rows[]` (label, both texts, winner) and `radar: "drawn" | "too-few"`.

- QB / RB: `values = computeRadarValues(keys, get, row, pool)`; `missing` all false (a missing axis plots at the centre, F2).
- WR / TE: `values` the same call; `missing[i]` = `Number.isNaN` of `computeRadarValues(…, pool, true)[i]`. These are the two calls `buildWRCardData` makes for `radarValues` and `radarMissing`.
- Inputs: `null`, `undefined`, `NaN` and the string `"NaN"` give the same answer, with the one pinned exception F12.
- **No NaN crosses the server→client boundary.** From PR 1b `OverlayRadarChart` has two optional props, `missing1` and `missing2`; a masked axis is treated exactly as a NaN value is today. From PR 1b `ComparisonTool`, and from PR 2 the share page and the image, pass values + mask.
- **PR 1 only (R1): `ComparisonTool` turns the mask back into NaN before it calls the chart** (`values.map((v, i) => (missing[i] ? NaN : v))`). The chart has no mask props until PR 1b, and today it receives NaN for a missing WR / TE axis (every 2026 receiver pair, F3). Handing it the 0 that `values` carries would dip the outline to the centre and darken the YPRR label: a visible change, and the pin would fail. `ComparisonTool` is a client component, so this NaN never crosses the server→client boundary. PR 1b deletes the conversion when it adds the mask props.
- OVR is not part of `buildComparison`: the loader takes `buildQBCardData / buildWRCardData / buildRBCardData(row, all, season).ovr` for each player, so the badge is the stat card's number by construction.

In PR 1 the function exists with the old pool (the whole table) so that PR 1 has no visible change; PR 1b replaces only its pool step.

### 6.4 The numbers, and what proves them

`/compare` draws its radar in the browser, so nothing was captured from the live Compare page. The numbers come from `build_data.py`, a Python re-statement of the rules, run on the live season rows captured 2026-10-07 (through Week 4). Its stat-card branch (`card_pool`, now per player and per position) was checked against live stat-card pages:

- six cards on 2026-10-07 (Allen, Stafford, Lamb, Smith-Njigba, Robinson, Gibbs): 36 of 36 percentiles equal;
- the TE pool on 2026-10-09 (`te_check.py`: that day's rows against that day's `/card/trey-mcbride`): 5 of 5 equal. Note for anyone re-running `crosscheck.py`: it compares the 2026-10-07 rows with whatever card pages are in the folder, so it reports McBride as a mismatch (52 vs 50, 13 vs 14). His card page was fetched two days after the rows, after a Thursday game changed the TE pool; `te_check.py` is the valid same-day check for him.

**Radar percentiles under the design (pool B), 2026 through Week 4:**

| Pair | Pool | A | B |
|---|---|---|---|
| Josh Allen vs Matthew Stafford — EPA/DB, CPOE, DB/Game, aDOT, Ball Security, Success%, Rush EPA | 42 qualified QBs | 83.3, 81.0, 42.9, 88.1, 35.7, 42.9, 97.6 | 45.2, 31.0, 88.1, 83.3, 16.7, 47.6, 9.8 |
| CeeDee Lamb vs Jaxon Smith-Njigba — Tgt/Game, EPA/Tgt, CROE, aDOT, YAC/Rec, YPRR | 129 qualified WRs | 97.7, 89.9, 88.4, 36.4, 59.4, — | 95.3, 86.0, 86.8, 31.0, 63.3, — |
| Bijan Robinson vs Jahmyr Gibbs — Car/Game, EPA/Car, Stuff Avoid, Explosive%, Tgt/Game, Success% | 54 qualified RBs | 92.6, 96.3, 87.0, 74.1, 83.3, 96.3 | 90.7, 64.8, 13.0, 85.2, 98.1, 90.7 |
| *fixture only* Trey McBride vs Sam LaPorta | 56 qualified TEs | 96.4, 50.0, 50.0, 41.1, 14.3, — | 92.9, 80.4, 51.8, 48.2, 42.9, — |
| *fixture only* CeeDee Lamb vs Trey McBride | 129 WRs / 56 TEs | 97.7, 89.9, 88.4, 36.4, 59.4, — | 96.4, 50.0, 50.0, 41.1, 14.3, — |

OVR (from the stat cards): Allen 91, Stafford 76, Lamb 97, Smith-Njigba 96, Robinson 96, Gibbs 85.

Card rows (unchanged by the pool; A · stat · B, ✓ = highlighted):

- QB: 1039 · Pass Yds · **1189✓** | 6 · Pass TD · 6 | **3✓** · INT · 6 | **0.29✓** · EPA/DB · 0.05 | **+6.0✓** · CPOE · -0.1 | **7.61✓** · ANY/A · 5.94 | **112.9✓** · FPts · 62.2
- WR: **46✓** · Targets · 42 | **37✓** · Receptions · 32 | **498✓** · Yards · 481 | 4 · TDs · **6✓** | **0.88✓** · EPA/Tgt · 0.77 | **+15.1%✓** · CROE · +13.7% | 110.8 · FPts (PPR) · **116.1✓**
- RB: **85✓** · Carries · 80 | **494✓** · Rush Yds · 353 | 4 · Rush TD · **5✓** | **5.8✓** · YPC · 4.4 | **0.13✓** · EPA/Car · -0.02 | **54.1%✓** · Success% · 47.5% | 105.4 · FPts (PPR) · **116.1✓**

**Goldens.**
- PR 1: `compare-pool-all.expected.json` (the old pool; `build_data.py`'s `a` / `b` arrays) pins "no visible change".
- PR 1b: that file is **deleted with the old code path, not edited**, and replaced by `compare-card-pool.expected.json` (the `altA` / `altB` arrays, five pairs including the TE pair and the mixed pair). Never re-captured to make a test pass.
- The direct tie, no Python involved: for every fixture player, `buildComparison(...).values` equals `buildXCardData(row, all, season).radarValues` and `.missing` equals `radarMissing ?? all false`.

## 7. Entry points

**Share block on `/compare`** (PR 3), only when both players have rows and differ; under the radar, above the table: "Share this comparison" · **Copy Link** · **Download Image** · "Open share card →".

- The server builds the absolute share URL from `NEXT_PUBLIC_SITE_URL` with the `https://yardsperpass.com` fallback (as every other absolute URL on the site) and hands it to the client block; `?season=` only for a non-default season, using a new server-computed `defaultSeason` prop.

**`/compare`'s own link preview** (J6, PR 3). `app/compare/page.tsx` swaps static `metadata` for `generateMetadata({ searchParams })`:

- Season = the body's own rule for `?season=` (the page still uses bare `parseInt`; the metadata must resolve the same number). The pair image is emitted **only when that season is in `data_freshness`**; otherwise today's static metadata (`/compare?p1=&p2=&season=1998` is a test).
- `p1` and `p2` both pass the slug shape and differ → `getSeasonWeeks()` + two `getPlayerBySlug` calls (`p1`'s is the read the body already makes) → both exist and are comparable: title C18, `og:title` / `twitter:title` C1b, `og:url` = the pair URL itself, `og:image` + `twitter:image` = the image route (`season` + `w`).
- `<link rel="canonical">` stays bare `/compare`.
- Anything else → static metadata. A failed metadata read → static metadata plus `console.error` (a read that may degrade: "Player Comparison" is true, not a guess).
- `/compare` exports no `revalidate`, so these reads stay in the data cache until `/api/revalidate` runs (it calls `revalidatePath("/compare")`); the `w` in the preview URL is only as fresh as that. A pair with no stats previews the plate, never a broken image.

## 8. Copy (constants in `lib/stats/compare.ts`; each has a test)

| ID | Where | Text | Test |
|---|---|---|---|
| C1 | share page `<title>`, `absolute` | `{A} vs {B} — {season} — Yards Per Pass` | rendered once: no doubled site name |
| C1b | `og:title`, `twitter:title` | `{A} vs {B}` | no season, no site name |
| C2 | description | `{A} ({POS}, {TEAM}) vs {B} ({POS}, {TEAM}), {season} through Week {w}: overlaid radar and head-to-head stats.` | position and team from the season rows; week clause dropped when unknown |
| C3 | sub-band | `{season} season · Through Week {w}` | `w` from `getSeasonWeeks`; without it `{season} season` |
| C4 | sub-band (image), under the radar (share page, `/compare`) | QB: `Radar: percentile among the {N} qualified quarterbacks (14+ pass attempts a game).` · RB: `… the {N} qualified running backs (6+ carries a game)` · same position: `… the {N} qualified WRs (2+ targets a game)` (`TEs`, `RBs`) · two positions: `Radar: each player against qualified players at his position (2+ targets a game): {n} WRs, {m} TEs` | `N` = that pool's length; thresholds read from the `tecmo-card.ts` constants; position words from the rows; widest form measured 915 px of 952 · **as built (PR 1b):** every form ends with a full stop (as written above only the QB form shows it), and quarterbacks are counted in "pass attempts", the same words as C6 |
| C4z | in place of the radar | `Not enough qualified {quarterbacks / running backs / WRs / TEs} to draw the radar ({14+ pass attempts / 6+ carries / 2+ targets} a game).` For a two-position pair: the position whose pool is short; **when both pools are short, both positions are named in the pair's order, joined by "or"**: `Not enough qualified WRs or TEs to draw the radar (2+ targets a game).` (`TEs or WRs` when the TE is player A). One sentence, never two. | shown at pool sizes 0 and 1, not at 2; a WR-vs-TE pair with only the WR pool short, only the TE pool short, and both short (both orders); in that state the sub-band prints C3 only and C4 is not rendered anywhere (so "the 1 qualified quarterbacks" can never appear) **No "yet" (as built, PR 1b):** `/compare` does not know whether the season shown is the newest one, and a past season can never fill up. Position words come from a closed list (quarterbacks, running backs; receiver table: WRs, TEs, RBs, FBs, QBs); any other position value prints as "receivers". |
| C4m | `/compare`: under the radar when one player is not drawn; in place of the radar when neither is (added in PR 1b after the chaos pass) | `No outline for {X}: {k} of his {n} radar stats are not available.` One sentence per player. `{X}` by the C6 name rule. | shown exactly when half his radar axes or more are missing (3 of 6, 4 of 7): the stat card chart's own rule, one shared function `radarHasTooFewAxes` in `lib/stats/radar.ts`; at 2 of 6 he is drawn; the other player's outline still draws; both → no radar, no C4, no legend |
| C5 | image footer; `OverlayRadarChart`'s legend line (so once on the share page and on `/compare`) | `Farther out = higher percentile · dashed ring = 50th percentile` | ring at half the radius; a larger value never plots closer in; the old "league best" string is gone from the chart |
| C6 | one line: image y 497–520, under the radar on the share page and on `/compare` | one player: `Small sample: {X} has {n} {unit} in {g} {game/games} (under {T} a game).` · both: `Small sample: {X} has {n} {unit} in {g} {game/games}; {Y} has {n} {unit} in {g} {game/games} (under {T} a game).` · image and share page append ` OVR hidden.` · `{unit}` and `{game/games}` are pluralised per player (`1 pass attempt`, `1 target`, `1 carry`, `1 game`) · `{X}` = short name, or the **full name for both when the two short names are equal** | shown exactly when `qbEligible` / `wrEligible` / `rbEligible` is false, at 13.9 and 14.0; every singular; equal short names; the longest form fits 1,128 px at 13 px (measured 1,057 with two 24-character full names) · **as built (PR 1b):** shown in the too-few state as well; a numeric string is read as its number; a player whose count or games is not a finite number of 0 or more is left out of the line (never a made-up 0); a missing full name falls back to the short name, then a name made from the slug, then "Player 1" / "Player 2"; a player with 0 games is left out too (never "in 0 games") |
| C7 | share page, under the radar | `{Axis} is not available for {season}.` | when both masks are true; label grey; no corner there |
| C8 | image footer; sub-band short form | `YARDSPERPASS.COM · DATA: NFLVERSE` / `YARDSPERPASS.COM` | reuses `RADAR_CARD_SITE_LINE` |
| C9 | table header | `STAT` between the two short names (full names when the short names are equal) | |
| C10 | share page message, plate, `/compare` | newest season, one: `{Name} has no {season} stats yet, so there is nothing to compare. Comparisons update the day after each game.` · both: `{A} and {B} have no {season} stats yet, …` · past season: `{Name} has no stats for the {season} season, so there is nothing to compare.` (both: `{A} and {B} have no stats…`) | one per branch |
| C12 | share page links | `See the full comparison →` · `{A} stat card →` · `{B} stat card →` | hrefs carry the season by the `playerHref` rule |
| C13 | buttons | `Copy Link` / `Copied!` / `Download Image`. Share page failure: `Copy failed: use the address bar`. `/compare` failure: `Copy failed: open the share card and copy its address` | "Copied!" only when the clipboard took it |
| C13b | `/compare` | `Share this comparison` · `Open share card →` | |
| C14 | image 503 body | `Comparison image temporarily unavailable. Try again in a few minutes.` | 503, `no-store` |
| C15 | 404 title, `absolute` | `Comparison Not Found — Yards Per Pass` | no doubled site name |
| C16 | image alt | `{A} vs {B} comparison card, {season}` | |
| C18 | `/compare` pair `<title>` | `{A} vs {B} — Player Comparison` (the layout template adds the site name) | only when both exist and are comparable |

## 9. Files

**New:** `lib/stats/compare.ts` (pure: the moved `colorDistance`, `CONTRAST_PALETTE`, `MIN_DISTANCE`, `ensureContrast`, `*_COMP_STATS`, `getStatVal`; new `compareGroup`, `buildComparison`, `CARD_STAT_KEYS`, `comparePlotColors`, `compareCardState`, `parseCompareSlugs`, `parseCompareImageQuery`, `compareCardHref`, `compareImageHref`, `compareDownloadFilename`, geometry constants, copy) · `lib/data/compare-card.ts` (`loadCompareCard`, the memoised readers; server-only) · `lib/og/compare-card-image.tsx` · `app/card/compare/[a]/[b]/page.tsx` + `CompareCardActions.tsx` · `app/card/compare/page.tsx`, `app/card/compare/[a]/page.tsx` (404 only) · `app/api/compare-card/[a]/[b]/route.tsx` · `components/compare/CompareShare.tsx` · tests, fixtures, `docs/superpowers/specs/compare-card-reference/`.

**Changed:**
- `components/compare/ComparisonTool.tsx` — PR 1: reads from `lib/stats/compare.ts`, mask turned back into NaN for the chart (R1). PR 1b: C4 / C4z / C6, mask props (the NaN conversion goes). PR 3: Share block, C10, `comparePlotColors`, season-row team, `defaultSeason`.
- `components/compare/OverlayRadarChart.tsx` — **not touched in PR 1.** PR 1b: optional `missing1` / `missing2`; legend line = C5.
- `__tests__/components/OverlayRadarChart.test.tsx` — PR 1b (it asserts the "league best" sentence today; it changes with the chart, not before).
- `__tests__/components/ComparisonTool.pin.test.tsx` and its expected file — PR 1b replaces the radar half only (§10).
- `lib/stats/tecmo-card.ts` — PR 1b: the three exported pool functions, called by the three builders. Nothing else.
- `app/compare/page.tsx` — PR 3. `lib/data/queries.ts` (+`getSeasonWeeks`), `lib/data/players.ts` (+`getPlayerSlugIndex`), `lib/data/team-radar-card.ts` (export `memoised`) — PR 2.
- `.claude/CLAUDE.md`, `memory/MEMORY.md` after each PR.

Not changed: `lib/og/tecmo-card-image.tsx`, `app/card/[slug]/*`, `components/qb/RadarChart.tsx` (the stat card's own legend line), `lib/stats/radar.ts`, `scripts/ingest.py`, the database, the sitemap, `/api/revalidate`.

## 10. Tests

**PR 1 — pin, then move.**
1. **Commit 1 is the pin alone**, and it passes on the unmodified component. Commit 2 moves the code; the pin file is byte-identical in commit 2.
2. The pin replaces `OverlayRadarChart` with a **capturing mock** (the existing test file mocks it to `null`) and saves every prop: `values1`, `values2`, `color1`, `color2`, `name1`, `name2`, `axes`. It also saves every table cell's text, which cells carry `bg-green-50`, and the two header colours.
3. **Both data paths**: rows handed in by the server (through `parseNumericFields`; a missing number is `null`) and rows from the browser's lazy read (raw; a missing number can be the string `"NaN"`). Each path has at least one row with a missing value in its form, for the three fixture pairs.
4. F12 pinned as it is: a parsed `null` `stuff_rate` plots as best, the raw string `"NaN"` as 0.
5. Golden: `buildComparison` (old pool) equals `compare-pool-all.expected.json`. `ensureContrast` table: BUF/LA → `#dc2626`, DAL/SEA → `#dc2626`, ATL/DET unchanged. The module imports nothing from `lib/data` beyond `teams`.
6. **The pinned chart props are today's (R1):** NaN where today's code produces NaN (a missing WR / TE axis), 0 where it produces 0 (a missing QB / RB axis). In PR 1 `ComparisonTool` rebuilds those NaNs from the mask, so the pin passes unchanged; `OverlayRadarChart.tsx` and its test are not in PR 1's diff.

**PR 1b — the pool.**
- **The pin splits in two (R1).** The radar half (`values1`, `values2`, and the new `missing1` / `missing2` props) is replaced: new numbers, new prop shape, no NaN. The table half (every cell's text, the `bg-green-50` cells, the two header colours) and the chart's colours, names and axes stay **byte-identical**; the diff of the expected file shows only radar lines.
- `__tests__/components/OverlayRadarChart.test.tsx` is updated here: the "league best" sentence becomes C5, and the mask props get their tests.
- The 2025 anchors and `wr-te-2025-pool.json` pass untouched.
- `compare-pool-all.expected.json` deleted; `compare-card-pool.expected.json` (five pairs) passes.
- The direct tie (§6.4) for every fixture player, including a TE and a player under the line.
- A WR-vs-TE pair: each side's values equal his own stat card's; C4's two counts.
- A player under the line at 13.9 / 14.0 attempts a game: ranked, C6 shown / not shown, on `/compare`.
- Pool sizes 0, 1, 2 (C4z, C4z, drawn). A WR-vs-TE pair: only the WR pool short, only the TE pool short, **both short** (C4z names both, in the pair's order, R3).
- **Every table cell and highlight is byte-identical to PR 1's pin** (radar only).
- `null` / `undefined` / `NaN` / `"NaN"` give one answer (except F12); no NaN in `values`; the chart treats a mask like a NaN value; arrays compared with `Object.is`.
- The chart no longer contains "league best"; C5 is rendered once.

**PR 2.**
- Pure: `compareCardState` per §4 row; `compareGroup` (FB → RB, TE with WR, K → none); slug parsing (upper case, dots, 101 characters, `a === b`); `parseCompareImageQuery` (`w=0`, `w=23`, `w=5`, repeated keys, unknown key); `CARD_STAT_KEYS` ⊂ `*_COMP_STATS` with the same formatter objects; every copy row.
- Geometry: nothing essential below 522; names of 21, 26, 33 and 34 characters, "D'ANDRE SWIFT", "AMON-RA ST. BROWN" stay inside the 430 px box; B's header right-aligned with `M.Valdes-Scantling`; C6's longest form inside 36–1164; 6- and 7-axis labels inside the pane; OVR badge "—" when `ovr` is `null`.
- Reads counted. Image: 0 warm; a bad slug, same player, junk query, `w=23`: 0 and no memo touched; unknown slug: 0 warm and `no-store`; season not listed: seasons only; empty slug list: 503. Memo keys: only `seasons`, `slugs`, `(group, season)`; two different pairs in one group and season add no key. Page: seasons + 2 player reads + table.
- Failures: a rejected read → page and metadata throw; image 503 `no-store` with one lowercase `cache-control`. Empty table for a listed season → the same.
- Image: `download=1` header and file name; plate never an attachment; `runtime` and `revalidate` exports; no `opengraph-image.tsx` in the folder. Element tree: every `div` flex; only `path` / `line` / `circle` in `<svg>`; B dashed; a masked axis has no corner and a grey label; pills; no `NaN` in any `d`.
- Page: titles `absolute`; image URL carries `season` and `w`; canonical alphabetical and `og:url` own order for a non-alphabetical pair; `noindex`; `/card/compare` and `/card/compare/x` are 404 with no read.
- **Equality:** `ComparisonTool` and the share page from one fixture: each card row equals the Compare table's cells; both radars get the same values and masks.

**PR 3.** Share block only with two rows; share URL built from `NEXT_PUBLIC_SITE_URL`; hrefs bare this season, `?season=` for 2025; C10 on `/compare`; `/compare` metadata for a pair, one player, `season=1998`, a failed read (static, logged); canonical still bare.

**Chaos pass** after PR 1b, PR 2 and PR 3: null / `"NaN"` / missing fields, pools of 0 / 1 / 1000+, D'Andre Swift, Amon-Ra St. Brown, a traded player, a 1-game rookie, a player listed at two positions (Taysom Hill), a `player_slugs` position that differs from the row's, FB vs RB, TE vs WR, a K, both players missing, one missing, `season=1998`, repeated `season`, `%00` and 300-character slugs.

Before each merge, as separate commands: `tsc --noEmit`, `next lint`, vitest, pytest, build. CI does not run vitest.

## 11. Rollout

| PR | Contains | Safe alone because | Verify |
|---|---|---|---|
| 1 — shared maths | pin commit; `lib/stats/compare.ts`; `ComparisonTool` reads from it; fixtures; old-pool golden; reference scripts | No visible change; the pin proves it | `/compare?p1=josh-allen&p2=matthew-stafford` on local dev looks as it does live |
| 1b — Compare uses the stat card's pools | pool functions exported from `tecmo-card.ts` and used by its builders; `buildComparison`'s pool step; C4 / C4z / C6 on `/compare`; chart legend = C5; mask props; new golden, old one deleted | **Radar only**: the stat table is byte-identical. The PR text says plainly that the Compare radar changes for every pair, and Jon is told when it ships. **The note to Jon names three things (R4):** (1) every Compare radar changes shape, to match the stat cards; (2) a new sentence he has not seen in the mockup, C4z ("Not enough qualified quarterbacks to draw the radar (14+ pass attempts a game)."), which replaces the radar when fewer than 2 players at a position qualify, so only in the first days of a season; (3) a second new sentence, C4m ("No outline for X: 3 of his 6 radar stats are not available."), for a receiver or tight end with half his radar stats or more missing, whose outline is then left out as on his stat card | Allen's Compare radar equals his stat card's (83 / 81 / 43 / 88 / 36 / 43 / 98 on the Week 4 data); a WR-vs-TE link; a backup QB shows C6 |
| 2 — card | loaders, share page, image route, 404 stubs, metadata | Nothing links to it yet | Vercel preview: the three pairs; missing YPRR; `dorian-thompson-robinson`; a PIT or NO player; a backup (OVR "—", C6); `&download=1`; `?season=2025`; the font log line. Then **post one link on X** and compare the pill with the keep-clear strip on a phone and a computer |
| 3 — entry points | Share block, C10, colours and season team on `/compare`, pair metadata | Additive; canonical unchanged | Paste a `/compare?p1=&p2=` link into X's composer: one uncropped image **Gate before PR 3 ships (code review I2):** a real X post of a share link, viewed on a PHONE, must show the small-sample line (y 518-546 on the picture) clear of X's title label. The kept-clear band was cut to 84 px without a live measurement, and §3's own estimate of the label on a phone is about a sixth of the height (to about y 525). If the label reaches the line: give the 24 px back (`footer: 108`, `body: 366`, radar radius 128) or move the small-sample line into the legend slot. **X-on-a-phone gate PASSED 2026-10-09 — Jon posted /card/compare/josh-allen/matthew-stafford on X; the title label sits inside the 84 px band on desktop (screenshot) and he confirmed the same on his phone.** |

Gate met: revision 2 was re-reviewed on 2026-10-09 (APPROVED WITH CHANGES, R1–R4, no further round needed); revision 3 applies them. Memory and CLAUDE.md after each PR.

## 12. Risks

| Risk | Handling |
|---|---|
| **Image URL space.** About 1,310 slugs give roughly **850,000 valid ordered same-group pairs**, each also valid per season, per `w` 1–22 and with `download=1`. After §6.1 the database is out of the picture (zero reads warm), but **every distinct valid URL is still one function invocation and one render** (hundreds of milliseconds of CPU), and the CDN only protects repeats of the same URL. A crawler that walks pairs can burn the Vercel plan's function allowance. `/api/stat-card` has about 1,310 URLs per season; this route is hundreds of times larger. | **Residual risk accepted for v1**, watched on the function-usage graph. Two real bounds exist: **(a) a Vercel firewall rate limit, optional, Jon can add it in two minutes:** Vercel → project → Firewall → add a custom rule, and type into the rule box: *"Rate limit requests whose path starts with /api/compare-card/ to 120 requests per 60 seconds per IP address. When the limit is exceeded, respond with 429."* (Check that the plan allows a rate-limit rule. 120 a minute leaves room for X's and Facebook's preview fetchers, which come from few addresses; a 429 to one of them is a missing preview image, so do not set it much lower.) **(b) signed image URLs**, rejected for v1: they need a secret in Vercel, rotating it breaks every link already posted, and the share page (which must print valid signatures) can be walked just as easily, so it stops guessing of image URLs only. |
| X's pill is larger than estimated | Keep-clear line is a constant with a test; PR 2 ends with a live post before PR 3 advertises the feature |
| next/og does not render on Windows | Element-tree tests; the scratch-copy method (radar §15 item 19); Vercel preview is the final check |
| Font files not traced into the new function | Same loading code as the radar route; `outputFileTracingIncludes` snippet ready |
| PR 1b moves every Compare radar | Decided (J2). Stat cards proven unmoved by their own goldens; table proven unmoved by the pin |
| Early weeks: few qualified players | C4z under 2; from 2 up the radar is as coarse as the stat card's own |
| Image and page disagree up to an hour after a same-week correction | Accepted, as for the radar card |
| A slug list a minute old | A brand-new player's image is a `no-store` 404 for up to a minute after his row appears |
| A Next 15 upgrade streams metadata for some user agents | Check X and Facebook crawlers still get `og:image` in the first HTML |
| Position table over 1,000 rows | `getReceiverStats` and `getQBStats` do not paginate; 362 and 49 rows today. Flagged, not changed |

## 13. What the mockup shows and what it does not

- Real: every stat, percentile (the stat card's pools), OVR, games count, team and colour for the three pairs, from the live site on 2026-10-07 (through Week 4). YPRR is genuinely missing for 2026.
- The card is drawn in the browser with Inter; the real image uses Noto Sans regular (one weight, slightly wider). Pixel text is the same Press Start 2P.
- The X title pill is an estimate (13 px text, 12 px from the corner) at a phone-width and a computer-width preview.
- Colours use `ensureContrast` only; none of the three pairs has a light team colour.
- Section D's small-sample example is a real 2026 player under the line (T.Huntley 9 pass attempts in 1 game; O.Zaccheaus 7 targets in 4 games; G.Holani 22 carries in 4 games); his OVR shows "—" by the stat card's rule. The other two message boxes are example wording.
- The yellow bar's switches (pair, keep-clear outline) are mockup controls; the pool and OVR switches were removed once J2 and J4 were decided. Buttons do not copy or download. No headshots (J5).

## 14. As built (PR 1, 2026-10-09, branch `compare-card-pr1`)

Where the code differs from, or is narrower than, the text above:

1. **`buildComparison` also takes `teamA` and `teamB`** (team ids) and returns each player's colour: `{ group, axes, a: { values, missing, color }, b: { values, missing, color }, rows }`, each row `{ key, label, a, b, winner }`. The colours are today's rule (`getTeamColor` of `player_slugs.current_team_id`, then `ensureContrast`), because the pin covers them. `comparePlotColors` (with `radarStrokeColor`) and the season row's team are still PR 3.
2. **Only what PR 1 needs is in `lib/stats/compare.ts`:** the moved `colorDistance`, `CONTRAST_PALETTE`, `MIN_DISTANCE`, `ensureContrast`, the three `*_COMP_STATS`, `getStatVal`, and `buildComparison`. `poolSize`, `poolPosition`, `eligible` and `radar: "drawn" | "too-few"` arrive with the pool step in PR 1b; `compareGroup`, `CARD_STAT_KEYS`, the URL helpers, geometry and copy in PR 2. The group is still worked out in `ComparisonTool` exactly as before (QB, RB with FB, everything else the receiver table).
3. **The pin** is `__tests__/components/ComparisonTool.pin.test.tsx` with `__tests__/components/fixtures/comparison-tool-pin.expected.json`, committed alone on the unmodified component (commit `19663f0`: 28 tests passed, no file under `components/`, `lib/` or `app/` differed from `origin/main`). Ten pairs, each on both data paths: Allen/Stafford, Lamb/Smith-Njigba, Robinson/Gibbs, McBride/LaPorta, Lamb/McBride, Stafford/Allen (reversed), Penix/Allen (missing rushing EPA), Valdes-Scantling/Lamb (missing YAC/Rec for one player), Robinson listed as a fullback, and Robinson/Gibbs with Gibbs' `stuff_rate` removed (F12; the only edited row, edited in the test, not in the fixture). The expected file has three parts per pair: `radar` (the two value arrays, NaN written as the string "NaN"), `chart` (colours, names, axes), `table` (headers and every cell). PR 1b replaces `radar` only.
4. **The browser path's raw rows are made in the test** from the saved rows by writing every `null` as the string "NaN" (the saved rows had already been through `parseNumericFields`; no raw database rows were read). On every pair but the F12 one the two paths give the same page, and a test says so.
5. **F12 measured:** a parsed `null` `stuff_rate` gives stuff avoidance 1, the value of a back never stuffed, which is the 83.5th percentile on these rows (81 of the 97 backs have a stuff rate above 0; the others tie with him, and ties do not count as below), not the 100th. `undefined` behaves like the string "NaN" (centre), not like `null`.
6. **Goldens.** `__tests__/stats/fixtures/compare-pool-all.expected.json` holds all five reference pairs with the old pool (radar to 2 decimals, colours, every table row), taken from `build_data.py`'s output. Both the pin (through the component) and `__tests__/stats/compare.test.ts` (through the module) are checked against it. Rows: `__tests__/stats/fixtures/compare-2026-w4-rows.json`.
7. **Checked:** vitest 1875 tests / 85 files (main 1825 / 83), `tsc --noEmit`, lint (no new warning), placeholder build. Seen in a browser on local dev against a stub database serving the fixture rows: Allen vs Stafford (red dashed outline for Stafford, 7 corners each) and Lamb vs Smith-Njigba (YPRR label grey, 5 corners each, table as in §6.4).

## 15. As built (PR 1b, 2026-10-09, branch `compare-card-pr1b`)

What a visitor sees: every Compare radar now has the shape of the players' stat cards; a grey line under the radar says which players it ranks against (C4); a backup or low-volume player gets an amber small-sample line under it (C6); in the first days of a season, when fewer than 2 players at a position qualify, a sentence stands where the radar would be (C4z); a receiver or tight end with half his radar stats or more missing gets no outline, and a sentence says so (C4m, as on his stat card); the chart's small legend line is reworded (C5). The stat table did not change.

1. **Pools.** `lib/stats/tecmo-card.ts` exports `qbCardPool(all)`, `rbCardPool(all)`, `wrCardPool(all, position)`; its three builders call them (own commit; the 2025 anchors and `wr-te-2025-pool.json` untouched). `buildComparison` gets each player's pool from them. Per player it now also returns `poolSize`, `poolPosition`, `eligible`, `volume`, `games`, `shortName`; and `radar: "drawn" | "too-few"` for the pair (`COMPARE_MIN_POOL` = 2).
2. **Receiver-table rows that are neither WR nor TE** (93 RB rows in 2026; reachable with a hand-typed link, or a `player_slugs` position that differs from the row's): the row's own `position` picks the pool, exactly as `buildWRCardData` does. An RB row is ranked against the qualified RB rows of the receiver table (57 on the Week 4 data) and C4 says "RBs". A row with no position at all is ranked among the other rows with none, and the sentences say "receivers" (never "undefineds"). No guard was added for an unknown group or a missing row: still PR 2 (`compareGroup`), and the precondition comment stays.
3. **Sentences** are functions in `lib/stats/compare.ts`: `comparePoolSentence` (C4; null when no radar), `compareTooFewSentence` (C4z; one sentence, the short position or both joined by "or" in the pair's order), `compareSmallSampleSentence(c, nameA, nameB)` (C6) and `compareNotDrawnSentences(c, nameA, nameB)` (C4m), where a name is the full name as a string or `{ fullName, slug }`, and the constant `COMPARE_RADAR_LEGEND` (C5), which `OverlayRadarChart` prints. Thresholds come from the `tecmo-card.ts` constants.
4. **Deviations from the text above, all small:**
   - ~~C6 is not shown when no radar is drawn.~~ Reverted after the chaos pass: C6 shows in the too-few state too, as §8 says (see item 9).
   - C6 on `/compare` has no " OVR hidden." ending, as §8 says (that ending is for the image and share page).
   - C6's "full names when the two short names are equal" also applies when a row carries no name.
   - The two-count form of C4 is used whenever the two rows' positions differ (so also "129 WRs, 57 RBs"), not only for WR vs TE.
5. **Chart.** `OverlayRadarChart` has optional `missing1` / `missing2`; a masked axis is drawn exactly as a NaN value was (a test compares the two SVGs). `ComparisonTool` passes values + mask; the NaN conversion from PR 1 is gone. With `radar: "too-few"` the chart is not rendered.
6. **The pin.** `comparison-tool-pin.expected.json`: the `radar` parts were replaced once (now `values1`, `values2`, `missing1`, `missing2`; no NaN), by a one-off run that rewrote only those keys. `chart` and `table` are PR 1's byte for byte: the file's diff shows only radar lines and the `_about` line, and a test holds the sha256 of all 20 `chart` + `table` parts as computed from PR 1's file (`35c01fce…3210`). New in the pin test: every pinned radar equals the player's own stat card (`buildQB/WR/RBCardData(...).radarValues` / `radarMissing`) and, for the five reference pairs, the Python reference exactly.
7. **Goldens.** `compare-pool-all.expected.json` is deleted. `compare-card-pool.expected.json` is written by `build_data.py` (now the per-player pools; it reproduces the file byte for byte) from the committed row fixture: the five pairs of §6.4 plus two more, T.Huntley vs J.Allen (a quarterback under the line) and C.Lamb vs A.Jones (a receiver-table RB row). Percentiles are **unrounded** and the tests compare them exactly (the same arithmetic in Python and JavaScript). The direct tie runs over every row of all three tables (49 + 362 + 97), not only fixture players.
8. **Checked:** vitest 1922 tests / 86 files (main 1875 / 85), `tsc --noEmit`, lint (4 warnings, all of them on main too: the `useEffect` one in `ComparisonTool.tsx` and three `<img>` ones in the leaderboards), placeholder build. Seen in a browser on local dev against the stub database: Allen vs Stafford (83.3 / 81.0 / 42.9 / 88.1 / 35.7 / 42.9 / 97.6 and 45.2 / 31.0 / 88.1 / 83.3 / 16.7 / 47.6 / 9.8, read back from the drawn outline), Lamb vs Smith-Njigba, Lamb vs McBride (two-count line), Huntley vs Allen (small-sample line); at 375 px the new lines wrap inside the page with no sideways scroll. C4z was not seen in a browser (no real 2026 pool is under 2); it is covered by component tests only.
9. **After the chaos pass (no crash; table unchanged over 30,730 comparisons; radar equal to the stat card for all 508 rows), same branch:**
   - **A player with half his radar stats or more missing gets no outline** (C4m), by the stat card chart's own rule. `radarHasTooFewAxes(missingCount, axisCount)` in `lib/stats/radar.ts` is that rule; `components/qb/RadarChart.tsx` and `buildComparison` (`outline: boolean` per player) both call it. `ComparisonTool` hands an undrawn player to the chart with every axis masked; with both undrawn it shows the sentences and no chart (`compareRadarIsDrawn`). His `values` / `missing` are still the stat card's.
   - **"yet" is dropped from C4z** rather than made conditional: `ComparisonTool` gets a `season` number but no "newest season" flag (the page passes none), so it cannot tell a season that will fill up from one that never will.
   - **C6:** shown in the too-few state too; `volume` / `games` are `number | null` (numeric strings read with `Number()`; null, undefined, NaN, a negative number, an empty string or a boolean give null and that player's clause is left out); names never print as "null" or empty.
   - **Position words** from a closed list (C4z row above). The row is still ranked by the stat card's own filter (`position ===` the row's value), whatever the value is.
   - **Purity test** now follows the import chain from `compare.ts` (through `tecmo-card.ts`, `radar.ts`, `percentiles.ts`, `archetypes.ts`, `fantasy.ts`, `formatters.ts`, `lib/data/teams.ts`): only `lib/stats` and `lib/data/teams`, no runtime package import at all.
   - Counts now: vitest 1958 tests / 86 files; `/compare` route 7.45 kB, 138 kB first load (130 kB after PR 1: the stat card module is now in its graph).
10. **Known differences from the stat card's chart, left for a follow-up (out of scope here):** the stat card's radar (`components/qb/RadarChart.tsx`) still prints "outer ring = league best · dashed = 50th percentile" while Compare prints "Farther out = higher percentile · dashed ring = 50th percentile" (the reason for the rewording applies to the card too: a player under the line can sit on the outer ring); and the stat card greys an axis label whenever that player lacks the stat, while Compare greys a label only when both players lack it.
11. **After the code review, same branch:** quarterbacks are counted in "pass attempts" in every line (pool line and too-few line: "14+ pass attempts a game"; before, only the small-sample line said "pass attempts"), and the pool line ends with a full stop like the other three; a player with 0 games is left out of the small-sample line; `__tests__/components/RadarChart.test.tsx` binds the stat card's chart to `radarHasTooFewAxes`. Not touched, left for a follow-up: the player page's own "below 14 attempts per game" wording. vitest 1964 tests / 87 files.

## 16. As built (PR 2, 2026-10-09, branch `compare-card-pr2`)

The share page `/card/compare/[a]/[b]` and the image `/api/compare-card/[a]/[b]` exist and are linked from nowhere (the Share block on `/compare` and the `/compare?p1=&p2=` preview are PR 3). Both are `noindex` / not in the sitemap.

**Files.** `lib/stats/compare-card.ts` (pure: URL grammar, `buildCompareCard`, every sentence, the layout numbers) · `lib/data/compare-card.ts` (server: `loadCompareCardForPage`, `loadCompareCardForImage`, the three memos) · `lib/og/compare-card-image.tsx` · `app/card/compare/[a]/[b]/page.tsx` · `app/card/compare/page.tsx` and `app/card/compare/[a]/page.tsx` (404 only) · `app/api/compare-card/[a]/[b]/route.tsx` · `getSeasonWeeks` in `lib/data/queries.ts` · `getPlayerSlugIndex` in `lib/data/players.ts` · `memoised` exported from `lib/data/team-radar-card.ts` · `PIXEL` / `SANS` exported from `lib/og/team-radar-image.tsx`.

**As specified, and held by tests:** order kept (mirrored URLs are mirrored cards); slug grammar and `a !== b` before any read; the image's exact query form (`w` 1-22); `compareGroup` (TE with WR, FB with RB, anything else no table) and named errors from `buildComparison` for an unknown group or a missing row (chaos R1 closed); zero database requests on the image route while its three memos are warm, keys only `seasons`, `slugs`, `GROUP:season`; unknown slug and unlisted season = `no-store` 404; different groups / junk = stored 404; failed or impossibly empty read = 503 `no-store` + `retry-after: 60` (image) or a thrown error (page and metadata); lowercase header keys, one `cache-control`; `download=1` file name from the validated slugs; one load per request through React `cache()` keyed on `(a, b, season | null)`; title `absolute`; `og:url` own order, canonical alphabetical; explicit `og:image` / `twitter:image` with `season` and `w`; every number on the card is `buildComparison`'s (the model is built once by `buildCompareCard` and the page, the metadata and the image print from it); OVR from `buildQB/WR/RBCardData(...).ovr`; team and colours from the SEASON row's team; colours = `comparePlotColors` (`radarStrokeColor` per team, then `ensureContrast`, which now never returns anything but `#RRGGBB`: chaos R2 closed).

**Differences from the text above, decided while building:**

1. **The legend (C5) is above the keep-clear line**, at the bottom of the radar pane (y 470-494), not in the footer strip as §3 drew it. The footer strip (y 522-630) now holds only the site line. To make room the radar is a little smaller than the mockup's: centre y 302, radius 128 (mockup 325 / 132).
2. **C4m on the image** (not in §3, it was added in PR 1b): when one player's outline is left out, the sentence takes the legend's place under the radar. With both left out, or too few qualified players (C4z), the sentence(s) stand in the pane and no radar is drawn. The strip at y 494-522 carries C6 only.
3. **The pool line's wording is PR 1b's as built:** "14+ pass attempts a game", a full stop at the end, the two-count form whenever the two positions differ.
4. **Band names:** the box is 430 px and a name wider than that (34+ characters at 13 px) is cut at its END on both halves (the right half switches from right-aligned to left-aligned when the name does not fit, so its start is never lost). The name box is 40 px tall: at 26 px the pixel font's tops were cut off in the first local render.
5. **The pure code is in two files**, `lib/stats/compare.ts` (the maths, in `/compare`'s browser bundle) and `lib/stats/compare-card.ts` (the card; it imports `lib/stats/team-radar.ts` for the outline-colour rule, which `/compare` does not need until PR 3). §9 put everything in `compare.ts`.
6. **No `CompareCardActions.tsx`:** the page uses the team radar page's `TeamRadarActions` as it is (same two buttons, same strings, including "Copy failed: use the address bar").
7. **C7 on the share page is printed under the radar with the other notes**, and the no-outline sentence (C4m) there too. On the image a missing axis is only a grey label.
8. **The plate** (a pair with nothing to compare) is dark navy with both names, "VS", the season and the C10 sentence: there is no single team colour to use.
9. **`w` in the image URL** is written by the page only when the week is 1-22, and the route refuses `w=05` (a leading zero) as well as 0 and 23+.
10. **Fonts:** the image uses `radarImageFonts()` unchanged, so a font that cannot be read is logged as "Team radar image: font ... unavailable" for this route too.
11. **Spec text not built here (PR 3):** anything on `/compare` (Share block, C10 there, `comparePlotColors` and the season-row team there, pair metadata). Until PR 3 the card's colours can differ from `/compare`'s for a player on PIT or NO (the card uses the readable secondary) and for a traded player (the card uses the season row's team).

**Rendered and looked at** (2026-10-09, a patched scratch copy of the bundled `@vercel/og`, the committed Week 4 rows; the method of team radar §15 item 19): Allen vs Stafford, Lamb vs Smith-Njigba, Robinson vs Gibbs, Lamb vs McBride, Huntley vs Allen (OVR dash, small-sample line), a worst case (34- and 33-character names, the longest short names, both players under the line, Week 18, two-count pool line), PIT vs NO colours, one outline left out, too few qualified players, and the plate. What was seen: the first render cut the tops off the band names (fixed, item 4); after that nothing clips or overlaps; the two-count pool line at Week 18 ends about 60 px before the site name; the longest small-sample line fits its strip; the bottom axis label sits about 10 px above the legend line (close, not touching); nothing but the site line is below y = 522. The footer strip is a plain pale band 108 px tall: by design, but it does look empty.

**Seen in a browser** (local dev, stub database): the share page at desktop width and at 375 px for Allen vs Stafford, Huntley vs Allen, Lamb vs McBride and a no-stats pair; metadata as above; every 404 and its cache header on both routes. At 375 px the VS block first overlapped the inner edges of the two OVR badges; the badges' margins were moved to the seam side and they clear it now. **The image route's success path cannot run under `next dev` on Windows** (next/og's loader bug: 500, `ERR_INVALID_URL`), so the page's Download button and the preview image were not exercised end to end locally; the PNGs above come from the same image module through the patched renderer.

**Still to confirm on a Vercel preview (unchanged from §11):** both font files readable inside the new function (else `outputFileTracingIncludes` for the route), `&download=1`, a `?season=` link's preview, and one real post on X to compare its title pill with the keep-clear strip.

**Counts:** vitest 2310 tests / 93 files (main 1964 / 87), `tsc --noEmit`, lint (the same 4 warnings as main), placeholder build (three new routes listed).

### 16b. After the chaos pass (PR 2, same branch, 2026-10-09)

The chaos test found no crash. What it did find, and what changed (each fix has a test that failed first):

1. **The share page reads nothing per slug (R1) and fails once (COST-1).** As first built the page read `player_slugs` once per slug in the URL: 200 made-up pairs were 400 database requests, and a failed read was made twice per page view (Next renders the error page as a second pass, outside the first pass's `cache()` scope), so a hung read held the function for two 5 s limits. **The page now uses the image route's loader** (`loadCompareCard`): seasons, the slug list and the season table through the three memos. A made-up slug is a 404 from the list in memory; `getPlayerBySlug` is no longer called for this page. This replaces "two `getPlayerBySlug` calls in one wave" in §4, §6.1 and the first half of this section. Cost of the change: the page's reads no longer differ from the image's, and a cold instance reads the slug list (two requests) where it used to read two single rows.
   - **A rookie is not hidden:** nothing is remembered per slug. The slug list is kept sixty seconds in the instance; on the page it also sits in Next's data cache for up to an hour like every read of that route, and `/api/revalidate` (which every data refresh calls, `revalidatePath("/card", "layout")`) clears it. The page itself is dynamic (it reads `searchParams`) and is never stored by the CDN, 404 included.
2. **A failed memoised read is remembered for ten seconds (COST-2).** `memoised` (`lib/data/team-radar-card.ts`, shared with the team radar) used to forget a rejection at once, so a fast-failing outage was retried once per request. It now keeps the rejection for `MEMO_FAILURE_TTL_MS` (10 s, counted from the moment it failed) and hands it to every caller in that window: never as a success; the first request after the window reads again. During an outage that is one request per key every ten seconds instead of one per visitor. The team radar image route and share page behave the same way (team radar spec §15 item 20).
3. **One spelling of the image query (R2), on the comparison image route ONLY.** `parseCompareImageQuery` takes the raw query string (`rawQueryOf(req.url)`) and accepts only what the page prints: nothing, or `season`, `w`, `download=1` in that order (`canonicalImageQuery`). `?&`, a trailing `&`, percent-encoded digits or another key order parsed to a valid card and were each a new CDN entry and render; they are the stored 404 now. A test sends every href the page can print back through `rawQueryOf` and the parser. Two limits, both from the code review:
   - **A bare `?` is not really refused in production.** Next rebuilds `req.url` from the parsed URL, so the `?` is gone before the handler runs; the unit tests hand the route a plain `Request`, which keeps it. Harmless: it draws the card the bare URL draws.
   - **The team radar image route does NOT have this rule (controller decision, review I1).** It was applied there in commit dbd00fa and taken out again: that route is live, links to it are already posted, and what Next and Vercel hand a handler as `req.url` in production (key order, encoding) cannot be verified from a test. `app/api/team-radar/[team_id]/[side]/route.tsx` and `parseRadarImageQuery` are byte-for-byte `origin/main`'s. The rule stays compare-only until it has been seen working on Vercel with the live compare route; a follow-up may then extend it to the team radar.
   - Consequence unchanged from before: an image URL that a platform decorates with `?fbclid=` or `utm_` is a 404; the page prints clean URLs.
4. **"Through Week N" only for N from 1 to 22 (R4)**: `compareWeek`. Any other `through_week` (bad data) prints no week on the card, the page or the description and sends no `w`.
5. **A printed tie is a tie (W1).** `buildComparison` decided the better value on the unrounded numbers, so CROE `+9.1%` vs `+9.1%` (P.Bryant vs D.London, 2026) carried a highlight. The winner now needs two cells that print differently. **This changes `/compare`'s table too, for printed ties only** (3 rows in 2,100 in the chaos run). None of the ten pinned pairs has such a row: the pin's expected file and its table hash are unchanged, and a comment beside the hash records the rule change. The Python reference has the same rule and still reproduces the golden byte for byte.
6. **The picture.** The kept-clear band at the bottom is **84 px** (108 before) and the body 390: the radar is radius 140 at centre y 311, rows are 50 px, and **the keep-clear line is y = 546** (`COMPARE_CARD_KEEP_CLEAR_Y`; §3 and the first half of this section say 522). The legend and the small-sample line are above it; only the site line is below. An OVR of 100 is drawn at 18 px so it keeps a margin in its badge. The better-value pill has a 1 px green edge (`#86efac`; the other cell the same box in white), so it reads as a pill beside a green player's line (the Jets); the share page's pill has a matching ring.
7. **Re-rendered and looked at** (same method): Allen vs Stafford, Lamb vs Smith-Njigba, Huntley vs Allen, the long-names case, a Jets-green player B (against a red player A), an OVR-100 case. Nothing clips or overlaps; the bottom label now sits about 15 px above the legend line; "100" has about 10 px of margin each side; the pill's edge is visible beside the Jets' dark green; the band under y = 546 holds only the site line.
8. **Not changed, from the same report:** colours follow the slot, not the player (the same pair posted in both orders gives one player two colours); a 34+ character name is cut without an ellipsis; a grey axis label has no sentence on the image; `/card/compare` and `/card/team` are reserved, so a player whose slug were `compare` or `team` could never have a stat card page (no live slug is).
9. **Rate limit, optional, the owner's step (§12).** If a Vercel Firewall rate-limit rule is added, it should cover **both** prefixes, `/api/compare-card/` and `/card/compare/` (the page is dynamic: every URL is a function run). **Never use robots.txt for this:** X's and Facebook's link-preview fetchers obey it, so a `Disallow` on these paths would take the picture off every shared link.

**Counts after the chaos fixes:** vitest 2390 tests / 94 files.
10. **After the code review (same branch).** (a) **The seasons and the slug list are started together** (`loadCompareCard`), then the season table: on a slow database a cold instance waits once for the first two, not twice in a row (4 s + 4 s instead of 4 + 4 + 4 in the test). The checks keep their order and the status codes are unchanged; the one visible difference is that a URL naming a season the site lacks also starts the (memoised, never per-URL) slug list read on a cold instance. A cold card is seasons 1 request + slug list 2 (two pages, one after the other inside `fetchAllRows`) in parallel, then the table 1. (b) **`maxDuration` was NOT added.** No route in the repo sets it and nothing in the repo records the Vercel plan's function limit, so raising it here would be a guess; if the project's limit is 10 s, a slow-but-answering database can still end a cold request as Vercel's own 504 (the read limits are 5 s each). Worth one look at Vercel → Settings → Functions. (c) The font log line names the image (`Compare card image: font ... unavailable`; the team radar's is unchanged). (d) `COMPARE_NEUTRAL_COLOR` is tied to `RADAR_NEUTRAL_STROKE` by a test. (e) Tests added for the outline fills, the VS block against the OVR badges, the legend's position, the header columns; the fetch spies that could never fail were removed (every `lib/data` module is mocked in those files: the read counts on the mocks are the proof; the end-to-end count against real loaders is the chaos run's).
11. **What this PR changes on pages that are live today** (everything else is the new, unlinked card): (1) `/compare`: two table values that print the same no longer get a highlight (item 5). (2) Team radar share pages and image route: a FAILED read is remembered for ten seconds (item 2). Nothing else on the team radar: its route and query parser are `origin/main`'s; `PIXEL`, `SANS` and `memoised` gained an `export`, and `radarImageFonts` an optional label that defaults to the old text.

**Counts after the code review:** vitest 2399 tests / 94 files.

## 17. As built (PR 3, 2026-10-09, branch `compare-card-pr3`)

Everything on `/compare`: the Share block, the "no stats" sentence, the pair's link preview, and one colour rule for the page and the card. Where this section differs from the text above, this section is what the code does.

1. **Share block** (`components/compare/CompareShare.tsx`, rendered by `ComparisonTool` between the radar's sentences and the stat table): "Share this comparison", **Copy Link**, **Download Image**, "Open share card →". Copy Link copies the share page's absolute URL in the order chosen (player 1 = A), built from the `siteUrl` prop the server passes (`NEXT_PUBLIC_SITE_URL`, else `https://yardsperpass.com`), never from `window.location`. Download opens the image route with `season` and `download=1`. Links are bare for the newest season and carry `?season=` for another, by the new server-computed `defaultSeason` prop. A failed copy shows C13's `/compare` sentence, "Copy failed: open the share card and copy its address" (not the card pages' "use the address bar": here the address bar holds `/compare`).
2. **When the block shows:** two different players, both with a row in the season table, both of ONE stat table by their own `player_slugs` positions (`compareGroup`), both slugs inside the share URL's grammar. That is exactly when the share page is a card. It also shows when the radar is not drawn (too few qualified players, or no outline for a player): the card exists there (table and sentence). Hidden for one player, the same player twice, a missing row, players of different groups (a hand-typed link can put a running back's receiving row beside a receiver; the page still draws that comparison but its share URL is a 404, so no block), or a slug outside the grammar.
3. **C10 on `/compare`:** where the page showed nothing for a chosen pair with a missing season row, it now prints the C10 sentence (`data-compare-no-stats`), "yet" form only on the newest season. Not while the table is loading or failed to load, and not for players of different groups.
4. **Link preview (J6).** `app/compare/page.tsx` exports `generateMetadata` instead of `metadata`. For a pair that has a share card or a plate: title C18 (`compareToolTitle`), description C2 (or the C10 sentence), `og:title` / `twitter:title` C1b, `og:url` = `/compare?p1=&p2=` in the link's order (plus `&season=` for a past season), `og:image` / `twitter:image` = the image route with `season` and `w`. Canonical always bare `/compare`; the page is not `noindex`. Anything else (no pair, one player, same player, junk slug, repeated parameter, season outside 1999–2100 or not in `data_freshness`, unknown slug, different groups) = the standard metadata, and the first six of those make no read at all. A repeated `season` parameter (`?season=2025&season=2024`) previews the FIRST value, as the body shows it (both read the value with the same `parseInt`).
5. **Its reads are the share card's loader, not two `getPlayerBySlug` calls** (§7 said `getSeasonWeeks()` + two player reads): `loadCompareCardForPage`, so seasons, the slug list and one season table come through the one-minute memos and nothing is read per slug or per pair (a test sends 200 made-up pairs: two reads in all). It is a read that may degrade: a failure (or an impossibly empty table) is caught, logged once with `console.error("Compare page: link preview read failed …")`, and the standard metadata is returned. `generateMetadata` never rejects. The season is read with the body's own rule (`seasonInUrl`: bare `parseInt`, so `2025abc` is 2025 for both).
6. **`defaultSeason` needs the seasons list even when the URL names a season.** Until now `/compare?season=2025` made no seasons read. It now does, as a read that may degrade: on failure it logs and takes `fallbackSeason()` (the calendar's season) as the newest, and the page renders as before. The existing test "an explicit ?season= needs no seasons read" was rewritten on purpose to say this. With no `?season=` the seasons read is still core (a failure is the error page), unchanged.
7. **Colours (deviation 8 of §16 closed).** `comparePlotColors` moved into `lib/stats/compare.ts` and `buildComparison` uses it: each player's colour is the outline colour of the team on his SEASON ROW (`radarStrokeColor`: primary if it shows on white, else secondary, else dark neutral), then B is moved away from A (`ensureContrast`). `teamA` / `teamB` (what `player_slugs` says today) are only the fallback for a row with no team. The card takes its colours from `buildComparison`, so the two cannot differ. **What changes on `/compare`:** a PIT player is `#101820` (was gold `#FFB612`), a NO player is `#101820` (was `#D3BC8D`). **That near-black is only what he gets beside a team it is far enough from.** `ensureContrast` still moves player 2 away from player 1, so against a DARK team colour the result is red: a PIT or NO player as Player 2 beside a dark-coloured Player 1 is drawn in the red `#dc2626`, not near-black; and when PIT / NO is Player 1 (near-black, never moved) it is his dark-coloured OPPONENT who becomes red. PIT vs NO, both near-black, gives B the red; a traded player wears the team he played for that season; a player with an unknown team is the dark neutral `#0f172a` (was grey `#6B7280`). **No pinned pair changed:** none of the ten involves PIT or NO or a traded player, the pin's expected file is untouched and the chart + table hash is the same.
8. **Bundle.** Next's "First Load JS" for `/compare`: 138 kB on main, 154 kB after the first two steps, **149 kB as shipped**. The 154 came from the browser code reaching `lib/stats/team-radar.ts` and `lib/stats/team-stats.ts`; fixed by two moves with no change in behaviour: the outline-colour rule (`contrastOnWhite`, `radarStrokeColor`, the two constants) now lives in `lib/stats/formatters.ts` (`team-radar.ts` re-exports the same names), and the links and Share-block words live in the new `lib/stats/compare-links.ts`, which imports nothing (`compare-card.ts` re-exports them). A test walks the browser code's imports. Of the remaining 11 kB over main, about 8.7 kB is the `next/link` chunk, which the root layout already loads on every page (it is counted for this route now because the Share block has a link); the page's own chunk grew by about 1.3 kB.
9. **Seen in a browser** (local dev, stub database, 1280 and 375 px): Allen vs Stafford (block between radar and table, one row on desktop, stacked and inside the page on a phone, no sideways scroll; hrefs `/card/compare/josh-allen/matthew-stafford` and `/api/compare-card/josh-allen/matthew-stafford?season=2026&download=1`); Lamb vs McBride and Huntley vs Allen (block shown, with the two-count and small-sample lines); Allen vs a player with no row (the C10 sentence, no block, no table); Allen vs Lamb (nothing new). Head tags: with a pair the title, description, `og:url`, `og:image` and `twitter:image` above; with no player, one player, or two of different groups the standard title and the site's default preview image; canonical `/compare` every time. The preview pane has no clipboard permission, so Copy Link showed the failure sentence there (on a phone it wraps to two lines and pushes Download below it for four seconds); the success path is covered by tests only.
10. **Live observation after PR 2 (controller):** on Vercel the image URL with a trailing `&` (`?season=2026&`) answered 200, where the route's parser refuses that spelling locally. Vercel or the client normalises the query before the handler sees it. Harmless (no extra render: it is the same URL by then), but §16b item 3's "a trailing `&` is the stored 404" is only true of what reaches the handler.
11. **X-on-a-phone gate PASSED 2026-10-09 — Jon posted /card/compare/josh-allen/matthew-stafford on X; the title label sits inside the 84 px band on desktop (screenshot) and he confirmed the same on his phone.** Sitemap unchanged: share pages stay out. Not built: nothing tells a visitor why the Share block is absent for a pair of different groups.
12. **After the chaos pass (0 crashes, 0 wrong output, 0 regressions; same branch):**
    - **COST-1.** "Open share card →" has `prefetch={false}`. With no prefetch prop next/link asked the server for the share page's route tree as soon as the block was on screen: one function run per pair looked at (no database read, about 230 bytes). **The share route must not gain a `loading.tsx` without revisiting this:** a prefetch renders up to the nearest loading boundary, and "reads nothing" would stop being true for any link that does prefetch.
    - **R1.** Copy Link, `og:url`, `og:image` and the canonical are built from `NEXT_PUBLIC_SITE_URL`, else the production apex. Nothing in the repo sets that variable per deployment, so **a Vercel preview copies and previews the PRODUCTION address** unless the variable is set for Preview. Right for production; worth knowing when testing a preview (the comment in `CompareShare.tsx` said the opposite and is corrected).
    - **R2.** One team rule for both surfaces, `compareTeamId(row, fallback)` in `lib/stats/compare.ts`: the season row's `team_id`, else the team `player_slugs` has, else none (the neutral colour, no team printed). `buildComparison` and `buildCompareCard` both call it; the card's input gained an optional `teamId` (the loader passes `current_team_id`). Before, a season row with no team was `player_slugs`' colour on `/compare` and the neutral on the card. The ingest always writes a team, so this needed bad data.
    - **R3.** One name rule, `compareDisplayName(name, shortName, fallback)`: full name, else the season row's short name, else a name made from the slug, else "Player 1" / "Player 2"; trimmed. The C10 sentence on `/compare` used the raw `player_slugs` name (an empty one printed " has no 2026 stats yet", a null one "null has no …"); it, the other sentences, the card and the loader's no-stats state now all use the one function.
    - **R4, not changed.** During an outage each pair view logs the preview failure again: the failed read is remembered for ten seconds (no extra database request), but the log line is per request, not per outage. Log noise only.

**Counts after the chaos pass:** vitest 2491 tests / 96 files; `tsc --noEmit` clean; lint 4 warnings, all on main; placeholder build passes. Pin file and chart + table hash unchanged.

**Counts:** vitest 2459 tests / 96 files (main 2399 / 94); `tsc --noEmit` clean; lint 4 warnings, all on main; placeholder build passes.
