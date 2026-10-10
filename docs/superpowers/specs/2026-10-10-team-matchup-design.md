# Team Matchup page — design spec (revision 2, spec review 1 applied)

Date: 2026-10-10. Status: design locked by `decisions.md` (Jon delegated the pick). Spec review 1 returned CHANGES REQUIRED (1 blocker, 8 should-fixes, 14 notes); all are applied here and mapped in §16. Spec review 2 returned APPROVED with five builder notes; they are applied in this copy (§16, "Spec review 2"). PR 1 (logic and loader) is built: see §17 "As built (PR 1)". PR 2 (pages) is not built.
The mockup (`matchup-directions.html`), the designer's `notes.md` and `decisions.md` were session working files and are not in the repo; this spec is the durable record. Where the three disagree, `decisions.md` won. Where the code disagreed with any of them, §2 says what the code says and what this spec does.

## 1. The request, goal and non-goals

**Goal.** A page that sets one team's offense against the other team's defense, and the reverse, using the numbers the site already shows on `/team-stats` and the team radars. Two routes:

1. `/matchup/[away]/[home]` — the matchup of two teams.
2. `/matchup` — this week's games as one-tap rows, then two team pickers.

Page order on `/matchup/[away]/[home]`, top to bottom (decisions.md "Direction"):

1. Face-off header (Tecmo band style): away team, "AT", home team, game week and kickoff when the two teams have a game in the season.
2. Two overlay radars, the hero: away offense over home defense | home offense over away defense.
3. Stat ladders: 13 lines, offense left, defense right, tug marker and verdict in the middle. Both ladders side by side at 1280 px and up; one ladder with two tabs below that (`?ball=home`).
4. Main players: mirrored lineup, QB / RB / RB / four WR-TE.
5. Footnotes: the rank and edge rules, which EPA family, the early-season note.

**Zero new tables, zero new columns, zero DDL, no change to `scripts/ingest.py`.** Arithmetic runs on the server at request time over stored `team_game_stats` rows, the documented exception `/team-stats` and the team radar already use (`.claude/CLAUDE.md:32`).

**Non-goals (decisions.md "Cut from v1").**

- No "Biggest mismatches" sorted list or filters (direction C).
- No generated sentences (direction B).
- No share card, no image route, no `opengraph-image`. `generateMetadata` gives title and description only.
- No OVR on players.
- No "last 4 games" view. Season to date only.
- No sticky or floating radar panel. Nothing on the page is `position: sticky` or `fixed`.
- No win probability, projected score, blended score, or named winner anywhere, including the spoke count line.
- No new web font. No new dependency.
- No season selector on the page (a `?season=` link works; §4).

## 2. What the code says today

Each row was checked in the repo on 2026-10-10.

| Assumption (decisions.md / notes.md / mockup) | What the code says | What this spec does |
|---|---|---|
| "One `team_game_stats` read … reuse whatever loader `/team-stats` and the team radar already share" (decisions.md Data) | There is no shared loader. `/team-stats` reads 30 columns (`lib/data/team-stats.ts:11-20`, `getTeamStatsSeason` `:45-81`); the radar reads its own 17 (`lib/data/team-radar.ts:17-22`, `getTeamRadarRows` `:46-63`). The only memoised one (`getTeamRadarRowsCached`, `lib/data/team-radar-card.ts:90-92`) holds radar columns, which cannot feed `buildTeamStats`. | One NEW read with the union of both lists (35 columns), behind the existing `memoised` helper (`lib/data/team-radar-card.ts:54-75`). Both builders take `Record<string, unknown>[]` and ignore extra keys (`lib/stats/team-stats.ts:180`, `lib/stats/team-radar.ts:244-247`), so one read feeds both. The two existing lists and their frozen goldens are not touched (§6). |
| "Reuse the memoised season-table loader in `lib/data/compare-card.ts` if its shape fits" | The shape fits (a whole season table per group), but `readTableCached` and the three memo maps are module-private (`lib/data/compare-card.ts:147-166`). The slug list is a `Map` by slug (`lib/data/players.ts:283-295`); the matchup needs player id → slug. | Export three thin wrappers from `compare-card.ts` so both features share one memo (§6.2). The id → slug map is built in memory from the memoised slug list. Never `getPlayerSlugsByIds` (that would be a read per pair). |
| "Schedule … `games`, via `lib/data/games.ts`" (notes.md feasibility), "the same source team pages use" (decisions.md Routes) | The table has week / home / away / kickoff (`GameRow`, `lib/data/games.ts:10-22`), but every loader is per team (`getTeamSchedule` `:156-183`), played-only (`getGameResults` `:198-240`), one game (`getGame` `:267-288`) or ids only (`:305-315`). No league-wide schedule loader exists. | NEW `getSeasonGames(season)` in `lib/data/games.ts`: one season, at most about 285 rows, one page (§6.1). |
| "This week" = the week equal to `through_week` (mockup line 445) | `through_week` is the last week that has stats, not the current slate. No "current week" helper exists; the only "next game" rule is per team (`components/team/ScheduleSection.tsx:318`). | Current slate = the lowest week, at or after the highest week that has a played game, that still has an unplayed game, from the `games` rows themselves (§6.4). |
| "If the two teams have a game this season and the path has them reversed, redirect" | Division rivals play twice a season, once in each building, so both orders are real games. `memory/MEMORY.md` (team pages) also records that a rescheduled game gets a new `game_id` and the stale row is never deleted. | The redirect fires only when there is NO game in the order asked for and there IS one in the other order (§4). A stale duplicate row is handled by the game-picking rule (§6.4). |
| "Every rank is out of 32 teams" (mockup footnote, line 471) | Rank pools are the teams that have a row of their own (`lib/stats/team-radar.ts:298-303`); a spoke's pool can be smaller still. | Sentences print N (teams that have played). A cell whose pool is smaller than N prints "of {pool}" (`rankCellLabel`, `lib/stats/team-radar.ts:488-492`). |
| Mockup `spokeTally` counts a spoke with a missing rank as "even" (line 376) | A missing spoke has no rank (`RadarSpoke.rank: number \| null`). | A spoke with a missing rank on either side is left out of the count, and the line says how many were ranked (§7.3). |
| Link in from "the box score page for unplayed games" (notes.md Q7; decisions.md "only if trivial") | `/game/[game_id]` calls `notFound()` for an unplayed game (`app/game/[game_id]/page.tsx:163`). There is no page to link from. | Not built. |
| Phone breakpoint 760 px (mockup line 213) | Tailwind v4 defaults: `md` = 768, `xl` = 1280. The navbar switches at `md` (`components/layout/Navbar.tsx:58`, `:99`). | "Phone" = below `md` (768). 760–767 px gets the phone layout; nothing is lost in those 8 px. |
| Nav stand-in: Team Tiers, Team Stats, Matchups, Passing, Receiving, Rushing, Run Gaps, Glossary (mockup line 285) | The real row has nine links, with Trends and Compare (`components/layout/Navbar.tsx:10-20`); `.claude/CLAUDE.md:37` is also stale. A test pins the order and the `gap-3` / `xl:gap-6` spacing "measured" for nine labels (`__tests__/components/Navbar.test.tsx:32-37`, `:53-60`). | A tenth label needs a new measurement; §9 says what to measure and what to change if a label wraps. |
| Ladder numerals in Barlow Condensed in 104 px / 70 px columns | The site loads Inter (`app/layout.tsx:12`) and Press Start 2P (`app/fonts.ts:4-8`) only. | Inter 800 with `tabular-nums`, at a smaller size so the longest value fits the same columns (§8.4). |
| "The games read fails … the pickers still render" (decisions.md, `/matchup`) | `/matchup` reads no `searchParams`, so with only `revalidate = 3600` it would be a true ISR page, and the house rule forbids an ISR page swallowing a data error into a rendered page (`.claude/CLAUDE.md:42`; the 2026-09-14 homepage incident cached an empty page for an hour). | decisions.md is followed: `/matchup` is rendered per request (`export const dynamic = "force-dynamic"`), so a degraded render is never stored, and the games read may degrade with a log line, the pattern `/team` uses for next season's schedule (`lib/data/team-hub.ts:133-138`). See S1 in §13. |
| `?season=` handling "as on the other pages" (notes.md) | The six season pages and `/compare` still parse `?season=` with a bare `parseInt` (`lib/utils.ts:37`; `memory/MEMORY.md` read resilience follow-up M6), so "2025abc" and "2025.9" are 2025 there. | The new route is strict (§4.1 step 3) and never hands a raw value to `canonicalSeason`. |
| Player EPA printed to 3 decimals (mockup `fEpa`) | Player EPA is 2 decimals on the boards and the Game Log (`lib/stats/compare.ts:119`; `memory/MEMORY.md` box score section). Team EPA is 3 (`lib/stats/team-stats.ts:263`). | Team EPA 3 decimals, player EPA 2. |
| Ladder group names "Running", "The ball", "By down" (mockup lines 312-318) | — | decisions.md wins: Overall / Passing / Rushing / Turnovers / Downs. |

Also true and relied on below:

- All three season tables hold ONE row per player-season with full-season totals, under one team: a quarterback's is the team with most of his pass attempts (`scripts/ingest.py:597-601`), a running back's the team with most of his carries (`:963-969`), a receiver's the team with most of his targets (`:1172-1178`). So a player traded mid-season is listed with his old team (with numbers that include his new team's games) until he passes the old count. The team page filters season rows by `team_id` (`lib/data/team-hub.ts:148-149`) and has the same behaviour; the matchup does the same and says so in M10.
- `rb_season_stats.success_rate` is 0–1 (`lib/stats/compare.ts:164`); `cpoe` is already in points (`lib/stats/compare.ts:120`).
- The receiver table carries running backs too, so "WR/TE" must filter on `position`.
- `/api/revalidate` lists paths one by one (`app/api/revalidate/route.ts:11-23`); a new route family is not covered until it is added.
- Reading `searchParams` makes a route render on every request; `revalidate = 3600` then governs only Next's fetch data cache (the `/team` trap in `memory/MEMORY.md`).

## 3. The 13 lines, the ranks and the edge rule

### 3.1 The stat list and which way is "better"

All from the Team Stats / Team Radar family (box-score play filter). Offense = the team's own rows; defense = its opponents' rows (what it allowed), exactly as `buildTeamStats` and `buildTeamRadar` do.

| # | Group | Label | Value and rank come from | Format | Offense: better is | Defense: better is | Word under the defense rank |
|---|---|---|---|---|---|---|---|
| 1 | Overall | EPA / play | Team Stats `epa` | EPA | higher | lower | allowed |
| 2 | Overall | Success rate | Team Stats `sr` | pct | higher | lower | allowed |
| 3 | Passing | Pass EPA / play | Team Stats `pass_epa` | EPA | higher | lower | allowed |
| 4 | Passing | Pass success rate | radar spoke `pass_sr` | pct | higher | lower | allowed |
| 5 | Passing | Explosive pass rate | radar spoke `expl_pass` | pct | higher | lower | allowed |
| 6 | Passing | Sack rate | radar spoke `sack` | pct | **lower** (sacks taken) | **higher** (sacks made) | made |
| 7 | Rushing | Rush EPA / play | Team Stats `rush_epa` | EPA | higher | lower | allowed |
| 8 | Rushing | Run success rate | radar spoke `rush_sr` | pct | higher | lower | allowed |
| 9 | Rushing | Explosive run rate | radar spoke `expl_rush` | pct | higher | lower | allowed |
| 10 | Rushing | Stuff rate | radar spoke `stuff` | pct | **lower** (stuffs taken) | **higher** (stuffs made) | made |
| 11 | Turnovers | Turnover rate vs takeaway rate (short: Turnovers) | radar spoke `to` | pct | **lower** | **higher** | takeaways |
| 12 | Downs | Early downs EPA (1st–2nd) | Team Stats `early_epa` | EPA | higher | lower | allowed |
| 13 | Downs | Late downs EPA (3rd–4th) | Team Stats `late_epa` | EPA | higher | lower | allowed |

