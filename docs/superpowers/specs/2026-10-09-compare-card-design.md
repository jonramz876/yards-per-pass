# Comparison share card — design spec (revision 3)

Date: 2026-10-09 · Status: revision 3, **approved with changes R1–R4 by the re-review, all four applied here** · PR 1 built on branch `compare-card-pr1` (§14) · Repo state read: `origin/main`
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

Every block is a flex `div`; the radar is `<svg>` with `<path>`, `<line>`, `<circle>` only (Satori rules, as `lib/og/team-radar-image.tsx`).

| y | Block | Content |
|---|---|---|
| 0–92 | **Band**, two halves | Left = player A on A's plot colour; right = player B on B's, mirrored. Full name in Press Start 2P inside a fixed 430 px box (`whiteSpace: nowrap`, `overflow: hidden`): 20 px up to 21 characters, 16 px up to 26, 13 px beyond (fits 33; a longer name is cut at the box, never under the badge). Then `QB · Buffalo Bills · 4 games` (position = the season row's). Text colour from `textColorForBackground`. Navy `VS` block on the seam. **OVR badge** per half (J4): the stat card's number, or "—" when it is `null` (a player under the line). The band is the legend: the half's colour is that player's outline colour. |
| 92–96 | Rule | `#0f172a` |
| 96–128 | Sub-band | Left, 15 px: C3 · C4, e.g. `2026 season · Through Week 4 · Radar: percentile among the 42 qualified quarterbacks (14+ attempts a game)`. Right: `YARDSPERPASS.COM` in the pixel font. |
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
| C4 | sub-band (image), under the radar (share page, `/compare`) | QB: `Radar: percentile among the {N} qualified quarterbacks (14+ attempts a game)` · RB: `… the {N} qualified running backs (6+ carries a game)` · same position: `… the {N} qualified WRs (2+ targets a game)` (`TEs`, `RBs`) · two positions: `Radar: each player against qualified players at his position (2+ targets a game): {n} WRs, {m} TEs` | `N` = that pool's length; thresholds read from the `tecmo-card.ts` constants; position words from the rows; widest form measured 915 px of 952 |
| C4z | in place of the radar | `Not enough qualified {quarterbacks / running backs / WRs / TEs} yet to draw the radar ({14+ attempts / 6+ carries / 2+ targets} a game).` For a two-position pair: the position whose pool is short; **when both pools are short, both positions are named in the pair's order, joined by "or"**: `Not enough qualified WRs or TEs yet to draw the radar (2+ targets a game).` (`TEs or WRs` when the TE is player A). One sentence, never two. | shown at pool sizes 0 and 1, not at 2; a WR-vs-TE pair with only the WR pool short, only the TE pool short, and both short (both orders); in that state the sub-band prints C3 only and C4 is not rendered anywhere (so "the 1 qualified quarterbacks" can never appear) |
| C5 | image footer; `OverlayRadarChart`'s legend line (so once on the share page and on `/compare`) | `Farther out = higher percentile · dashed ring = 50th percentile` | ring at half the radius; a larger value never plots closer in; the old "league best" string is gone from the chart |
| C6 | one line: image y 497–520, under the radar on the share page and on `/compare` | one player: `Small sample: {X} has {n} {unit} in {g} {game/games} (under {T} a game).` · both: `Small sample: {X} has {n} {unit} in {g} {game/games}; {Y} has {n} {unit} in {g} {game/games} (under {T} a game).` · image and share page append ` OVR hidden.` · `{unit}` and `{game/games}` are pluralised per player (`1 pass attempt`, `1 target`, `1 carry`, `1 game`) · `{X}` = short name, or the **full name for both when the two short names are equal** | shown exactly when `qbEligible` / `wrEligible` / `rbEligible` is false, at 13.9 and 14.0; every singular; equal short names; the longest form fits 1,128 px at 13 px (measured 1,057 with two 24-character full names) |
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
| 1b — Compare uses the stat card's pools | pool functions exported from `tecmo-card.ts` and used by its builders; `buildComparison`'s pool step; C4 / C4z / C6 on `/compare`; chart legend = C5; mask props; new golden, old one deleted | **Radar only**: the stat table is byte-identical. The PR text says plainly that the Compare radar changes for every pair, and Jon is told when it ships. **The note to Jon names two things (R4):** (1) every Compare radar changes shape, to match the stat cards; (2) a new sentence he has not seen in the mockup, C4z ("Not enough qualified quarterbacks yet to draw the radar (14+ attempts a game)."), which replaces the radar when fewer than 2 players at a position qualify, so only in the first days of a season | Allen's Compare radar equals his stat card's (83 / 81 / 43 / 88 / 36 / 43 / 98 on the Week 4 data); a WR-vs-TE link; a backup QB shows C6 |
| 2 — card | loaders, share page, image route, 404 stubs, metadata | Nothing links to it yet | Vercel preview: the three pairs; missing YPRR; `dorian-thompson-robinson`; a PIT or NO player; a backup (OVR "—", C6); `&download=1`; `?season=2025`; the font log line. Then **post one link on X** and compare the pill with the keep-clear strip on a phone and a computer |
| 3 — entry points | Share block, C10, colours and season team on `/compare`, pair metadata | Additive; canonical unchanged | Paste a `/compare?p1=&p2=` link into X's composer: one uncropped image |

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