One rule covers the table: each stat has `offHigherBetter`; defense is the reverse on every line (the radar's own rule, `higherIsBetter`, `lib/stats/team-radar.ts:94-96`).

**Lines 4, 5, 8, 9 read the radar spoke, not Team Stats (S2).** The four numbers are the same to the digit (team radar spec §3; an existing test asserts it for all 32 teams on both sides). Reading them from the radar model means the rank in the ladder and the rank on the radar's spoke label are the same object, so they can never disagree on one page (the radar drops a rate outside 0–1 as missing; Team Stats does not). A new test asserts the four values still equal `buildTeamStats`' on the golden fixture. So six lines are ranked by the new function below and seven come ranked from `buildTeamRadar`.

### 3.2 Ranks

Competition ranking: 1 = best, ties share the better place, the next place is skipped. Same rule, tie tolerance and pool as `lib/stats/team-radar.ts`:

- **Tie:** two values closer than `RADAR_TIE_EPSILON` (1e-9, `lib/stats/team-radar.ts:235`) are the same value. A tied rank prints "T-" (`spokeRankLabel`, `:482-485`).
- **Algorithm (the radar's pairwise count, `lib/stats/team-radar.ts:301-314`, not sort-then-group):** for a team in the pool, `rank = 1 + the number of pool values that are better than its own by at least RADAR_TIE_EPSILON`; `tied = some OTHER pool value is within RADAR_TIE_EPSILON of its own`; `pool = the number of pool values`. Because the tie test is a tolerance, a sort-then-group version gives different answers on a chain of near-ties, so it must not be used.
- **Pool:** teams that have played (a row of their own, `off.gp > 0`), have at least one game on the side being ranked, and have a value. A team with only an opponent's row is not in any pool.
- A team outside the pool has `rank: null`.

### 3.3 The edge rule (constants in one place: `lib/stats/matchup.ts`)

```ts
export const EDGE_LEAN_MIN_GAP = 5;        // 5–12 places apart: lean
export const EDGE_CLEAR_MIN_GAP = 13;      // 13+: clear edge
export const EDGE_STRENGTH_MAX_RANK = 8;   // both units 8th or better
export const EDGE_WEAKNESS_MIN_RANK = 25;  // both units 25th or worse
export const EDGE_NAMED_MIN_POOL = 25;     // S3: named even-labels only in a pool this large
export const EDGE_TUG_SCALE = 31;          // marker travel: 32 teams − 1
```

`gap = defense rank − offense rank`. Positive = the offense ranks higher. `places = |gap|`.

| Case | Result |
|---|---|
| either rank is null (no value, team has not played, pool of 0) | side `na`, tag "Not enough data", hollow grey marker in the middle, no bar, no red; left out of the spoke count |
| `places` 0–4 | side `even`. Tag: "Strength on strength" when both ranks ≤ 8; "Weakness on weakness" when both ranks ≥ 25; otherwise "Even". Hollow grey marker, no red |
| `places` 5–12 | **lean** to the better-ranked unit (gap > 0 offense, gap < 0 defense). Red marker and bar |
| `places` ≥ 13 | **clear edge** to the better-ranked unit. Red marker and bar |

Exact boundaries (each is a test):

- gap +4 → even; gap +5 → lean, offense. gap −4 → even; gap −5 → lean, defense.
- gap +12 → lean; gap +13 → clear edge. Same for −12 / −13. gap ±31 → clear edge.
- gap 0 → even (verdict reads "same rank").
- Tied ranks use the shared place: offense T-3rd against defense 8th is gap +5, a lean.
- 8th against 8th → "Strength on strength"; 8th against 9th → "Even"; 4th against 8th → "Strength on strength"; 4th against 9th (gap 5) → lean, never a named even.
- 25th against 25th, 25th against 29th → "Weakness on weakness"; 24th against 25th → "Even".
- **Small pools (S3).** The two named labels are used only when BOTH cells' pools are at least `EDGE_NAMED_MIN_POOL` (25, the smallest pool that has a 25th place). Otherwise an even row is plain "Even". Without this, on the first Sunday of a season (8 to 24 teams played) every team would be "top 8" in a pool of 8. The lean / clear cut-offs stay 5 and 13 in any pool.
- The two ranks may come from pools of different size (a spoke with a zero denominator for one team); the gap is still rank minus rank.

**Tug marker.** `position% = clamp(50 − (gap / EDGE_TUG_SCALE) × 50, 0, 100)`. The offense is on the left, so a positive gap slides the marker left. The red bar runs from 50% to the marker. Even and `na` rows: marker at its computed position for even (within ±6.5% of the middle), at 50% for `na`; hollow grey; no bar.

**Verdict line under the marker** (constants / functions in `lib/stats/matchup.ts`, each tested):

| Edge | Text |
|---|---|
| lean | "{OFF} offense by 7 places" / "{DEF} defense by 7 places" |
| clear | "{OFF} offense by 24 places · clear edge" |
| even, places ≥ 1 | "{tag} · 2 places apart" ("1 place apart") |
| even, places 0 | "{tag} · same rank" |
| na | "Not enough data" |

`{OFF}` / `{DEF}` are team ids (BUF, LA).

### 3.4 States the pure builder returns

| # | Condition (first match wins) | State | What the page shows |
|---|---|---|---|
| 1 | fewer than `RADAR_MIN_TEAMS` (8, `lib/stats/team-radar.ts:113`) teams have played | `small-pool` | header, players, and ONE sentence in place of radars and ladders: "Matchup ranks start once 8 teams have played this season. Until then there are too few teams to rank against." No rank is printed anywhere (S4) |
| 2 | otherwise | `ready` | everything; per team and per side the rules below |

Inside `ready`:

- **A team with zero games** (no row of its own): the page renders. Its values print "—", its ranks "—", every ladder row it is part of is `na`, and a sentence sits above the radars: "The {Team} have not played a {season} game yet." (`radarNoGamesNote`'s first sentence; the radar's second sentence does not apply here.) The other team's numbers still print. Both teams with zero games: both sentences.
- **An overlay radar** is drawn only when BOTH series can be drawn (`canDrawRadar`, at least `RADAR_MIN_SPOKES` = 4 real spokes each, `lib/stats/team-radar.ts:355-357`). Otherwise that pane shows "Not enough of these rates are available yet to draw this radar." and no count line. The ladder below is unaffected.
- A rate the radar builder rejected (outside 0–1) is a missing spoke and an `na` row; the page logs `model.rejected` once with `console.error`, as the team page does (`app/team/[team_id]/page.tsx:130-133`).

## 4. Routes, validation and redirects

### 4.1 `/matchup/[away]/[home]`

`app/matchup/[away]/[home]/page.tsx`. `export const revalidate = 3600;` no `generateStaticParams`. It reads `searchParams`, so it renders on every request; the hour applies to its Supabase reads in Next's data cache. **No `loading.tsx` anywhere under `app/matchup/`**: with one, a redirect becomes a meta refresh and a 404 becomes a soft 200 (the player page's known debt, `memory/MEMORY.md` "Soft 404s"). A second reason, the compare card's chaos finding COST-1 (`docs/superpowers/specs/2026-10-09-compare-card-design.md:486`): links into this route carry `prefetch={false}` (§9), and a prefetch of a dynamic route reads nothing only while the route has no `loading.tsx`; adding one later would make every prefetch render the whole page.

Checks, in order. Steps 1–4 read nothing.

| # | Check | Result |
|---|---|---|
| 1 | Each segment passes `parseMatchupTeamId` (two or three ASCII letters, tested BEFORE upper-casing; §7.1, the same rule as `parseRadarTeamId`, `lib/stats/team-radar.ts:630-632`) and `getTeam(id)` finds it (`lib/data/teams.ts:45-47`) | else `notFound()` |
| 2 | The two ids differ | else `notFound()` |
| 3 | `?season=`: `parseMatchupSeason(raw)`: a single string of exactly four digits, 1999–2100 (`SEASON_PARAM_MIN/MAX`, `lib/stats/team-stats.ts:402-403`). A repeated key (an array), "2025abc", "2025.9", " 2025", "" are all absent. `?ball=` through `parseBall` | absent → the default season |
| 4 | Each raw segment already equals its upper-case id | else `permanentRedirect()` (308) to `/matchup/AWAY/HOME` + the kept query |
| 5 | Seasons list (memoised). Empty on a real database → throw (`hasNoDatabase`, `lib/supabase/server.ts:34-37`) | a requested season not in the list → the default season (decisions.md; NOT the share cards' 404) |
| 6 | The season's rows, games, player tables, slug list (§6) | a failed core read throws → `app/matchup/error.tsx` |
| 7 | Order check, only when the games read succeeded: no game in the season with `away_team = AWAY and home_team = HOME`, and at least one with the two reversed | `redirect()` (307) to `/matchup/HOME/AWAY` + the kept query, with `ball` flipped |
| 8 | — | render |

Rules that go with the table:

- **Kept query** = `season` only when step 3 accepted it, and `ball=home` only when it was exactly that. Everything else is dropped. Rebuilt from the validated values, never echoed. The 308 of step 4 reads nothing, so it keeps any season step 3 accepted (1999–2100). The 307 of step 7 comes after the seasons read, so its target is built with `matchupHref(HOME, AWAY, { season: resolvedSeason, defaultSeason, ball })`: a season that is not in the list (`?season=2031`, the page shows the default) or that is the default is dropped there.
- **Step 7 is a 307, not a 308**: which order is "scheduled" depends on the season. `ball` flips (`home` ↔ absent) so the visitor keeps looking at the same team with the ball.
- Both orders exist (division rivals): no redirect either way; each URL shows its own game.
- No game between the two in that season: no redirect; the order asked for stands.
- Games read failed: no redirect, logged; the page renders in the order asked for with no date and no records.
- `/matchup/BUF` is a real page file, `app/matchup/[away]/page.tsx`, that only calls `notFound()` and reads nothing (the `/card/team/[team_id]` pattern, `app/card/team/[team_id]/page.tsx:7`), with a route test as the proof; route precedence is not reasoned about (team radar review M11). `/matchup/BUF/LA/x` has no file to test; PR 2's local check requests it and expects a 404 (§12).
- A look-alike letter ("ſf", "pıt") fails step 1 (the reason the id rule checks before upper-casing).

Examples:

| Request | Answer |
|---|---|
| `/matchup/BUF/LA` | 200 |
| `/matchup/buf/La?season=2026&x=1` | 308 → `/matchup/BUF/LA?season=2026` |
| `/matchup/BUF/BUF`, `/matchup/buf/BUF` | 404 (no redirect first) |
| `/matchup/BUF/LAR`, `/matchup/BUF/XX`, `/matchup/BUF/L.A` | 404 |
| `/matchup/LA/BUF` when the only 2026 game is BUF at LA | 307 → `/matchup/BUF/LA?ball=home` |
| `/matchup/LA/BUF?ball=home`, same case | 307 → `/matchup/BUF/LA` |
| `/matchup/NE/BUF` and `/matchup/BUF/NE` (two games) | 200 each |
| `/matchup/BUF/LA?season=1998`, `?season=abc`, `?season=2031` (not in the list) | 200, default season |
| `/matchup/BUF/LA?season=2025` (listed, no `team_game_stats` rows) | 200, noindex, the "uncovered" message (§10) |

### 4.2 `/matchup`

`app/matchup/page.tsx`. `export const revalidate = 3600;` and `export const dynamic = "force-dynamic";`. It reads no `searchParams`, so without the second export it would be a true ISR page and a render with a failed games read would be stored for an hour. Rendered per request, it may degrade honestly (§6.3, S1). Always the newest stats season. Static `metadata` (no read in metadata). Whether Next's data cache still keeps a `force-dynamic` page's fetches is not relied on: the 60 s memo is what bounds its reads (§6.5).

**Both exports stay, and a code comment beside them says why.** They look contradictory, but a page with no `revalidate` had its Supabase reads kept for a year (`/compare`, `memory/MEMORY.md` "What Next already caches"), so the hour is the safety net if `force-dynamic` does not opt the reads out. The index test asserts both are present so nobody tidies one away.

**The per-request claim is verified on Vercel before it is trusted (§12).** This stack has surprised twice (`/game` uncached for an unknown reason; `dynamic = "force-dynamic"` not fixing the frozen sitemap route handler in 14.2.35). If the preview shows `/matchup` being cached, the games read on `/matchup` becomes core (it throws) until that is solved.

### 4.3 `?ball=`

- Values: `home`, or absent (= away, the default). Anything else is treated as absent. Never part of the canonical.
- The server renders BOTH ladders in the HTML at every width. At `xl` and up both are visible side by side and there are no tabs. Below `xl` the two tabs show ("WHEN {AWAY} HAS THE BALL" / "WHEN {HOME} HAS THE BALL") and only the selected ladder is visible (the other has `hidden xl:block`).
- The first paint comes from the server (`initialBall` prop from `searchParams`), so a `?ball=home` link opens on the right ladder with no flash.
- A tab press sets local state and calls `window.history.replaceState(null, "", url)`: the address changes, nothing is re-fetched, and the page does not scroll. (The leaderboards use `router.push` because their state changes what the server renders; here it changes only which block is visible, and a router call would re-run the whole dynamic page.) No `useSearchParams`, so no Suspense boundary is needed.
- The radars do not react to the toggle: both are always shown.

### 4.4 Metadata (`generateMetadata` on the matchup page)

- Runs steps 1–4 of §4.1 itself, reading nothing. An invalid pair returns `{ title: { absolute: "Matchup Not Found — Yards Per Pass" }, robots: { index: false, follow: true } }` (the share page's `NOT_FOUND` pattern, `app/card/team/[team_id]/[side]/page.tsx:61`, `:131-132`). A request the page will redirect returns the same plain object (the redirect happens in the page body). That covers both redirects: step 4 (decided with no read) and step 7 (`swap: true` from the loader), so a URL that is about to 307 never gets an "A at B" title for the wrong order.
- Otherwise uses the same loader as the body (everything is memoised, so it costs no second read). A failed core read throws here too (read resilience 1A).
- Title: "{Away name} at {Home name}: Team Matchup {season}" when the pair has a game in that order in the season, else "{Away name} vs {Home name}: Team Matchup {season}". The layout's template adds " — Yards Per Pass" (`app/layout.tsx:16-19`).
- Description: "{AWAY} offense against the {HOME} defense, and {HOME} offense against the {AWAY} defense, by league rank through Week {w}: EPA per play, success rate, explosive plays, sacks, stuffs and turnovers." ("through Week {w}" dropped when the week is unknown.)
- Canonical: `${base}/matchup/AWAY/HOME`, plus `?season=` only for a real season other than the newest. `canonicalSeason` (`lib/utils.ts:36-40`) is called with the VALIDATED value, `canonicalSeason(requested === null ? undefined : String(requested), seasons)`, as `app/card/team/[team_id]/[side]/page.tsx:113` does. Handing it the raw string would let `?season=2025.9` (the page shows the newest season) produce a canonical naming 2025, because the helper parses with a bare `parseInt`.
- `robots`: indexable only when the state is `ready` AND the pair has a game in this order in the season. Any other pair or state is `noindex, follow` (S5: 992 ordered pairs, most of them never played, would be thin pages).
- No `openGraph.images`, no `twitter.images`.

`/matchup`: title "Team Matchups", a fixed description, canonical `${base}/matchup`.

## 5. Data flow

```
data_freshness ─ getSeasonWeeksCached() ───────────────┐  (season list, default season)
team_game_stats (season, 35 cols) ─ getMatchupRowsCached(season) ──┬─ buildTeamStats(rows)
                                                                   └─ buildTeamRadar(rows, season)
games (season) ─ getSeasonGamesCached(season) ─ findPairGame / teamRecord / currentSlate
qb / rb / receiver season tables ─ getCompareTableCached(group, season) ─┐
player_slugs ─ getPlayerSlugIndexCached() ───────────────────────────────┴─ pickMainPlayers
                                   │
                    buildMatchup(...)  (pure, server)  →  MatchupModel (plain data, null never NaN)
                                   │
        app/matchup/[away]/[home]/page.tsx  →  server components + one small "use client" toggle
```

## 6. Reads

### 6.1 New loaders

| Loader | File | What |
|---|---|---|
| `MATCHUP_COLUMNS` | `lib/data/matchup.ts` (new, server-only) | `TEAM_STATS_COLUMNS` (30) plus `attempts`, `sacks`, `total_drives`, `designed_runs`, `stuffed_runs` = 35. Built as a literal list, with a test that it equals the union of the two existing lists (so a column added to either is noticed). Its own numeric-parse list: `TEAM_GAME_NUMERIC.filter(c => MATCHUP_COLUMNS.includes(c))` (never the full list; team radar review M1). All 35 columns exist in production today. |
| `getMatchupRows(season, { signal? })` | same | `fetchAllRows("team_game_stats", MATCHUP_COLUMNS.join(","), { season }, { signal: signal ?? boxScoreDeadline(), order: ["game_id", "team_id"] })`; rejections rethrown through `queryError("matchup rows for {season}", err)`. At most 544 rows, one page. |
| `getMatchupRowsCached(season)` | same | `memoised(rowsMemo, season, …)`. Call only with a season already checked against the seasons list, so the keys stay bounded. |
| `getSeasonGames(season, signal?)` | `lib/data/games.ts` | `fetchAllRows("games", "game_id,season,game_type,week,gameday,weekday,gametime,home_team,away_team,home_score,away_score", { season }, { order: ["game_id"], signal })` → `GameRecord[]` (the existing type, `lib/data/games.ts:246-260`): `game_type` through `normalizeGameType`, scores through `score()` (null until played, never NaN). A row with a non-string or empty `home_team` / `away_team`, `home_team === away_team`, or an unusable week is dropped and logged once with `console.warn` (one bad row must not fail the page; `weekFor`'s throw is for the single-game page). Throws through `queryError`. |
| `getSeasonGamesCached(season)` | `lib/data/matchup.ts` | `memoised(gamesMemo, season, …)`. |
| `loadMatchup(awayId, homeId, requestedSeason \| null)` | `lib/data/matchup.ts` | The one loader for the page and its metadata (§6.3). |
| `loadMatchupIndex()` | `lib/data/matchup.ts` | Seasons (core: a failed read throws, as does an empty list on a real database), then the newest season's games (may degrade: logged, `slate: null`, `gamesAvailable: false`) → `{ season, slate, gamesAvailable }`. |

### 6.2 Changed, one export each (no behaviour change)

`lib/data/compare-card.ts`: export `getSeasonWeeksCached()`, `getPlayerSlugIndexCached()` and `getCompareTableCached(group, season)`, each a one-line wrapper over the existing private memo call (`:179-180`, `:164-166`). The compare card keeps calling the same memos, so a matchup view warms the compare card and the reverse. `compareCardMemoKeys()`'s test still holds: no new key shape.

### 6.3 `loadMatchup`, in order

1. Start `getSeasonWeeksCached()` and `getPlayerSlugIndexCached()` together (they do not depend on each other; attach a no-op `.catch` to the slug read as `compare-card.ts:184` does).
2. Await the seasons. Empty on a real database → throw. Resolve the season (§4.1 step 5). `isLatestSeason = season === seasons[0]`.
3. One wave, all started together: `getMatchupRowsCached(season)`, `getSeasonGamesCached(season)`, the three `getCompareTableCached` calls (QB, RB, WR), and the slug list from step 1.
4. Core vs may-degrade:

| Read | Class | When it fails |
|---|---|---|
| seasons | core | throw |
| `team_game_stats` rows | core | throw |
| games | may degrade | `console.error`; header shows no week, date or records; no order redirect; `gamesAvailable: false` |
| QB / RB / receiver tables | may degrade, as one block | `console.error`; the Main players section shows "Main players are unavailable right now." If any one of the three failed, the whole section does (a lineup with a missing position row would look like a team with no running backs) |
| slug list | may degrade | `console.error`; names render unlinked (the team hub's rule, `lib/data/team-hub.ts:139-142`) |

5. **Empty rows.** If the row read succeeds with 0 rows: no seasons → throw; the newest season → throw; a season the box score probe says is covered (`getBoxScoreSeasonsCached`, called only on this path) → throw; otherwise `state: "uncovered"` with `firstSeason` (the rule and wording pattern of `getTeamStatsSeason`, `lib/data/team-stats.ts:65-80`). A failed probe on this path throws.
6. An empty QB / RB / receiver table for a listed season on a real database is treated as that read failing (the compare card's rule, `lib/data/compare-card.ts:116-120`).
7. Return plain data: `{ state, season, defaultSeason, isLatestSeason, swap, game, records, model, lineup, playersAvailable, gamesAvailable }`.

No React `cache()`: the memo already gives metadata and body the same reads, and `cache()` would force the test stand-in on every test that imports the page.

### 6.4 Pure schedule rules (in `lib/stats/matchup.ts`)

Both rules below must survive a **stale rescheduled row**: a cross-week reschedule gets a new `game_id` and the old row is never deleted (`memory/MEMORY.md`, team pages). The stale row never gets scores, so it stays "unplayed" for the rest of the season. Neither rule needs today's date.

- `findPairGame(games, awayId, homeId)` → `{ game: GameRecord | null, swap: boolean }`. Candidates = games with exactly these two teams. In the order asked for:
  1. **Drop stale rows:** an unplayed candidate is ignored when a played candidate of the same pair and order has a later-or-equal `gameday` or a higher `week`.
  2. Of the unplayed candidates left, take the one with the latest `gameday`, then the larger `game_id`. (For one pair in one order, two unplayed rows are always a reschedule, and the stale row keeps the old date.) A null or unreadable `gameday` sorts before any date, so a dated row wins over an undated one.
  3. If none is left, the latest played one (latest `gameday`, null before any date; then the higher `week`; then the larger `game_id`).
  `swap = true` only when there is no candidate at all in the order asked for and at least one in the other order.
- `teamRecord(games, teamId)` → `{ wins, losses, ties }` over played REG games; printed with `formatRecord` (`lib/stats/box-score.ts:178`). Shown as "3-1 · away" / "· home" only when `gamesAvailable`. This is the box score page's rule (`recordThroughWeek`, `lib/stats/box-score.ts:166`), counted from `games`; the team page's band prints `team_season_stats` wins and losses (`ScheduleSection.tsx:128-134`), so the two can differ for a few hours after a game (scores land before stats, or the reverse).
- `currentSlate(games)` → let `P` = the highest week that has at least one played game (0 if none). The slate is the lowest week `W >= P` that has an unplayed game (both scores null): every game of that week (played ones too, e.g. Thursday's), sorted by `gameday`, `gametime`, `game_id`. Mid-week with Thursday played, `P` is the current week, so it is still chosen; a stale row in an earlier week is skipped. Label "Week 5" for REG, the round name for a playoff week (`normalizeGameType`). No such week → `null`.
- `formatKickoff(game)` → "Sun Oct 11 · 1:00 PM ET"; a played game → "Sun Sep 27 · Final: BUF 27, LA 20" (away first); missing parts are dropped. Dates are parsed by hand from `YYYY-MM-DD` (never `new Date(string)`, the `ScheduleSection.tsx:66-76` trap).

### 6.5 Read count per request

| Page | Cold instance | Warm (within the memo's minute) | Per pair |
|---|---|---|---|
| `/matchup/[away]/[home]` | 8 PostgREST requests: seasons 1, `team_game_stats` 1, `games` 1, QB 1, RB 1, receivers 1, `player_slugs` 2 pages. Two waves. (+1 probe request per covered-season candidate only on the empty-rows path.) | 0 | **0**: every memo key is `seasons`, `slugs`, a season, or `GROUP:season`. Nothing is keyed by team or pair, so walking all 992 pairs costs the same 8 requests. |
| `/matchup` | 2: seasons, games | 0 (at most 2 a minute per instance, whatever the traffic) | — |

The team page makes about 14. Behind the memo, the matchup page's reads are also in Next's data cache for up to an hour (`revalidate = 3600`). A failed read is remembered for ten seconds (`MEMO_FAILURE_TTL_MS`), so an outage is one attempt per key per ten seconds. Every read has a 5 s limit: the row read passes `boxScoreDeadline()`, the others get the client's own (`lib/supabase/timeout.ts`). Worst case for a cold failing page: about 10 s (two waves; the slug list's two pages are serial). That is the shape `/card` and `/game` already have; no `maxDuration` is recorded in the repo, so the plan's function limit is confirmed before PR 2 merges (§12).

`app/api/revalidate/route.ts` gains `revalidatePath("/matchup", "layout")`. It does not clear the in-process memo (up to a minute), the accepted behaviour of the share cards.

## 7. Pure functions and types

### 7.1 `lib/stats/matchup-links.ts` (new; imports NOTHING)

For browser code (the schedule tiles, the toggle, the picker), so they never pull the stat modules into a client bundle.

```ts
export type Ball = "away" | "home";
export function parseBall(raw: string | string[] | null | undefined): Ball;          // "home" exactly, else "away"
export function parseMatchupSeason(raw: string | string[] | null | undefined): number | null;
export function matchupHref(awayId: string, homeId: string,
  opts?: { season?: number | null; defaultSeason?: number | null; ball?: Ball }): string;
// "/matchup/BUF/LA", "?season=" only when season is a positive integer other than defaultSeason
// (the playerHref rule, lib/utils.ts:49-52), "ball=home" only for home; season before ball.
// parseMatchupSeason is §4.1 step 3.
export function flipBall(ball: Ball): Ball;
/** A team segment, upper-cased: /^[A-Za-z]{2,3}$/ tested BEFORE upper-casing, else null. Whether it is a real team is the caller's getTeam look-up. */
export function parseMatchupTeamId(raw: string | null | undefined): string | null;
```

`parseMatchupTeamId` is the rule of `parseRadarTeamId` (`lib/stats/team-radar.ts:630-632`) written again here, because browser code may not import `team-radar.ts` (§8 bundle rule) and this module may import nothing. The route's step 1, `ScheduleSection` and `MatchupPicker` all use it. A test holds the two functions together over a table that includes `ſf`, `pıt`, `buf`, `BUF`, `L.A`, `""` and `null`.

### 7.2 `lib/stats/matchup.ts` (new; pure)

May import `lib/stats/team-stats`, `lib/stats/team-radar`, `lib/stats/box-score`, `lib/stats/formatters`, `lib/stats/percentiles`, `lib/stats/matchup-links`, `lib/utils` (for `playerHref`), `lib/data/teams`, and types. Nothing else from `lib/data`, no React, Next or Supabase (a test checks, as for `team-radar.ts`).

```ts
export interface RankedValue {
  value: number | null;
  rank: number | null;   // competition rank, 1 = best
  tied: boolean;
  pool: number;
}

/** Competition ranking by the pairwise count of §3.2 (rank = 1 + values better by at least RADAR_TIE_EPSILON). `values` holds only pool members. */
export function competitionRank(
  values: ReadonlyArray<{ id: string; value: number | null }>,
  higherIsBetter: boolean,
): Map<string, RankedValue>;

/** One Team Stats number ranked for every team on one side. Pool: off.gp > 0, t[side].gp > 0, finite value. */
export function rankTeamStat(
  model: TeamStatsModel,
  field: "epa" | "pass_epa" | "rush_epa" | "sr" | "early_epa" | "late_epa",
  side: "off" | "def",
  offHigherBetter: boolean,
): Map<string, RankedValue>;

export type MatchupStatKey =
  | "epa" | "sr" | "pass_epa" | "pass_sr" | "expl_pass" | "sack"
  | "rush_epa" | "rush_sr" | "expl_rush" | "stuff" | "to" | "early_epa" | "late_epa";
export type MatchupGroup = "Overall" | "Passing" | "Rushing" | "Turnovers" | "Downs";

export interface MatchupStat {
  key: MatchupStatKey;
  group: MatchupGroup;
  label: string;
  shortLabel?: string;
  source: "team-stats" | "radar";
  format: "epa" | "pct";
  offHigherBetter: boolean;
  defWord: "allowed" | "made" | "takeaways";
}
export const MATCHUP_STATS: readonly MatchupStat[];   // the 13 rows of §3.1, in order

export type EdgeSide = "off" | "def" | "even" | "na";
export interface Edge {
  side: EdgeSide;
  level: 0 | 1 | 2;                 // 0 even / na, 1 lean, 2 clear
  gap: number | null;               // defense rank − offense rank
  places: number | null;
  tag: "Even" | "Strength on strength" | "Weakness on weakness" | "Lean" | "Clear edge" | "Not enough data";
}
export function edgeOf(
  off: Pick<RankedValue, "rank" | "pool"> | null | undefined,
  def: Pick<RankedValue, "rank" | "pool"> | null | undefined,
): Edge;
export function tugPosition(edge: Edge): number;                       // 0–100
export function verdictText(edge: Edge, offId: string, defId: string): string;

/** One ladder line, already formatted: client components print strings only. */
export interface LadderRow {
  key: MatchupStatKey;
  group: MatchupGroup;
  label: string; shortLabel: string;
  offValue: string; offRank: string;        // "+0.195", "2nd" / "T-2nd of 31" / "—"
  defValue: string; defRank: string; defWord: string;
  edge: Edge; tug: number; verdict: string;
}
export interface LadderModel { offId: string; defId: string; rows: LadderRow[] }   // always 13 rows

export interface OverlaySpoke {
  key: RadarAxisKey; label: string;          // "Explosive pass", "Pass success", "Sacks", "Turnovers", "Stuffs", "Run success", "Explosive run"
  rankLine: string;                          // "2nd v T-14th", "2nd v —"
  gapBar: boolean;                           // both ranks present and places ≥ EDGE_LEAN_MIN_GAP
}
export interface OverlayModel {
  offId: string; defId: string;
  off: RadarSideModel | null;                // null: that team has not played
  def: RadarSideModel | null;
  drawn: boolean;                            // both sides pass canDrawRadar
  spokes: OverlaySpoke[];                    // RADAR_AXES order
  tally: { off: number; def: number; even: number; ranked: number } | null;  // null when not drawn
}

export interface MatchupSide { ladder: LadderModel; overlay: OverlayModel }
export interface MatchupModel {
  state: "ready" | "small-pool";
  season: number;
  teamsPlayed: number;
  throughWeek: number | null;                // buildTeamRadar's (max week in the rows), never a second read
  away: { id: string; games: number };       // games = rows of its own
  home: { id: string; games: number };
  awayBall: MatchupSide | null;              // away offense v home defense; null in small-pool
  homeBall: MatchupSide | null;
  rejected: string[];                        // buildTeamRadar's, for the page's one log line
}
export function buildMatchup(input: {
  rows: ReadonlyArray<Record<string, unknown>>;
  season: number;
  awayId: string;
  homeId: string;
}): MatchupModel;
```

`buildMatchup` calls `buildTeamStats(rows)` once and `buildTeamRadar(rows, season)` once (existing, unchanged), ranks the six Team Stats numbers on both sides with `rankTeamStat`, and assembles both sides. `buildTeamStats` does not filter by season or de-duplicate; `buildMatchup` hands it the rows `buildTeamRadar` would keep (same season, first of a repeated `(game_id, team_id)`) by applying that same filter first, as a small private helper, so the two models stand on the same rows. That helper repeats private code (`lib/stats/team-radar.ts:251-264`), so a test holds the two together: `buildTeamRadar(rows, season).rowCount` equals the helper's row count on the fixture and on rows with other seasons, repeated keys and non-objects mixed in.

Players and schedule:

```ts
export interface LineupStat { label: string; value: string }
export interface LineupPlayer {
  slot: "QB" | "RB" | "REC";
  pos: string;                               // "QB", "RB", "WR", "TE"
  playerId: string;
  name: string;                              // full name from the slug list, else the season row's name
  href: string | null;                       // playerHref(slug, season, defaultSeason); null with no slug
  stats: LineupStat[];                       // four, already formatted
}
export function pickMainPlayers(input: {
  teamId: string; season: number; defaultSeason: number;
  qbs: readonly QBSeasonStat[]; rbs: readonly RBSeasonStat[]; receivers: readonly ReceiverSeasonStat[];
  slugByPlayerId: ReadonlyMap<string, { slug: string; player_name: string }>;
}): LineupPlayer[];                           // up to 7: QB, RB, RB, REC ×4
export function pairLineups(away: LineupPlayer[], home: LineupPlayer[]):
  { pos: string; away: LineupPlayer | null; home: LineupPlayer | null }[];   // always 7 rows

export function findPairGame(games: readonly GameRecord[], awayId: string, homeId: string): { game: GameRecord | null; swap: boolean };
export function teamRecord(games: readonly GameRecord[], teamId: string): { wins: number; losses: number; ties: number };
export function currentSlate(games: readonly GameRecord[]): { label: string; games: GameRecord[] } | null;
export function formatKickoff(game: GameRecord): string;
```

### 7.3 Player selection (exact)

Rows are the season table's rows whose `team_id === teamId` (strict equality on the canonical id).

| Slot | Table | Filter | Order (first wins) | Take |
|---|---|---|---|---|
| QB | `qb_season_stats` | `dropbacks > 0` | `dropbacks` desc, `attempts` desc, `player_id` asc | 1 |
| RB | `rb_season_stats` | `position` is `RB` or `FB`; `carries > 0` | `carries` desc, `rushing_yards` desc, `player_id` asc | 2 |
| WR/TE | `receiver_season_stats` | `position` is `WR` or `TE`; `targets > 0` | `targets` desc, `receiving_yards` desc, `player_id` asc | 4 |

A non-finite sort value counts as 0. A repeated `player_id` in a table counts once (first kept). Fewer players than the slot wants → the remaining rows are empty (`null`), never a crash. The centre label of a paired row is the shared position, or "WR/TE" style "{a}/{b}" when the two differ, or the one present.

| Slot | Stat line (label → column → format) |
|---|---|
| QB | EPA / dropback → `epa_per_db` → signed 2 dp · CPOE → `cpoe` → signed 1 dp · Pass yards → `passing_yards` → whole number with thousands separator · TD–INT → `touchdowns`–`interceptions` |
| RB | Carries → `carries` · Rush yards → `rushing_yards` · EPA / carry → `epa_per_carry` → signed 2 dp · Success → `success_rate` (0–1) → pct 1 dp |
| WR/TE | Targets → `targets` · Rec yards → `receiving_yards` · TD → `receiving_tds` · EPA / target → `epa_per_target` → signed 2 dp |

Every value goes through a guard for `null`, `undefined`, `NaN` and the string `"NaN"` and prints "—" (the F1 team-page crash rule: `val == null || Number.isNaN(val)`). TD–INT prints "—" if either part is missing. No YPRR (empty for some 2026 receivers).

### 7.4 Number formatting

| Kind | Rule | Example |
|---|---|---|
| Team EPA (ladder) | `fmtFixed(v, 3, true)` (`lib/stats/box-score.ts:39-45`): sign always, true minus, never "−0.000" | +0.195, −0.042, 0.000 |
| Team rate (ladder, 7 pct lines) | `fmtRadarPct` (`lib/stats/team-radar.ts:477-479`): one decimal | 10.3% |
| Rank | `spokeRankLabel` (`:482-485`); when the pool is smaller than `teamsPlayed`, `rankCellLabel` | 2nd, T-30th, 3rd of 31 |
| Player EPA | `fmtFixed(v, 2, true)` | +0.21 |
| Missing | `EM_DASH` | — |

Note for the reviewer: `/team-stats` prints rates as whole percents (`fmtPct`, `lib/stats/team-stats.ts:265`); the matchup prints the same values to one decimal, as the radar does. Same numbers, more digits.

## 8. Components and layout

All new, under `components/matchup/`. Server components unless marked.

| Component | What |
|---|---|
| `MatchupFaceoff.tsx` | Header. Grid `minmax(0,1fr) auto minmax(0,1fr)`. Each side is a `Link` to the team page (`/team/ID`, `?season=` by the `playerHref` rule), background = team primary, text = `textColorForBackground`, 6 px bottom border = secondary (the band look of `TecmoSectionCard.tsx:35-43`). Inside: logo (`next/image`, `team.logo`, as `TeamIdentityCard.tsx:9,135`), the id in the pixel font, the full name in Inter 700, "3-1 · away". Middle: "AT" in the pixel font when the pair has a game in this order, "VS" when it has none (S6); under it the week label and `formatKickoff`; with no game, "No {season} game between these teams". Above the header, one plain link "← This week's matchups" to `/matchup`. |
| `MatchupRadarChart.tsx` | The two-series overlay (§8.1). |
| `MatchupRadars.tsx` | Band "Radar vs radar" (pixel font, navy `#013369`, 2 px red bottom border; aside `radarBandAside(season, throughWeek)`). Two panes: heading "{AWAY} offense over {HOME} defense", the count line, the chart, the legend. Under both, one paragraph (copy M5). |
| `MatchupLadder.tsx` | One ladder from a `LadderModel`: head (offense "what it does" / defense "what it allows", the "how to read" line), group headings, 13 rows. Prints strings only. |
| `MatchupLadders.tsx` — `"use client"` | Holds `ball`; renders the two tabs (hidden at `xl`) and both `MatchupLadder`s; `history.replaceState` on a tab press (§4.3). Imports `matchup-links.ts` and types only. |
| `MatchupLineup.tsx` | Mirrored lineup from `pairLineups`: head row with the two ids; 7 rows `minmax(0,1fr) 46px minmax(0,1fr)`; the home side right-aligned; name is a `Link` when `href` is set, plain bold text otherwise. |
| `MatchupNotes.tsx` | Footnotes M6–M11 (§8.5). |
| `MatchupSlate.tsx` | `/matchup`: band "{Week 5}" and one row per game: "BUF at LA · Mon Oct 12 · 8:15 PM ET", the whole row a `Link` with `prefetch={false}` to `matchupHref(away, home)`; a played game shows its final. |
| `MatchupPicker.tsx` — `"use client"` | Two `<select>`s (32 teams by name, value = id) and a "Compare" button → `router.push(matchupHref(a, b))`. The first select is labelled "Away team" and is the first path segment; the second is labelled "Home team". Both start empty ("Pick a team"). Picking the team already on the other side swaps the two (mockup behaviour). The button is disabled until two different teams are chosen. Imports `matchup-links.ts` and the `NFL_TEAMS` list passed as a prop (id + name only). |

**Bundle rule.** No `"use client"` file may import `lib/stats/matchup.ts`, `team-stats.ts` or `team-radar.ts` (it cost `/compare` 16 kB once). A test walks the imports of `MatchupLadders.tsx`, `MatchupPicker.tsx` and `ScheduleSection.tsx`. `MatchupLadder.tsx` is pulled into the client graph by its parent, so it too takes only strings and types.

### 8.1 The overlay radar

A new component, not an extension of `TeamRadarChart`: that one draws one series, returns `null` on its own gate, and the 1200×630 share image is tied to its output. Geometry is reused, not copied: `RADAR_SIZES.sm`, `radarPoint`, `radarPathD`, `radarLabelPosition`, `radarRadius`, `plottableScore`, `RADAR_MID_SCORE`, `radarStrokeColor` (all exported from `lib/stats/team-radar.ts:106-131`, `:853-920`).

Draw order: outer ring; mid ring (dashed amber `#f59e0b`, as live, `TeamRadarChart.tsx:76-83`); inner ring; the seven axis lines; **defense** outline (stroke `#334155`, 2 px, `strokeDasharray="6 4"`, 9% slate fill); **offense** outline (stroke `radarStrokeColor(primary, secondary)`, 2.6 px solid, 15% tint of the primary); **gap bars**; defense markers (9×9 squares, white fill, slate stroke); offense dots (circles r = 5, team stroke colour); labels.

- **Gap bar:** a 5 px line in site red `#D50A0A` along the spoke between the two points, only when `OverlaySpoke.gapBar` (both ranks present, `places ≥ EDGE_LEAN_MIN_GAP`; the constant, never a literal 5).
- A series bridges a missing spoke (no vertex there), as the live chart does; a series needs 3 vertices to have an outline.
- Label, two lines per spoke: the spoke name, then `rankLine` ("2nd v T-14th"). The longest line is 15 characters: any two tied two-digit ranks ("T-14th v T-20th", "T-32nd v T-32nd"), the same length as the live chart's longest ("100.0% · T-32nd"). **The overlay uses `RADAR_SIZES.sm` unchanged, and its fit test asserts at 0.556 em per character, the figure `sm` is already held to** (`__tests__/stats/team-radar-share.test.ts:161-167`), not at `RADAR_LABEL_CHAR_WIDTH` (0.6). At 0.6 the Sacks spoke (i = 2) would fail: label x = 323.1, 15 × 11 × 0.6 = 99, right edge 422.1 against a width of 420, and Run success (i = 5) the mirror way; at 0.556 the line is 91.7 wide and ends at 414.8. No existing geometry constant or pinned test changes. Because 0.556 is an estimate, the real-browser check at 375 px (§12) must include a pair with two tied two-digit ranks on Sacks or Run success, forced with a fixture if no live pair has one.
- The encoding never depends on telling two team colours apart (BUF `#00338D` and LA `#003594`): offense is solid with round dots, defense dashed slate with squares.
- Legend under each chart: "{AWAY} offense" (solid swatch), "{HOME} defense" (dashed swatch), "ranks 5+ apart" (red bar; the number from the constant), "middle of the league" (dashed amber).
- **Count line** (never names a winner): "Of the 7 spokes: offense is 5+ places higher on 2, defense on 1, 4 within 4 places." Same numbers as decisions.md's wording; the words changed because M5 says "the offense ranks higher" of any spoke where the solid shape is farther out, and a spoke at 3rd v 6th would then be "ranks higher" by M5 and "even" by the count. The 5 and the 4 come from `EDGE_LEAN_MIN_GAP`. When fewer than 7 spokes have both ranks: "Of the 6 spokes ranked: …". For the seven spokes only, never the 13 lines.

### 8.2 Page container

`<div class="mx-auto w-full max-w-7xl min-w-0 px-3 md:px-6 py-6">`. Sections are stacked with a fixed gap. **The page is never wider than the viewport:** every grid track is `minmax(0,1fr)` or a fixed width of 104 px or less; every grid child has `min-w-0`; no element has a fixed width above 104 px; text wraps (no `whitespace-nowrap` except the kickoff line, which is allowed to wrap as a whole below `md`); svgs are `w-full h-auto`.

### 8.3 Layout by width

| Part | Below 768 (`md`) | 768–1279 | 1280 and up (`xl`) |
|---|---|---|---|
| Header | two team slabs side by side (`grid-cols-2`); the AT / week / kickoff cell drops to a full-width second row, items in a wrapping row; id 24 px pixel font, logo 32 px | three cells in a row; id 34 px, logo 48 px | same |
| Radars | stacked, one per row | side by side | side by side |
| Ladders | one ladder + two half-width tabs; row columns `70px minmax(0,1fr) 70px`, gap 6 px; the "how to read" line drops under the two unit headings | one ladder + tabs; row columns `104px minmax(0,1fr) 104px`, gap 10 px | both ladders side by side (`grid-cols-2`, gap 24 px), no tabs; same row columns |
| Lineup | mirrored, centre column 30 px, stat line 12 px | mirrored, centre column 46 px | same |
| Slate (`/matchup`) | one game per row | two per row | three per row |
| Pickers | selects stacked, full width | in one row | same |

Nothing is sticky at any width.

### 8.4 Type

- Bands, "AT" / "VS", team ids in the header, tabs: Press Start 2P through the existing `font-[family-name:var(--font-pixel)]` class (`TecmoSectionCard.tsx:10`).
- Everything else: Inter.
- Ladder numerals: Inter 800, `tabular-nums`, 24 px from `md` up and 18 px below it. The widest strings ("−0.195" and "100.0%", six characters) at an estimated 0.62 em per character are about 89 px at 24 px (column 104) and 67 px at 18 px (column 70). The two column widths and the two font sizes are constants in `MatchupLadder.tsx` with a test that `6 × 0.62 × size ≤ column`; the estimate is checked in a real browser at 375 px before merge.
- Accent: site red `#D50A0A` has one job, "these two ranks are 5 or more apart": the tug marker and bar, and the radar gap bars. Nothing else on the page is red (the selected tab is navy). Even rows: hollow grey marker. Amber only for the mid ring.

### 8.5 Copy (constants or functions in `lib/stats/matchup.ts`, rendered as `{CONST}`; each has a test)

| ID | Where | Text |
|---|---|---|
| M1 | small-pool | "Matchup ranks start once 8 teams have played this season. Until then there are too few teams to rank against." (8 from `RADAR_MIN_TEAMS`) |
| M2 | a team with no games | "The {Team} have not played a {season} game yet." |
| M3 | a pane with no overlay | "Not enough of these rates are available yet to draw this radar." |
| M4 | count line | §8.1 |
| M5 | under the radars | "Both shapes are drawn by league rank, so the outer ring is 1st on every spoke and the amber ring is the middle of the league. Where the solid shape reaches past the dashed one, the offense ranks higher. Each label shows offense rank v defense rank." |
| M6 | footnote | "Every rank is among the {N} teams that have played in {season}, through Week {w} ({AWAY} has played {a} games, {HOME} {h}). A defense is ranked on what its opponents did, so allowing less ranks higher; for sacks, takeaways and stuffs, making more ranks higher." ("all 32 teams" when N = 32; "1 game" singular; the week clause dropped when unknown) |
| M7 | footnote | "An edge only compares two season ranks: defense rank minus offense rank. 0 to 4 places apart is called even, 5 to 12 a lean, 13 or more a clear edge. It is not a prediction and not a win probability." (numbers from the constants) |
| M8 | footnote (which EPA family) | "These numbers add up every game's box score, the same play filter as Team Stats and the team radars. A team's EPA/play here can differ from the figure in its team page header and on Team Tiers, which count plays differently." ("Team Stats" links to `/team-stats`, "Team Tiers" to `/teams`) |
| M9 | footnotes | No new wording. The existing tested constants are rendered as they are: `RADAR_RATES_NOTE` and `RADAR_STUFF_NOTE` (`lib/stats/team-radar.ts:533-538`) and `EXPLOSIVE_NOTE` (`lib/stats/team-stats.ts:472-473`), which carry the scramble caveat (QB scrambles of 10+ count as explosive runs; the explosive run rate divides by designed runs). The sack, turnover and stuff formulas are the radar's table sub-lines (`RADAR_AXES[].subline`), printed as one line joined with " · ". |
| M10 | footnote | "Players: the quarterback with the most dropbacks, the two backs with the most carries and the four wide receivers or tight ends with the most targets. A traded player is listed with the team he has played most for. Names open the player page." |
| M11 | footnote, weeks 1–4 of the newest season | `earlySeasonNote(throughWeek, isLatestSeason)` (`lib/stats/team-stats.ts:502-506`), unchanged |
| M12 | players unavailable | "Main players are unavailable right now." |
| M13 | uncovered season | "Team matchups start with the {first} season" / "Team matchups aren't available for the {season} season" (the `uncoveredHeading` pattern, `lib/stats/team-stats.ts:509-513`) |
| M14 | `/matchup`, no unplayed game | "No upcoming games in the {season} schedule. Pick any two teams below." |
| M15 | ladder head | "The red marker slides toward the unit with the better league rank. The farther from the middle, the bigger the rank gap." |
| M16 | `/matchup`, games read failed | "This week's games are unavailable right now." |

A bare apostrophe in JSX text fails lint; these are string constants, and the Edit-tool curly-apostrophe trap in `memory/MEMORY.md` applies to any JSX text written by hand.

## 9. Nav, sitemap and links in

- **Nav.** `components/layout/Navbar.tsx:10-20`: add `{ href: "/matchup", label: "Matchups", noSeason: true }` right after Team Stats (the index is always the newest season, so it does not carry `?season=`). The active test `pathname === link.href` appears TWICE, in the desktop row (`Navbar.tsx:64`) and in the mobile sheet (`:139`); both become `pathname === link.href || pathname.startsWith(link.href + "/")` so the item is active on `/matchup/BUF/LA` in both lists (no other link has a child path that would wrongly match: `/team-stats` does not start with `/teams/`). `__tests__/components/Navbar.test.tsx:32-37` gets the ten-label order, and the "active on `/matchup/BUF/LA`" test covers both lists.
- **Nav width — measure, do not guess.** The row was measured for nine labels ("no label wraps at 1024, one line at 1280", `Navbar.test.tsx:53-60`), inside `max-w-6xl px-6 md:px-12` (`Navbar.tsx:51`: 1056 px of room from 1152 up). The reviewer's estimate for ten labels at `xl:gap-6` is about 1055–1060 px against 1056, too close to call. Before merge, open the branch and `main` side by side at 768, 1024, 1100 and 1280 px. The pass rule per width:
  - **1024 and 1280:** no label wraps and the row is one line.
  - **768–1023:** no worse than `main` at the same width (compare screenshots). Two-word labels already wrap there on `main` (672 px for about 870 px of content), so "no wrap" is not the test.
  - Fallback at 1024, in order: `gap-2` below `xl`; then `text-[13px] xl:text-sm` on the links.
  - Fallback at 1280, in order: `xl:gap-5`; then `xl:gap-4`. Never widen the row past the page container without saying so in the PR.
  - Update the pinned classes in the test to whatever was measured, with the date. Do not shorten or drop a label.
- **Sitemap.** `app/sitemap.ts:34-47` lists static pages: add `{ url: \`${base}/matchup\`, lastModified: dataUpdated, changeFrequency: "weekly", priority: 0.8 }` after `/team-stats`. No `/matchup/[away]/[home]` URL goes in. `__tests__/app/sitemap.test.ts` gets one new assertion, and its four pinned static-entry counts (`11 + 32 …` at `:50`, `:97`, `:126`, `:136`) all move to 12.
- **Revalidate.** `app/api/revalidate/route.ts`: `revalidatePath("/matchup", "layout")`; `__tests__/app/revalidate-route.test.ts` asserts it.
- **Team page schedule tiles.** `components/team/ScheduleSection.tsx:264-271` (the unplayed branch of `GameTile`): on a tile that links, the kickoff line becomes a `Link` with `prefetch={false}` to `matchupHref(game.away_team, game.home_team, { season: game.season, defaultSeason })`, styled like the box score link (dotted underline, `:245`), `title="Matchup: BUF at LA"`, `data-matchup-link`.
  - **A tile links only when ALL hold:** `defaultSeason` was passed; the game is unplayed; the section is not the upcoming-season grid (`upcomingSeason === undefined`; that season has no stats and the link would silently show another season); `game.season <= defaultSeason`; both team ids pass `parseMatchupTeamId` + `getTeam` (`getTeam` is already imported there, `ScheduleSection.tsx:12`).
  - **"PREVIEW" (pixel font) is shown only when the tile links to a matchup and the game has no kickoff time.** A tile that does not link is unchanged: no kickoff time, no line. The existing test "omits the kickoff line when gametime is null" (`__tests__/components/ScheduleSection.test.tsx:154-162`) stays as it is: it renders without `defaultSeason`, so the tile does not link.
  - `ScheduleSection` gains an OPTIONAL prop `defaultSeason?: number` (absent = no tile links), passed from `TeamHubContent` (which already has it, `app/team/[team_id]/page.tsx:163`). Optional so every existing ScheduleSection test (the `renderSchedule` helper at `:66-75`, and `:237-245`) stays untouched, still compiles, and still proves the old behaviour; the new tests pass it.
  - **`prefetch={false}` matters (compare card chaos finding COST-1, `components/compare/CompareShare.tsx:96-101`):** without it next/link asks the server for a dynamic route's tree as soon as the link is on screen, one function run per link: up to 17 on every team-page view, up to 16 on `/matchup`. The nav item keeps the default (one link).
  - The opponent link above it is unchanged (links cannot nest; the two are siblings, as today's box score link is). The new imports are `matchup-links.ts` only.
- Not built: a link from the box score page (§2), from `/team-stats`, from the homepage.

## 10. Error and empty states

| Situation | `/matchup/[away]/[home]` | `/matchup` |
|---|---|---|
| unknown team, same team twice | 404, no read | — |
| mixed case | 308 | — |
| reversed order of the only game | 307 | — |
| failed seasons or `team_game_stats` read; empty rows for a season that has them | throws → `app/matchup/error.tsx` (`ErrorState`, title "Unable to load matchups", since the one boundary serves both routes; `links` to `/team-stats` and `/matchup`). No `loading.tsx`, so this is a real HTTP 500 that is never cached, like `/card` and `/game` (a server component cannot send a 503; the 503 in decisions.md applies to image routes, and there is none here) | failed seasons read: the same error card. (The pickers need no data, but the page cannot name a season or a slate without it, and a per-request page is retried on the next view.) |
| no database (CI / placeholder build) | not prerendered (no `generateStaticParams`) | not prerendered (`force-dynamic`), so the build makes no read |
| failed games read | renders; no week, date, records or redirect; logged | renders the pickers under "This week's games are unavailable right now."; logged; never stored (per-request page) |
| failed player tables | section shows M12; logged | — |
| failed slug list | names unlinked; logged | — |
| uncovered season (listed, no rows, not the newest) | 200, noindex: header (names, no records needed), M13, a link to the same pair in the newest season | — |
| fewer than 8 teams played | header, M1, players | slate and pickers as normal |
| one team has no games | M2, that team's cells "—", rows `na`, its overlay panes M3 | — |
| a side under 4 real spokes | that pane M3; ladder unaffected | — |
| no game between the two | "VS" and "No {season} game between these teams"; the records still print | — |
| no unplayed game in the season | — | M14 and the pickers. Known and accepted for v1: before a new season's first ingest the newest stats season is still last year's, so the page says "No upcoming games in the 2025 schedule" although next season's schedule is already in `games` |
| `error.tsx` test rule | any test rendering it must mock `useRouter` (`memory/MEMORY.md`) | |

## 11. Tests

Vitest only (no Python changes besides the reference script). CI does not run vitest: run it locally before each merge.

**Golden.** `docs/superpowers/specs/matchup-reference/make_matchup_expected.py` (Python, no database, run with `py -3 -I`) reads the two FROZEN fixtures (`__tests__/stats/fixtures/team-game-stats-2026-w1-3.json`, `team-radar-2026-w1-3.json`; their shared columns are already asserted identical) and writes `__tests__/stats/fixtures/matchup-2026-w1-3.expected.json`: for every team and both sides, value / rank / tied / pool of the six Team Stats numbers; and for three pairs (BUF–HOU, DET–NO, one pair containing CHI or PHI, who have 2 games) all 26 edges. The vitest helper joins the two fixtures by `(game_id, team_id)` to make the 35-column rows; no third rows fixture. Never re-capture the expected file to make a test pass.

**PR 1 — `__tests__/stats/matchup.test.ts`**

- `competitionRank`: empty list; one team (rank 1, pool 1, not tied); 32 distinct values in both directions; two values 1e-12 apart tie and print "T-", the next rank is skipped (1, 1, 3); three tied for last among 32 are all 30th; a `null`, `NaN`, `Infinity` or numeric-string value is not in the pool; 1,000 entries; **a chain of near-ties** (a, a + 0.6e-9, a + 1.2e-9: the middle one is tied with both ends, the ends are not tied with each other) gives exactly what the radar's loop gives for the same values, which a sort-then-group version does not; and for every spoke of the fixture, `competitionRank` over the radar's values reproduces `buildTeamRadar`'s rank, tied and pool.
- `rankTeamStat`: equals the golden for all six fields × both sides; a team with `off.gp = 0` has no rank and is not in the pool; a team with only an opponent's row has no rank; defense direction is the reverse of offense on every field; `−0` and `0` tie.
- The four shared lines: radar spoke value equals `buildTeamStats`' `pass_sr`, `expl_pass_rate`, `rush_sr`, `expl_rush_rate` for every team and side on the fixture.
- `MATCHUP_STATS`: 13 rows, the §3.1 order, groups Overall 2 / Passing 4 / Rushing 4 / Turnovers 1 / Downs 2; direction table asserted row by row (sack, stuff, turnover are the only `offHigherBetter: false`); `defWord` per row.
- `edgeOf`, every boundary of §3.3: gaps 0, ±1, ±4, ±5, ±12, ±13, ±31; (8, 8), (8, 9), (4, 8), (4, 9), (25, 25), (25, 29), (24, 25), (1, 32), (32, 1); a null rank on either side, both sides, `undefined`, a null object; pools of 24 and 25 for the named labels (24 → "Even", 25 → named); pools of different sizes; rank 0, a negative or fractional rank → `na`.
- `tugPosition`: 50 at gap 0; 0 at +31; 100 at −31; clamped beyond; 50 for `na`. `verdictText`: every row of §3.3's table, "1 place", "same rank".
- `buildMatchup`: golden for the three pairs; always 13 rows per ladder in order; `awayBall` is away offense v home defense and `homeBall` the reverse (a swap test: `buildMatchup(A, H).awayBall` equals `buildMatchup(H, A).homeBall`); `throughWeek` and `teamsPlayed` equal `buildTeamRadar`'s; 7 teams played → `small-pool` with both sides null; 8 → `ready`; a team with no rows → all its cells "—", all its rows `na`, `games: 0`, overlay `off`/`def` null, no throw; both teams with no rows; an unknown team id; empty rows; `null` rows; rows of another season and a repeated `(game_id, team_id)` change nothing; a NULL `designed_runs` → stuff row `na` and that spoke missing; a rate outside 0–1 → `na` and listed in `rejected`; numeric strings and `"NaN"`; no `NaN` or `Infinity` anywhere in the returned model (deep walk; it must survive `JSON.parse(JSON.stringify(model))` unchanged).
- Overlay: `gapBar` true at 5 and false at 4; false with a missing rank; tally counts exclude missing spokes and `ranked` says how many; `drawn` false with 3 real spokes on either side, true with 4; `rankLine` forms.
- `pickMainPlayers`: the rule of §7.3 on the real `compare-2026-w4-rows.json` fixture for BUF and one more team; ties on dropbacks / carries / targets broken as specified (and stable when the input order is reversed); a WR listed in the QB table with 1 dropback does not beat the starter; an RB row in the receiver table is not picked as WR/TE; FB counts as RB; a team with no QB row; a team with one RB; a team with no rows at all (7 empty rows after `pairLineups`); a repeated `player_id`; a player with no slug (`href: null`); names "D'Andre Swift", "Amon-Ra St. Brown" pass through untouched; null / `"NaN"` stats print "—"; a past season's `href` carries `?season=`; a row whose `team_id` differs only in case is not picked.
- `findPairGame`: no game; one game in order; one game reversed (`swap: true`); both orders (no swap, each order gets its own game); played + unplayed in the same order (the unplayed one); only played (the latest); a stale duplicate unplayed row (the later `gameday`); **a stale unplayed row plus the real game already played (the played game, with its final; never the stale kickoff)**; a playoff rematch; a game with null `gameday`.
- `teamRecord`: 0-0 with no games; ties; playoff games ignored; unplayed ignored. `currentSlate`: mid-week (Thursday played, the rest not → the whole week, Thursday first); all played → null; **a stale row in week 3 while weeks 4–5 have results → week 5 (or the next week with an unplayed game), never week 3**; nothing played yet → week 1; playoff label; empty list.
- `formatKickoff`: all parts; no time; no date; "00:30" and "12:00"; a played game; a `gameday` that is not a date.
- `__tests__/stats/matchup-links.test.ts`: `parseMatchupSeason` ("2026", "02026", "2026abc", "2025.9", " 2026", "", "1998", "2101", an array, `undefined`); `parseBall`; `matchupHref` (bare, past season, `ball=home`, both, a non-integer season); `parseMatchupTeamId` equals `parseRadarTeamId` over `ſf`, `pıt`, `buf`, `BUF`, `L.A`, `""`, `null`, a four-letter string and a one-letter string; the module has no imports.
- `lib/stats/matchup.ts` imports nothing from `lib/data` but `teams`.

**PR 1 — `__tests__/data/matchup.test.ts`, additions to `__tests__/data/games.test.ts` and `compare-card.test.ts`**

- `MATCHUP_COLUMNS` equals the union of the two existing lists; 35 names; the numeric list is the filtered one. `getMatchupRows` passes the season filter, both order columns and a signal; a rejection becomes an `Error` through `queryError`; `[]` on a successful empty read.
- `getSeasonGames`: maps a row; drops and logs a row with a null team, a same-team row, a null week; passes `order: ["game_id"]`; throws on error.
- The three new exports of `compare-card.ts` return what the private calls return and add no memo key shape.
- `loadMatchup`: reads counted — cold 8 requests (7 loader calls), warm 0, a second pair in the same season 0; every memo key is season-shaped. Seasons empty on a real database → throws; rows read rejects → throws; rows empty for the newest season → throws; for a covered past season → throws; for an uncovered one → `uncovered` with / without `firstSeason`; games read rejects → `gamesAvailable: false`, no swap, logged; one player table rejects → `playersAvailable: false`, logged; slug list rejects → players with `href: null`, logged; a requested season not in the list → the default season; a failed read is not retried within ten seconds.
- `loadMatchupIndex`: slate from the newest season; a failed seasons read rejects; a failed games read resolves with `slate: null`, `gamesAvailable: false` and one `console.error`.

**PR 2**

- `__tests__/app/matchup-route.test.tsx`: every row of §4.1's example table (status, redirect target, and that steps 1–4 make no read); the 308 uses `permanentRedirect` and the 307 `redirect`; the kept query is rebuilt (an unknown key is dropped, `ball` flips on the 307); `/matchup/LA/BUF?season=2031` when the only game is BUF at LA → 307 to `/matchup/BUF/LA?ball=home` with no `season` (the 307's target is built from the resolved season, §4.1); metadata — both title forms, description with and without a week, canonical bare / with a real past season / never with `ball`, `noindex` for an unscheduled pair, small-pool and uncovered; a failed core read rejects from the page and from `generateMetadata`; exports `revalidate = 3600` and no `generateStaticParams`; no `loading.tsx` and no `opengraph-image.tsx` exist under `app/matchup/` (a file-system test).
- `__tests__/app/matchup-index.test.tsx`: slate rows and their hrefs; M14 with no unplayed game; a failed games read still renders both pickers with M16 and no slate; a failed seasons read rejects; the page exports BOTH `dynamic = "force-dynamic"` and `revalidate = 3600` (one test for each, with a comment saying why neither may be removed); static metadata.
- `__tests__/app/matchup-stub.test.tsx`: `app/matchup/[away]/page.tsx` calls `notFound()` and makes no read. Route test additions: `?season=2025.9` and `?season=2025abc` give the bare canonical; an invalid pair's metadata is the absolute "Matchup Not Found" title with `noindex` and no read.
- `__tests__/app/matchup-error.test.tsx`: the card's title and links (mock `useRouter`).
- Components (`__tests__/components/matchup/*.test.tsx`): `MatchupRadarChart` — one circle per real offense spoke, one square per real defense spoke, the defense path is dashed, a gap bar exactly on the spokes with `gapBar`, no `NaN` in any `d` or coordinate, nothing drawn when not `drawn`, the mid ring is dashed amber; `MatchupRadars` — headings, count line, M3 pane, M2; `MatchupLadder` — 13 rows, 5 group headings, hollow marker and no bar on even / `na` rows, red only on lean / clear rows, the three verdict forms; `MatchupLadders` — both ladders are in the DOM, the unselected one carries `hidden xl:block`, the tabs carry `xl:hidden`, `initialBall="home"` selects home on first render, a tab press calls `history.replaceState` with the URL from `matchupHref` (season kept) and no router call; `MatchupLineup` — 7 rows, linked and unlinked names, an empty side, M12; `MatchupFaceoff` — "AT" / "VS", kickoff, records only when games are available, team links carry the season; `MatchupPicker` — swap on picking the other side's team, disabled until two differ, the pushed href; `MatchupSlate`.
- Layout guards: no class containing `sticky` or `fixed` in `components/matchup/`; every grid template in those files uses `minmax(0,` for its flexible tracks; the numeral-fit test of §8.4.
- Bundle: the import walk of §8.
- `Navbar.test.tsx` (order; active on `/matchup` and `/matchup/BUF/LA` in BOTH the desktop row and the mobile sheet; `Matchups` href never carries `?season=`; the measured gap classes).
- `sitemap.test.ts`: the new `/matchup` entry, and the four pinned static counts at `:50`, `:97`, `:126`, `:136` move from 11 to 12.
- `revalidate-route.test.ts`: `["/matchup", "layout"]` is called.
- `ScheduleSection.test.tsx`: every existing test is left as it is (none passes `defaultSeason`, so none links; `:154-162` still proves "no kickoff time, no line"). New tests, all passing `defaultSeason`: an unplayed tile links to `/matchup/AWAY/HOME` in away/home order whichever team's page it is on; the link has `prefetch={false}`; a played tile, the upcoming-season grid, a future season, and a tile with a malformed team id do not link and render exactly as before; "PREVIEW" only on a linking tile with no kickoff time; a past season's href carries `?season=`.
- `MatchupSlate`: every row link has `prefetch={false}`.
- Overlay label fit: the 15-character line on every spoke of `RADAR_SIZES.sm` at 0.556 em per character (§8.1).

**Chaos pass** (CLAUDE.md gate) after each PR, before the review panel. Attack:

- Rows: null / undefined / `NaN` / `"NaN"` / `Infinity` in every one of the 35 columns; negative counts; a stored rate of 12; `stuffed_runs > designed_runs`; a row with no `team_id`; a row whose `opponent_id` is not a team; one team-game row without its opponent's row; 0 rows, 1 row, 7 teams, 8 teams, 1,000+ rows; rows of two seasons mixed; duplicate keys.
- Teams: a team on its bye; a team with one game; a team with no games in week 1; two teams with identical season totals (ties everywhere); every rank tied; BUF v LA (near-identical blues); PIT and NO (light primaries: the outline must be the dark fallback); an id not in `NFL_TEAMS` inside the rows.
- URLs: `/matchup/ſf/buf`, `/matchup/pıt/buf`, `%00`, 300-character segments, `/matchup/BUF/buf`, encoded slashes, `?season=` repeated, `?season=99999999999999999999`, `?season=2026&season=2025`, `?ball=HOME`, `?ball=home&ball=away`, a trailing slash, an extra segment.
- Schedule: both orders in one season; a stale rescheduled duplicate; a game with null week, null gameday, null gametime; a playoff rematch; `home_team === away_team`; the games table empty; the games read timing out at 5 s while the others succeed.
- Players: Taysom Hill (QB and RB tables), a traded player, a rookie with 1 target, a team whose QB table row is missing, D'Andre Swift / Amon-Ra St. Brown / Marquez Valdes-Scantling at 375 px (no overflow), a `player_slugs` list that hits the 1,000-row page boundary.
- Width: 320, 375, 767, 768, 1024, 1279, 1280, 1600 px — `document.documentElement.scrollWidth === clientWidth` on a matchup with the longest names (Tampa Bay Buccaneers at Washington Commanders) and on `/matchup`.
- Failures: each read failing alone and all together (the local stub on 127.0.0.1:54399 from `memory/MEMORY.md`); a read that succeeds empty; 200 different pairs in a minute (the request count must stay 8).

## 12. Rollout — two PRs

| PR | Contains | Safe alone because | Verify |
|---|---|---|---|
| 1 — logic and loader | `lib/stats/matchup.ts`, `lib/stats/matchup-links.ts`, `lib/data/matchup.ts`, `getSeasonGames` in `lib/data/games.ts`, the three exports in `lib/data/compare-card.ts`, the reference script, the expected file, PR 1's tests | No route, component, nav item or link uses it: no visitor-visible change. No existing function's behaviour changes. | `tsc --noEmit`, `next lint`, vitest (repo as the working directory), pytest, build — separate commands. |
| 2 — pages | `app/matchup/page.tsx`, `app/matchup/[away]/page.tsx`, `app/matchup/[away]/[home]/page.tsx`, `app/matchup/error.tsx`, `components/matchup/*`, Navbar + test, sitemap + test, revalidate route + test, `ScheduleSection` + `TeamHubContent` (the `defaultSeason` prop) + test, docs and memory | Additive routes; the schedule tiles gain one link | Local `npx --no-install next dev -p 3100` from the repo folder: this week's five-plus games; BUF/LA (the two blues); NE/BUF and BUF/NE; a pair with no game; `?season=2025` (M13); `?ball=home` opens on the home ladder; every width in the chaos list; the nav at 768 / 1024 / 1100 / 1280; a team page's unplayed tile opens the right matchup; `/matchup/BUF` and `/matchup/BUF/LA/x` answer 404 and `/matchup/buf/la` answers 308 (curl, status line); a pair with two tied two-digit ranks on Sacks or Run success at 375 px, forced with a fixture if no live pair has one (§8.1); the nav against `main` by the per-width rule of §9. Then the forced-failure stub. **On the Vercel preview:** request `/matchup` three times and confirm `x-vercel-cache: MISS` and `age: 0` each time; if it is cached, the games read on `/matchup` becomes core (throws) before merge (§4.2). Confirm the plan's function time limit against the 10 s cold worst case (§6.5). |

Two PRs, not one: PR 1 is where the arithmetic and its golden live and can be reviewed with no layout noise; PR 2 is then layout over a model that is already proven. Chaos pass after each. Jon is shown the built page (not this file) before PR 2 merges.

## 13. Decisions this spec made that decisions.md did not settle

For the spec reviewer and Jon; each is a small, reversible choice.

| # | Choice | Why | Cost to change |
|---|---|---|---|
| S1 | `/matchup` is rendered per request (`dynamic = "force-dynamic"`) so that decisions.md's "the games read fails → the pickers still render" can be followed without breaking the house rule | The rule against swallowing a data error (`.claude/CLAUDE.md:42`) is about static / ISR pages, where the degraded copy is stored for an hour. A per-request page degrading one read is the `/team` pattern. Cost: the page is not served from the CDN; its two reads are memoised (0 warm). The alternative, an ISR page that rethrows and relies on "the last good copy stays up", is weaker than it sounds on this stack: `/game` has `revalidate = 3600`, reads no `searchParams`, and still answered `x-vercel-cache: MISS` on every request when measured (`memory/MEMORY.md`, box score known debt, cause unknown). | Remove one export and change one `catch` to a rethrow, if Jon prefers the ISR variant |
| S2 | Four of the "ten Team Stats numbers" read the radar spoke | One source per number on a page (§3.1) | One table column in `MATCHUP_STATS` |
| S3 | "Strength on strength" / "Weakness on weakness" only when both pools have 25+ teams | In a pool of 8 every team is "top 8" | One constant |
| S4 | Under 8 teams played, the ladders are hidden too, not just the radars | A rank among 2–7 teams is noise; the radar rule's own reasoning | One branch |
| S5 | Only scheduled pairs in `ready` state are indexable | 992 ordered pairs; most never play | One condition |
| S6 | "VS" instead of "AT" for a pair with no game | "AT" claims a venue | One string |
| S7 | Percent values to one decimal (Team Stats prints whole percents) | Ranks 5 places apart can share a whole percent | One formatter |
| S8 | No `loading.tsx` under `/matchup`; a failed core read is a real 500 with the error card | Real 404s and redirects (§4.1) | Adding a skeleton makes them soft |

## 14. Files

**New:** `lib/stats/matchup.ts`, `lib/stats/matchup-links.ts`, `lib/data/matchup.ts`, `app/matchup/page.tsx`, `app/matchup/[away]/page.tsx` (404 only), `app/matchup/[away]/[home]/page.tsx`, `app/matchup/error.tsx`, `components/matchup/` (the ten components of §8), `docs/superpowers/specs/matchup-reference/make_matchup_expected.py`, `__tests__/stats/fixtures/matchup-2026-w1-3.expected.json`, the test files of §11, `docs/superpowers/specs/2026-10-10-team-matchup-design.md` (this file).

**Changed:** `lib/data/games.ts` (+`getSeasonGames`), `lib/data/compare-card.ts` (+3 exports), `components/layout/Navbar.tsx`, `app/sitemap.ts`, `app/api/revalidate/route.ts`, `components/team/ScheduleSection.tsx`, `components/team/TeamHubContent.tsx` (pass `defaultSeason`), and the tests named in §11.

**Not changed:** `scripts/ingest.py`, the database, `lib/stats/team-stats.ts`, `lib/stats/team-radar.ts`, `lib/data/team-stats.ts`, `lib/data/team-radar.ts`, `components/team/TeamRadarChart.tsx`, every frozen fixture, `app/game/*`, `next.config.mjs`, `package.json`.

**Docs and memory, at the end of each PR:**

- `.claude/CLAUDE.md`: line 32 (the "stats only in ingest" exception now also covers `/matchup`, in `lib/stats/matchup.ts`); line 33 (add `lib/data/matchup.ts`: one loader, memo keys by season only, never a read per team or pair; `getSeasonGames`); line 37 (nav labels: the real ten, which also fixes the stale list); the client-bundle rule (`matchup-links.ts`).
- `memory/MEMORY.md`: a "Team Matchup" section (routes and the redirect rule incl. division rivals; the edge constants; the 35-column read and the 8 / 0 request counts; core vs may-degrade; no `loading.tsx`; the S1–S8 choices; the golden rule "never re-capture"; new vitest counts). PR 1 writes the logic half, PR 2 the rest.
- This spec gains "As built (PR 1)" and "As built (PR 2)" sections, as the radar and compare specs did.
- The glossary is not changed in v1 (the edge rule is explained on the page, M7).

## 15. Open risks

| Risk | Handling |
|---|---|
| A tenth nav label wraps at 1024 px | Measured before merge with a stated fallback (§9); the pinned classes in the test are updated to the measurement |
| Ladder numerals in Inter are wider than the mockup's Barlow Condensed | Smaller sizes, a fit test, and a real-browser check at 375 px (§8.4) |
| `games` holds stale rows for rescheduled games (never cleaned up) | Both schedule rules skip them (§6.4): `findPairGame` ignores an unplayed row once the same pair and order has a later played game, and `currentSlate` never goes back before the highest week with a result. Tests and a chaos case |
| A game moved to an EARLIER week: the real game, once played, has the earlier date and the lower week, so `findPairGame`'s stale-row rule keeps the stale unplayed row (the played game is neither later-or-equal in date nor higher in week) and the header would show the old kickoff | Essentially does not happen in the NFL (reschedules move games later, or within a week). Not handled; accepted (spec review 2, note 3) |
| A game postponed to later in the season with no new row yet | It is unplayed in an old week and is skipped by `currentSlate` once a later week has a result; it shows again when its week comes. Accepted |
| Small pools: with 8–13 teams played a gap of 13 cannot happen, so "clear edge" never appears and top v bottom reads only "lean" | One Sunday afternoon a year; the cut-offs stay fixed in any pool (S3) |
| Early season: one game moves a rank a long way, and a 5-place gap is small in week 2 | M11 in weeks 1–4; no ranks under 8 teams; the cut-offs are constants |
| EPA and success rate are correlated, so several ladder rows can say the same thing | The count line covers the 7 non-overlapping spokes only; no row total is printed for the 13 |
| A traded player's whole-season line sits under the team he has played most for: most pass attempts (`scripts/ingest.py:597-601`), most carries (`:963-969`), most targets (`:1172-1178`) | Same behaviour as the team page; M10 says so on the page |
| The receiver table is `select *` with no pagination (362 rows today) and the QB table likewise | Shared with `/compare` and the team page; flagged in the compare spec, not changed here |
| 992 pairs × seasons × `ball` are all valid URLs on a dynamic route | Zero reads per pair (§6.5); render cost is HTML only, no image. Only scheduled pairs are indexable and none is in the sitemap |
| `history.replaceState` and Next 14.2's router | Supported since 14.1; the component test asserts the call; if it misbehaves on a back / forward press in the browser check, fall back to a router call with `{ scroll: false }` (the leaderboards' pattern; `components/tables/TeamStatsTable.tsx:72-76` is `router.push(…, { scroll: false })`, and `router.replace` is the right verb here so the tabs do not fill the history) |
| `force-dynamic` on `/matchup`: S1 depends on the page really being rendered per request on Vercel, which is not verified | Both exports kept and pinned by tests; a three-request `x-vercel-cache` check on the preview is a merge step, with a stated fallback (the games read becomes core) (§4.2, §12). The 60 s memo bounds the reads either way. Neither matchup route is prerendered, so a Supabase stall cannot fail a Vercel build because of this feature |
| An `uncovered` season still starts the games, player-table and slug reads in the same wave | Harmless: memoised, bounded keys. Resolving the rows first would add a wave; left as is |
| Memo freshness | Up to a minute behind `/api/revalidate` per instance, then the hour of Next's data cache if the revalidate call failed: the share cards' accepted behaviour |
| The page is not yet seen by Jon as a built page | The mockup he saw is a hybrid of two directions that were never drawn together; show him the local build of PR 2 at phone and desktop width before merge |

## 16. Revision 2 — spec review 1 applied

Review: `spec-review-1.md` (CHANGES REQUIRED: 1 blocker, 8 should-fixes, 14 notes). No design direction was re-opened and no scope was added.

| # | Finding | What changed | Where |
|---|---|---|---|
| 1 | BLOCKER: the bundle rule forbade the `parseRadarTeamId` import the schedule tiles needed | New `parseMatchupTeamId` in `matchup-links.ts` (same rule, imports nothing), used by the route's step 1, `ScheduleSection` and `MatchupPicker`; a test holds it equal to `parseRadarTeamId` | §4.1 step 1, §7.1, §9, §11 |
| 2 | A stale rescheduled row won over the real game | `findPairGame` drops an unplayed row once the same pair and order has a later played game; `currentSlate` never goes back before the highest week with a result; two new test cases | §6.4, §11, §15 |
| 3 | "PREVIEW" was ambiguous for tiles that do not link | Shown only on a tile that links; a non-linking tile is unchanged; the existing test at `ScheduleSection.test.tsx:154-162` stays | §9, §11 |
| 4 | The 15-character label fails the fit rule the spec named (0.6) | Option (a): the overlay keeps `RADAR_SIZES.sm` unchanged and asserts at 0.556, the figure `sm` is already held to; no geometry constant or pinned test changes; the 375 px browser check must include two tied two-digit ranks on Sacks or Run success | §8.1, §11, §12 |
| 5 | Nav fallback covered only 1024, and the 768 check could not pass | Pass rule per width (1024 and 1280 one line; 768–1023 no worse than `main`); 1280 fallback `xl:gap-5` then `xl:gap-4`; labels never shortened | §9, §12 |
| 6 | The nav active rule exists in two lists | Both named (`Navbar.tsx:64`, `:139`); the test covers the desktop row and the mobile sheet | §9, §11 |
| 7 | Links to a per-request route should not prefetch | `prefetch={false}` on the schedule tile link and the slate rows, with tests; COST-1's warning beside "No `loading.tsx`" | §4.1, §8, §9, §11 |
| 8 | `/matchup`'s per-request claim is unverified on Vercel | Both exports kept, explained in a code comment and each pinned by a test; a three-request `x-vercel-cache` check on the preview with a stated fallback (the games read becomes core) | §4.2, §11, §12, §15 |
| 9 | Existing pinned tests were understated | The four sitemap counts (`:50`, `:97`, `:126`, `:136`) move to 12; `defaultSeason` is optional on `ScheduleSection`, so every existing test stays untouched | §9, §11 |
| 10 | Trade rule not traced | RB = most carries (`scripts/ingest.py:963-969`), receiver = most targets (`:1172-1178`), QB as before; one clause added to M10 | §2, §8.5, §15 |
| 11 | `competitionRank` algorithm not written out | The radar's pairwise count spelled out; sort-then-group ruled out; a near-tie chain test and a test against `buildTeamRadar`'s own ranks | §3.2, §7.2, §11 |
| 12 | The 307 could carry an unlisted season | Its target is built with `matchupHref` from the resolved season; the 308 keeps the raw-valid value | §4.1 |
| 13 | Metadata for a URL about to 307 | The plain noindex object for both redirects | §4.4 |
| 14 | `TeamStatsTable.tsx:72-76` miscited as `router.replace` | Corrected: it is `router.push` | §15 |
| 15 | Count line disagreed with M5's "ranks higher" | "offense is 5+ places higher on 2, defense on 1, 4 within 4 places" | §8.1 |
| 16 | M9 re-worded tested definitions and dropped the scramble caveat | M9 now renders the existing constants and the radar's sub-lines; no new wording | §8.5 |
| 17 | Header record vs the team page's | Said: the box score page's rule, counted from `games`; can differ from the team band for a few hours | §6.4 |
| 18 | "Clear edge" cannot appear with 8–13 teams played | Added as a risk | §15 |
| 19 | An uncovered season still starts the other reads | Left as is, recorded | §15 |
| 20 | `/matchup` before a new season's first ingest shows M14 for last season | Recorded as accepted for v1 | §10 |
| 21 | Picker selects unlabelled | "Away team" / "Home team", both start empty | §8 |
| 22 | 10 s cold worst case and no recorded `maxDuration` | Confirm the plan's function limit before PR 2 merges | §6.5, §12 |
| 23 | Error card title also shows on the index | "Unable to load matchups" | §10 |

### Spec review 2 (APPROVED) — the five builder notes, applied when this file was copied into the repo

| Note | What it asked | What changed here |
|---|---|---|
| 1 | §2's "This week" row still summarised the slate as "the lowest week that still has an unplayed game" | The row now states §6.4's rule (lowest week at or after the highest week with a played game) |
| 2 | `findPairGame` step 2: build it as "the latest `gameday`, then the larger `game_id`", and say where a null `gameday` sorts | §6.4 steps 2 and 3 rewritten; a null `gameday` sorts before any date; pinned by the "null `gameday`" tests |
| 3 | The stale-row rule does not cover a game moved to an EARLIER week | Listed in §15 as an accepted risk |
| 4 | Add a route test for `/matchup/LA/BUF?season=2031` → 307 to `/matchup/BUF/LA?ball=home` with no `season` | Added to PR 2's route test list in §11 |
| 5 | §16's table stopped at finding 19 | Rows 20–23 were already in the table of the copy handed to the builder; no change was needed |

## 17. As built (PR 1 — logic and loader, branch `feat/matchup-logic`, 2026-10-10)

Built test-first: each unit's failing tests were committed before its implementation. No route, component, nav item or link uses any of it, so there is nothing a visitor can see. No existing function's behaviour changed; no frozen fixture or pinned test changed.

**Files.** New: `lib/stats/matchup-links.ts`, `lib/stats/matchup.ts`, `lib/data/matchup.ts`, `docs/superpowers/specs/matchup-reference/make_matchup_expected.py`, `__tests__/stats/fixtures/matchup-2026-w1-3.expected.json`, `__tests__/stats/matchup-links.test.ts`, `__tests__/stats/matchup.test.ts`, `__tests__/data/matchup.test.ts`, `__tests__/data/matchup-requests.test.ts`, this file. Changed: `lib/data/games.ts` (+`getSeasonGames`), `lib/data/compare-card.ts` (+3 exports), their two test files (additions only), `.claude/CLAUDE.md`, `memory/MEMORY.md`.

**Counts.** vitest 2810 tests / 100 files (2496 / 96 before). pytest unchanged (no Python under `tests/` or `scripts/` was touched; the reference script lives under `docs/`).

**Where the build differs from the text above, and why.**

| # | Section | As built | Why |
|---|---|---|---|
| 1 | §7.2 signatures | `findPairGame`, `teamRecord`, `currentSlate`, `formatKickoff` take a `MatchupGame` declared in `lib/stats/matchup.ts` (the same eleven fields as `GameRecord`); the first and third are generic, so a `GameRecord[]` goes in and `GameRecord`s come out | §7.2 also says the module imports nothing from `lib/data` but `teams`, and the import test reads `import type` lines too. Same answer as `ScoreboardGame` in `lib/stats/box-score.ts` |
| 2 | §7.2 "a small private helper" | The row filter is exported as `matchupSeasonRows` | The test that holds it to `buildTeamRadar(...).rowCount` needs to call it |
| 3 | §7.2 | `lib/stats/matchup.ts` imports nothing from `lib/data` at all (it did not need `teams`) | The names in M2 are passed in by the caller |
| 4 | §6.4 `findPairGame` | When `swap` is true, `game` is null | The page redirects; there is no game in the order asked for to show |
| 5 | §6.4 `currentSlate` | In the slate, a game with no `gameday` (or no kickoff time) sorts after the dated ones; the label is the round name when the week holds a playoff game | The spec gives the sort keys but not where a missing one goes |
| 6 | §6.4 `formatKickoff` | The weekday is the stored `weekday` column's first three letters, printed only beside a readable date; nothing is computed from the date | "Missing parts are dropped"; a weekday alone ("Sun · 1:00 PM ET") says less than it seems to |
| 7 | §7.3 | With no player on either side of a lineup row the centre label is the slot's own ("QB", "RB", "WR/TE"); a fullback's `pos` prints "RB" | The spec covers one side missing, not both; FB is RB everywhere on the site |
| 8 | §7.3 | TD–INT prints with a plain hyphen ("6-3"), as `fmtPair` does on the box score | Site convention for two whole numbers |
| 9 | §7.4 "7 pct lines" | There are 8 percent lines (Success rate plus the seven radar lines) and 5 EPA lines; all 8 go through `fmtRadarPct` | A miscount in the text; the table in §3.1 is what was built |
| 10 | §8.5 | The copy uses the curly apostrophe (M8 "game’s", "team’s"; M13 "aren’t"; M16 "This week’s") | Every other visitor-facing constant on the site does (`TEAM_TIERS_NOTE`, the radar notes), and a test now rejects a bare one |
| 11 | §8.5 | M4 is `overlayCountLine(tally)`; M6 `matchupRankNote(...)` (with all 32 teams: "Every rank is among all 32 teams in 2026, …"); M7 `matchupEdgeNote()`; M8 is `MATCHUP_FAMILY_NOTE` plus the two link texts as constants; M9 is `MATCHUP_FORMULA_NOTES` (the three existing notes) and `MATCHUP_FORMULA_LINE` (the three sub-lines joined); M11 is the existing `earlySeasonNote` and has no new export | The spec names the texts, not the identifiers |
| 12 | §6.1 `getSeasonGames` | "Logged once" is one `console.warn` per read naming how many rows were dropped and up to 12 ids. A row whose own `season` is unusable takes the season the read was filtered on | One line per read, not per row |
| 13 | §6.3 step 7 | `loadMatchup` returns a union: `ready` / `small-pool` carry `model`; `uncovered` carries `model: null` and `firstSeason`. `game`, `swap`, `records` and the lineup are filled in every state (the uncovered page's header and its order redirect need them) | The spec lists the fields, not the shape |
| 14 | §3.4 | `loadMatchup` does not log `model.rejected`; the page does, once (PR 2) | "The page logs `model.rejected` once" |
| 15 | §6.3 | An EMPTY slug list is not treated as a failed read here (names simply render unlinked) | The spec names only a rejected slug read; the compare card's stricter rule exists because an empty list there is a 404 for every player |
| 16 | §11 | One test file the spec does not name: `__tests__/data/matchup-requests.test.ts` counts PostgREST requests at a stand-in Supabase client with the real loaders running (8 cold, 0 warm, 0 per pair, 2 for `/matchup`). `matchup.test.ts` counts the seven loader calls | "Cold 8 requests (7 loader calls)" needs both levels |
| 17 | §11 "Golden" | The third pair is CHI at PHI (both have two games). The expected file also holds each edge's tug position and verdict text, and the script cross-checks its seven radar lines against the radar golden (448 cells identical) | More of the model pinned by the reference |
| 18 | §11 chaos list | The "1,000+ rows" unit case is 1,200 rows over 20 made-up teams. 1,200 made-up TEAMS takes over five seconds inside the two existing builders (both are quadratic in the number of teams), which does not matter at 32 | Found while writing the test; nothing was changed in the builders |
| 19 | §12 PR 1 "Verify" | Run on 2026-10-10 with the worktree as the working directory, each as its own command: `tsc --noEmit` clean; `next lint` exit 0 with the four warnings `main` already has (`ComparisonTool.tsx`, the three leaderboards; none in this PR's files); vitest 2810 passed / 100 files; pytest 824 passed, 20 skipped, 1 xfailed (as before); the placeholder-env `next build` green, its route table unchanged (no `/matchup` route). No database was read or written and no workflow was triggered | The record of what was checked |

**For PR 2.** Import links, `parseBall`, `parseMatchupSeason` and `parseMatchupTeamId` from `lib/stats/matchup-links.ts` in any `"use client"` file. Call `loadMatchup` only with ids that passed `parseMatchupTeamId` + `getTeam` and a season from `parseMatchupSeason`; it never throws on an unknown id, so the 404 is the route's job. The 307 target is `matchupHref(home, away, { season: load.season, defaultSeason: load.defaultSeason, ball: flipBall(ball) })`. Log `load.model.rejected` once when it is not empty. `records` is null exactly when `gamesAvailable` is false; `lineup` is null exactly when `playersAvailable` is false. `load.game` is the game in the order asked for (title "at" when it is not null, "vs" when it is). The index page's `slate` is null both when the season has no unplayed game (M14) and when the games read failed (M16): `gamesAvailable` tells them apart.
