# Team Radar — design spec (revision 3, spec review applied)

Date: 2026-10-06. Status: Jon approved the mockup and settled J1–J9 (§13). Spec review verdict: **APPROVED WITH CHANGES** (no critical findings); every IMPORTANT (I1–I8) and MINOR (M1–M14) finding is applied below. PR 1 (ingest columns) is the first thing built.
The mockup (`team-radar-mockup.html`, real 2026 numbers through Week 3), the mockup's aggregator (`compute_radar.py`) and the review itself were session working files and are not in the repo; this spec is the durable record. The two scripts that made PR 2's radar fixture pair ARE in the repo: `docs/superpowers/specs/team-radar-reference/make_radar_rows.py` and `make_radar_expected.py`. What PR 2 built differently from the text below is in "As built (PR 2)" at the end.

Changes from revision 1: stuff rate is now a settled database change (§3.1, §3.2); sharing is **one card per side** at `/card/team/[team_id]/[side]` instead of one card with both radars (§6–§8); the team-page section has a Share button under each radar; rollout is three independently shippable PRs (§11).

### Review changes applied (revision 2 → 3)

- **I1** PR 2 needs PR 1's columns to exist in production; the read-only check is a merge gate for PR 2; PR 1 waits for a *successful* refresh (§3.2, §11).
- **I2** The two new fields are typed `number | null` (§3.2).
- **I3** The state function is total: future season, gap season and a failed coverage probe each have a row (§7).
- **I4** `small-pool` is checked before `no-games`, so R10 is never a false promise (§7, §8).
- **I5** The image route resolves the season as the page does (unknown season → 404, no read, no render), validates before reading, decides `uncovered` before the big read, memoises the built model per season, and exports `runtime = "nodejs"` (§5, §7).
- **I6** Pytest pins the DDL order (table → columns → first upsert) and a single commit; the `CREATE TABLE` body edit is required by two existing tests (§3.2, §10).
- **I7** Glossary and tooltip entries are copy rows R17–R19 with a test each (§8).
- **I8** R5b says which rates keep penalty-wiped runs; bound to DET 36 vs 32 and TB 17 vs 15 in pytest (§3, §8, §10).
- **M1** radar numeric-parse list named (§3.2). **M2** defense sub-line "Opponent turnovers ÷ opponent drives" (§8 R7). **M3** "Through Week {w}" = max `week` in the radar rows (§8). **M4** which N is printed, per-spoke pools, `pool − 1 = 0` guard, league average for stuff missing with any NULL (§4, §9). **M5** tie test and "T-30th" (§4). **M6** two static Inter files plus the OFL licence (§5). **M7** optional `&w=` on the preview image URL (§7). **M8** double read on the share page accepted; `generateMetadata` never throws (§7). **M9** R9 only when the radar threshold is met (§8). **M10** `null`, never `NaN`, across the client boundary; the pure module imports nothing from `lib/data` (§6). **M11** the two route tests are the proof for `/card/team` and `/card/team/BUF` (§7). **M12** the ALTER's brief exclusive lock noted beside the function (§3.2). **M13** "62 columns" becomes 64 in `memory/MEMORY.md` and the comment in `lib/data/team-stats.ts` (§6). **M14** "table only" has its own sentence, R20 (§4, §8).

## 1. The request

Jon: "I also want a team radar chart for both offense and defense showing, Explosive pass rate, explosive run rate, success rate pass, success rate run, sack rate, stuff rate, and turnover rate. I want them to be sharable as well."

What ships:

1. A **Team Radar** section on every team page (`/team/[team_id]`): an Offense radar and a Defense radar side by side, seven spokes each, with the value, league rank and NFL average for every spoke in a table underneath, and a Share button under each radar.
2. **Two share pages per team**, `/card/team/[team_id]/offense` and `/card/team/[team_id]/defense`: one large radar plus its stat table, Copy Link and Download Image, and a link-preview image of the same card.
3. A sentence on `/team-stats` pointing to the radars.

## 2. Where the original assumptions did not survive the code

| Assumption | What the code says | What this spec does |
|---|---|---|
| Share URL carries `?side=offense\|defense` | A file-convention `opengraph-image.tsx` gets no `searchParams` (`app/card/[slug]/opengraph-image.tsx` line 2). | Side is a **path segment**: `/card/team/BUF/offense`. |
| Each axis = the team's percentile | `computePercentile` is "share of the pool strictly below": with 32 teams the best team scores 96.9 and never reaches the "league best" ring. | Rank-based scale: 1st on the outer ring, last on the inner ring. |
| An NFL-average ring | On a rank scale a ring is a rank, not a value. | The dashed ring is "middle of the league"; NFL averages are a table column. |
| rbsdm play filter for all seven | True for explosive and success rates. Sacks and turnovers are stored only as official box-score counts (2-point tries excluded). | Sack and turnover rates divide official counts by official denominators. |
| All seven axes are in `team_game_stats` | Six are. Stuff rate is not stored there. | Two new columns (§3.1). |
| The team hub can absorb one more read | It renders on every request (reads `searchParams`) and `getTeamHubData` swallows read errors into empty values. | The radar read is separate, has its own deadline, and has an explicit "unavailable" state. |

## 3. Definitions

Season value = sums over the team's `team_game_stats` rows for the season (regular season only). **Offense** = rows where `team_id` is the team. **Defense** = rows where `opponent_id` is the team (what opponents did), as `buildTeamStats` does. Never the mean of game rates.

| # | Spoke | Numerator | Denominator | Stored today? | Same number elsewhere |
|---|---|---|---|---|---|
| 1 | Explosive pass rate | Σ `explosive_pass` (completions of 20+ yards) | Σ `pass_plays` (rbsdm dropbacks: attempts, sacks, scrambles; EPA present) | Yes | Team Stats `expl_pass_rate` |
| 2 | Explosive run rate | Σ `explosive_rush` (runs of 10+, QB scrambles of 10+ included) | Σ `rush_plays` (designed runs; kneels and scrambles out) | Yes | Team Stats `expl_rush_rate` |
| 3 | Pass success rate | Σ (`pass_success_rate` × `pass_plays`) | Σ `pass_plays` | Yes | Team Stats `pass_sr` |
| 4 | Run success rate | Σ (`rush_success_rate` × `rush_plays`) | Σ `rush_plays` | Yes | Team Stats `rush_sr` |
| 5 | Sack rate | Σ `sacks` | Σ (`attempts` + `sacks`) | Yes (`dropbacks` is computed in ingest but not stored; sum the two columns) | Formula of QB `sack_pct` |
| 6 | Turnover rate | Σ `turnovers` (interceptions + fumbles lost) | Σ `total_drives` | Yes | Count = box score Turnovers row |
| 7 | Stuff rate | Σ `stuffed_runs` | Σ `designed_runs` | **No — PR 1 adds both** | Same `yards_gained <= 0` rule as RB pages and Run Gaps, different carry set (below) |

Notes that matter for honesty:

- Spokes 1–4 are the Team Stats page's numbers to the digit (checked on BUF and the league row).
- Pass success counts sacks as failed pass plays (team/rbsdm rule; the QB pages exclude sacks). Copy says "pass plays", never "passes".
- Explosive run keeps the known mismatch: scrambles are in the numerator, not the denominator (Team Stats footnote C4). Reused on purpose (J4) so the radar never disagrees with Team Stats.
- Sack rate uses official counts: 2-point tries excluded, a spike is an attempt, a scramble is in neither part.
- Turnover rate inherits the two documented limits of `turnovers`: a punt muffed by the receiving team is credited to nobody (strict xfail `2026_01_CHI_CAR`); a pick plus a separate lost fumble on one snap counts 1. `total_drives` is `nunique(drive)`; league-wide 10.72 per team-game through Week 3.
- Defense "takeaway rate" = opponents' turnovers ÷ opponents' drives.
- **Stuff rate differs from the RB pages' carry set.** The team number counts every designed run, including those by quarterbacks and receivers. `aggregate_rb_season_stats` keeps RB/FB carries only, and the run-gap tables (`aggregate_rb_gap_stats`) drop any run with no charted gap. So a team's stuff rate will not match its running backs' stuff rates. Kneel-downs are not the reason: `filter_plays` keeps them, but quarterbacks take them, so none reaches the RB tables (code review M2).
- `rush_plays` (spokes 2 and 4) includes penalty-wiped runs (they carry EPA); `designed_runs` (spoke 7) does not. In the week-1 fixture that is DET 36 vs 32 and TB 17 vs 15. The two denominators are named differently in the code and the copy says "designed runs" for all three, which is the fair plain-English name. The visitor is told the difference in footnote R5b and in the glossary entry R19, and pytest binds it to those fixture numbers (review I8).

League values through Week 3 (94 team-game rows; CHI and PHI have 2 games, the rest 3):

| Spoke | NFL | Best offense | Worst offense | Best defense | Worst defense |
|---|---|---|---|---|---|
| Explosive pass | 7.3% | SF 11.6% | ARI 1.5% | SEA 1.7% | JAX 12.4% |
| Explosive run | 11.1% | BUF 20.0% | ARI 5.3% | SF 3.5% | DET 17.4% |
| Pass success | 46.5% | SF 64.2% | MIN 34.4% | MIN 33.6% | DAL 58.9% |
| Run success | 39.6% | BUF 52.5% | NE 28.4% | SEA 23.6% | SF 49.4% |
| Sack rate | 6.4% | SF 0.0% | TB 11.6% | MIN 10.9% | MIA 0.0% |
| Turnover rate | 11.1% | WAS 2.9% | NE 26.7% | LV 25.7% | PHI 0.0% |

### 3.1 The two new columns (J1 = A, approved production database change)

In `_team_game_efficiency` (the efficiency set: `pass == 1 | rush == 1`, EPA present, a possessing team):

- `designed_runs` INT = rows with `rush == 1` **and** `play_type == 'run'` **and** `two_point_attempt != 1`.
- `stuffed_runs` INT = those rows with `yards_gained <= 0`.

Why each clause:

- `play_type == 'run'`: a penalty-wiped run is in the efficiency set with `rush == 1`, `play_type == 'no_play'`, `yards_gained == 0`. Without the clause it is a stuff: 6 of 151 rush plays in the week-1 fixture, doubling Detroit's stuffs (8 instead of 4) and adding 2 to Tampa Bay's.
- `rush == 1`: kneels (`rush == 0`) and scrambles (`pass == 1, rush == 0`) drop out on their own. Checked: the fixture's 3 kneels are `rush_attempt == 1, rush == 0, yards −1`.
- `two_point_attempt != 1`: a 2-point try has no line to gain and the site's existing stuff definition (`filter_plays`) already excludes them.

Pinned values from the committed fixture `tests/fixtures/pbp_2026_week1_games.parquet`:

| Team | `stuffed_runs` | `designed_runs` |
|---|---|---|
| BUF | 3 | 19 |
| HOU | 8 | 31 |
| DET | 4 | 32 |
| CIN | 4 | 25 |
| NO | 4 | 23 |
| TB | 3 | 15 |

Both columns are counts: every row ingest writes carries 0 when the team had none, never NULL (they join `TEAM_GAME_STATS_INT_COLS`). The only NULLs are rows written before the first refresh after the columns were added (§3.2). The rate is computed on the server at read time, so there is no stored rate and no NaN risk.

### 3.2 The column workflow, layer by layer

The repo's rule (`ensure_team_game_stats_table` comment, and the "adding a DB column" memory): `CREATE TABLE IF NOT EXISTS` is a no-op on the live table, so a new column needs its own `ALTER … ADD COLUMN IF NOT EXISTS` function.

| Layer | Change |
|---|---|
| Aggregation | `_team_game_efficiency`: add the two sums to the last `agg` block. `aggregate_team_game_stats`: nothing else (the INT fill loop picks them up). |
| Column lists | Add both names to `TEAM_GAME_STATS_COLS` (after `explosive_rush`) and `TEAM_GAME_STATS_INT_COLS`. `upsert_team_game_stats` builds its INSERT and its `ON CONFLICT … DO UPDATE SET` from `TEAM_GAME_STATS_COLS`, so the upsert needs no edit. |
| Live table | New `ensure_team_game_stats_columns(conn)`: `ALTER TABLE team_game_stats ADD COLUMN IF NOT EXISTS designed_runs INT`, same for `stuffed_runs`. Not `@retry`. Called right after `ensure_team_game_stats_table(conn)`, **exactly one commit of its own**, before the season transaction (never inside its `try:` block, where that commit would commit a half-written season). A nullable column with no default is a metadata-only change. Like every other `ensure_*` function it takes a brief exclusive lock on the table on every run (review M12); a comment beside the function says so, so nobody moves it into the transaction. It follows the existing `ensure_*_columns` functions, with one addition from the PR 1 code review (M1): `SET LOCAL lock_timeout = '10s'` runs first, in the same transaction, so a blocked ALTER gives up after 10 s instead of holding site reads behind it for up to the connection's 180 s statement timeout. The resulting `LockNotAvailable` is an `OperationalError`, which `run_seasons` already retries. The other `ensure_*` functions have no lock timeout yet (follow-up). |
| Fresh databases | Add both lines, typed `INT`, to the `CREATE TABLE` body so a new database matches. This is **required**, not optional: `test_ddl_declares_every_stored_column` and `test_ddl_column_types_match_their_category` fail without it (review I6). |
| Types | `lib/types/index.ts` `TeamGameStat`: `designed_runs: number \| null; stuffed_runs: number \| null;` with the doc line "NULL only on rows written before the first refresh after the columns were added; 0 otherwise." (review I2 — a bare `number` would repeat the "prop types lie" root cause of the F1 team-page crash). They are INT, so they are **not** added to `TEAM_GAME_NUMERIC` (that list is for NUMERIC columns that arrive as strings). |
| Loaders | `lib/data/box-score.ts` selects `*`, so the box score rows simply carry two more fields; nothing reads them there. `lib/data/team-stats.ts` `TEAM_STATS_COLUMNS` is **not** changed. The radar's own list (`TEAM_RADAR_COLUMNS`, PR 2) names both — **and therefore must not ship before the columns exist in production** (§11): PostgREST rejects a select that names an unknown column, the whole read fails, and every radar shows R13. **No site `select` list names the two columns in PR 1.** The radar's numeric-parse list is `TEAM_GAME_NUMERIC.filter(c => TEAM_RADAR_COLUMNS.includes(c))` — `pass_success_rate` and `rush_success_rate` only — as `lib/data/team-stats.ts` does; never the full list, which bolts nulls onto unselected fields (review M1). |
| Backfill | None by hand. Every refresh re-aggregates the whole current season and the upsert rewrites every column of every row, so the first successful scheduled refresh after PR 1 merges fills all 2026 rows. 2020–2025 have no `team_game_stats` rows. No `/api/revalidate` call is needed for PR 1 (nothing reads the columns yet). |
| Rows written before the first refresh | NULL in both columns. A refresh already queued on the old code still works (the old INSERT omits the nullable columns). A first refresh that fails after the ALTER committed leaves the columns present and NULL with nothing reading them. PR 2 treats a NULL in either column on any of a team's rows as "stuff rate missing" for that side (never as 0), and the league average for stuff is missing too when any row is NULL. |

Fixtures — how the new columns get in without invalidating a golden value:

| Fixture | Rule | What happens |
|---|---|---|
| `tests/test_team_game_stats.py` `GOLD` | "Never edit a GOLD value to make a test pass." A test asserts `set(GOLD['BUF']) == set(TEAM_GAME_STATS_COLS) − keys`. | **Add** four entries (BUF 19 / 3, HOU 31 / 8). No existing entry changes. The key-set test then passes again; the parametrized test covers the new columns automatically. The provenance comment above `GOLD` gains one line: these two come from this spec's rule, cross-checked by hand count in the fixture, not from rbsdm/ESPN. |
| `tests/fixtures/pbp_2026_week1_games.parquet` | Committed raw rows. | Unchanged. It already has `rush`, `play_type`, `two_point_attempt`, `yards_gained`. |
| `__tests__/fixtures/box-score-buf-hou.ts` | A typed `TeamGameStat` literal "with every column". | **Add** the two fields to BUF (19, 3) and HOU (31, 8) so `tsc` passes. No existing field changes; no box score assertion reads them. |
| `__tests__/stats/fixtures/team-game-stats-2026-w1-3.json` and `team-stats-2026-w1-3.expected.json` | "Never re-capture them." | **Not touched, not regenerated.** They carry 30 columns; the Team Stats page does not read the new ones. |
| New: `__tests__/stats/fixtures/team-radar-2026-w1-3.json` + `.expected.json` (PR 2) | New golden pair for the radar. | The same 94 `(game_id, team_id)` keys as the frozen Team Stats fixture. The columns the two fixtures share (`pass_plays`, `rush_plays`, `pass_success_rate`, `rush_success_rate`, `explosive_pass`, `explosive_rush`, `turnovers`, plus keys) are **copied from the frozen fixture**, not re-read. `attempts`, `sacks`, `total_drives`, `designed_runs`, `stuffed_runs` are joined on by key from a read-only export taken after PR 1's first refresh. A test asserts the shared columns are identical between the two fixtures, so the radar golden can never drift from the Team Stats golden. If the export's shared columns differ from the frozen ones (nflverse corrections since Sep 28), that is recorded in the fixture's README line, and the frozen values still win. The 6 fixture rows of week 1 that overlap the parquet (BUF, HOU, DET, NO, TB, CIN) must equal §3.1's table — a second cross-check. |

## 4. The scale (J5 = rank)

- Per spoke, per side: competition rank among teams with a value (1 = best, ties share the better place). The spoke's pool = teams with at least one game on that side and a non-zero denominator for that spoke.
- **Which N is printed (review M4).** R1, R3, R8 and R14b print one N: the number of teams with at least one game (`teamsPlayed`). Rank and radius use the spoke's own pool. The two only differ when a team has a zero denominator on a spoke (then that team's spoke is missing) or in the NULL window (then stuff is missing for every team, so no stuff rank is shown at all). When a spoke's pool is smaller than N, its table cell prints the pool beside the rank ("3rd of 31").
- Direction. Offense: higher is better for explosive pass, explosive run, pass success, run success; lower is better for sack, stuff, turnover. Defense: the reverse of all seven.
- Radius: `score = (pool − rank) / (pool − 1)`; plotted at `HUB + score × (1 − HUB)` of the outer radius, `HUB = 0.12`. Dashed ring at `score = 0.5`. `radarScore` guards `pool − 1 = 0`: a pool of 1 scores 1 (never `NaN` or `Infinity`); a pool of 0 has no value to score.
- Each spoke label prints the raw value and the rank (`10.7% · 2nd`). A tied rank prints with a "T-" prefix (`0.0% · T-30th`).
- **Ties (review M5).** Because ties share the better place, teams tied for last do not sit on the inner ring (three defenses with 0 takeaways among 32 all rank T-30th, at `score = 2/31`). R3's "last on the inner ring" describes the scale, not a promise that some team is on it. A test pins this so nobody "fixes" it later.
- A spoke with no value gets no vertex; the outline bridges its neighbours. Fewer than 4 real spokes on a side → no radar for that side, the table only, under the sentence R20 (review M14).
- Spoke order, clockwise from the top: Explosive pass, Pass success, Sack rate, Turnover rate, Stuff rate, Run success, Explosive run. On Defense the fourth label reads "Takeaway rate".

## 5. Reuse audit

| Existing piece | Verdict |
|---|---|
| `components/qb/RadarChart.tsx` | Reuse the geometry and the `missing[]` behaviour; do not edit it (every player page uses it; its legend would be false here). New `components/team/TeamRadarChart.tsx` with two-line labels and a size prop (team page and share page both use it). |
| `components/compare/OverlayRadarChart.tsx` | Not used. |
| `lib/stats/percentiles.ts` | `ordinal` only. Rank rule = `leagueRank` in `TeamIdentityCard.tsx` (competition ranking, non-finite skipped), re-implemented in the pure module. |
| `lib/stats/team-stats.ts` | Reuse `num`, the `wavg`/`total` rules, `parseSeasonParam`, `earlySeasonNote`, and the copy-constants-plus-footnote-function pattern. |
| `lib/data/team-stats.ts` | Same read pattern (`fetchAllRows`, explicit columns, `boxScoreDeadline()`, ordered). Separate column list. |
| `components/team/TecmoSectionCard.tsx` | The section's shell; the section wraps itself. |
| `app/card/[slug]/page.tsx`, `CardPageActions.tsx` | Copy the page layout and both buttons' look and behaviour into `TeamRadarActions` (takes the page URL and the download URL). `resolveCardSeason` is reusable for `?season=`. |
| `app/api/stat-card/[slug]/route.tsx` | Pattern for the image route's sanitized filename, `Cache-Control: public, max-age=0, s-maxage=3600`, and `export const runtime = "nodejs"` (the fonts are read with `fs`). **Not** its season handling: the radar route resolves the season as the share page does (§7, review I5), not with the 1999–2100 clamp and newest-season fallback. |
| `lib/og/tecmo-card-image.tsx` | Its radar is `<svg>` with `<path>`, `<line>`, `<circle>` only: no `<polygon>`, no `<text>` (Satori does not render svg text). Every element with children needs `display: flex`. `mp` is reusable as is (export it). `hp` and `ring` hardcode `CX = 125, CY = 125`: give them `cx, cy` parameters (existing caller passes today's constants) or keep local copies. Labels and the table are flex `div`s, labels absolutely positioned over the svg. Dashed strokes are untested in Satori here: verify on a Vercel preview, fall back to a solid amber ring. |
| Fonts for the image | Press Start 2P is bundled (`pixelFontOptions`). The table needs a readable font. A static TTF holds one weight and Satori does not handle variable fonts reliably, so bundle **two static Inter files** (600 and 800) — or one weight if two are not needed — plus Inter's OFL licence file in `app/fonts`, loaded with `readFile(join(process.cwd(), …))` like `loadPixelFont`. Check on the Vercel preview that both files are traced into the function (review M6). Do not fetch from gstatic at render time as `app/team/[team_id]/opengraph-image.tsx` does. |
| `@vercel/og` on Windows | Cannot render. The image is only testable on a Vercel preview. |

## 6. Data flow and files

```
team_game_stats (season)  ──getTeamRadarRows(season)──▶  rows (≤ 544)
                                                           │
                                   buildTeamRadar(rows) (pure, server)
                                                           │
                               TeamRadarModel { teams[], league, pool }
              │                             │                                │
   /team/[id] page.tsx        /card/team/[id]/[side] page      /api/team-radar/[id]/[side]
   one team's slice, as       one side: radar + table           PNG of one side
   plain props, into the      + actions                         (link preview + download)
   "use client" hub
```

**PR 1 (ingest):** `scripts/ingest.py`, `tests/test_team_game_stats.py`, `tests/test_team_game_stats_pipeline.py`, `lib/types/index.ts`, `__tests__/fixtures/box-score-buf-hou.ts`, `memory/MEMORY.md`, and the "62 columns" comment in `lib/data/team-stats.ts` (a comment only; 64 after this PR — review M13). No site `select` list changes.

**PR 2 (team page):**
- New `lib/data/team-radar.ts` (server-only): `TEAM_RADAR_COLUMNS` = `game_id, team_id, opponent_id, season, week, pass_plays, rush_plays, pass_success_rate, rush_success_rate, explosive_pass, explosive_rush, attempts, sacks, turnovers, total_drives, designed_runs, stuffed_runs`; `getTeamRadarRows(season)`.
- New `lib/stats/team-radar.ts` (pure): `RADAR_AXES`, `RADAR_SIDES` (`offense`/`defense` ↔ `off`/`def`), `buildTeamRadar`, `radarScore`, `teamRadarState`, every copy constant, `teamRadarFootnotes`, `radarCardHref(teamId, side, season, defaultSeason)`. It imports nothing from `lib/data` (it is pulled into the `"use client"` hub's graph), and a test asserts that (review M10).
- The slice passed from `page.tsx` into the `"use client"` `TeamHubContent` is plain data that uses `null` for every missing value — never `NaN` or `Infinity`, which do not survive the server→client boundary (review M10).
- New `components/team/TeamRadarChart.tsx`, `components/team/TeamRadarSection.tsx`.
- Changed `app/team/[team_id]/page.tsx` (one more entry in the existing `Promise.all`, try/catch like the box-score probe), `components/team/TeamHubContent.tsx` (new prop; section after the two `ScheduleSection`s, before `PassingSection`), `app/team-stats/*` (copy R9), `components/ui/MetricTooltip.tsx` and `app/glossary/page.tsx` (team Sack rate, Turnover rate, team Stuff rate), new radar fixtures and tests.
- **The Share buttons are part of PR 3**, so PR 2 is complete on its own with no dead links.

**PR 3 (sharing):**
- New `app/card/team/[team_id]/[side]/page.tsx`, `app/card/team/[team_id]/[side]/TeamRadarActions.tsx`.
- New `app/api/team-radar/[team_id]/[side]/route.tsx`, `lib/og/team-radar-image.tsx`, the Inter TTF.
- Changed `components/team/TeamRadarSection.tsx` (a Share button under each radar), `lib/og/tecmo-card-image.tsx` (export `mp`).

PR 1 ends with a `memory/MEMORY.md` update only (the two new columns and the PR 2 gate; nothing in `.claude/CLAUDE.md` is stale after it). PRs 2 and 3 end with `.claude/CLAUDE.md` and `memory/MEMORY.md` updates (the "stats only in ingest" exception now also covers the radar; the new routes).

Cost on the team page: one more PostgREST request per view (17 narrow columns, at most 544 rows; still through `fetchAllRows`). The page already makes about 13.

Route handlers that read Supabase need an explicit `revalidate` (MEMORY: without one a handler's fetches can be pinned for a year). The image route exports `revalidate = 0` and `runtime = "nodejs"`; `/card` is already revalidated as a layout path by `app/api/revalidate/route.ts`, which covers the new pages.

## 7. URLs, the preview image's season, and every state

- Team page: no new URL state. Anchor `#team-radar` on the section.
- Share pages: `/card/team/[team_id]/[side]`, `side` is exactly `offense` or `defense` (lower-cased before the check; anything else → `notFound()`). `team_id` is upper-cased like the hub; unknown → `notFound()`.
- `/card/team/BUF` (no side) and `/card/team` are 404s: there is no page at those levels. **The two route tests are the proof** (review M11) — today `/card/team` falls through to `app/card/[slug]` with slug `team` and 404s via `getPlayerBySlug`; do not rely on reasoning about route precedence.
- Season: `?season=YYYY` on the page, parsed by `resolveCardSeason`. Canonical and `og:url` keep `?season=` when it was asked for (player-card rule). The Share buttons and Copy Link carry the season with `radarCardHref`: bare URL for the default season, `?season=` for a past one (the `playerHref` rule), so a link shared today keeps meaning "the newest season" and never silently freezes.
- Not in the sitemap (no `/card/` URL is).

**How the preview image picks its season.** The page's `generateMetadata` receives `searchParams`, so it sets `openGraph.images` and `twitter.images` explicitly to `/api/team-radar/[team_id]/[side]?season=YYYY` (1200×630), where `YYYY` is the season the page resolved. There is no `opengraph-image.tsx` in the folder. Result: **the preview shows the same season as the link**, including past seasons, and the image prints its season and "Through Week N" in its header band. This is better than the player card, whose file-convention image is always the newest season. Because the site has not used an explicit image URL before, PR 3 verifies it on the Vercel preview (paste a `?season=` link into a preview debugger). If it cannot be made to work, the fallback is a file-convention `opengraph-image.tsx` in `[side]/` — it gets `team_id` and `side` but no query, so it shows the newest season only — and then copy R15 is added to past-season share pages. R15 ships only with the fallback.

- Optional (review M7): the `og:image` URL is identical all season, so platforms that cache by URL keep an old picture. Appending the through-week (`&w=3`, ignored by the route) makes each week a new URL. Decide in PR 3.
- Download: the same route with `&download=1`, which adds `Content-Disposition: attachment; filename="BUF-offense-2026-radar.png"`.

**The image route, in order (review I5).** (1) Validate `team_id` and `side` — unknown → 404 before any database read. (2) Resolve the season exactly as the page does (`getAvailableSeasons` + `resolveCardSeason`): an absent `season` means the newest; a season the site does not have → **404, no row read, no render** (never a newest-season card under a new cache key). (3) Decide `uncovered` from the memoised `getBoxScoreSeasonsCached` before the big read, so a past season's plate costs no 544-row read. (4) Read and build through a short in-process memo of the built model per season (in-flight promise, deleted on rejection — the `getBoxScoreSeasonsCached` pattern), shared with the share page. Junk query parameters (`?x=1`) still bust the CDN cache, the same exposure `/api/stat-card` has today; that is **accepted**, because steps 2–4 bound what a cache-busting request can cost to one Satori render and no extra database read.

**Share page metadata (review M8).** `generateMetadata` needs the model (week, N, missing spokes). With the per-season memo the page and its metadata share one read; without a warm memo it is two, which is accepted (no `cache()`, by house rule). If the read fails inside `generateMetadata` it does not throw: it returns a plain title and `noindex`; the page body then throws into `error.tsx`.

**States.** `teamRadarState` is a total function, evaluated top to bottom; the first match wins (review I3, I4):

| # | Condition | State |
|---|---|---|
| 1 | the read rejects | `unavailable` |
| 2 | rows > 0 and fewer than 8 teams have played | `small-pool` |
| 3 | rows > 0 and this team has no row | `no-games` |
| 4 | rows > 0 | `ready` (per side: fewer than 4 real spokes → table only, R20) |
| 5 | rows = 0 and (the season is the newest data season, or the coverage probe says it is covered) | `unavailable` |
| 6 | rows = 0 and the season is later than the newest data season | `small-pool` (R11 is true: no team has played) |
| 7 | rows = 0 otherwise (older than the first covered season, a gap season after a partial backfill, or the probe returned `[]` so the first covered season is unknown) | `uncovered` |

`small-pool` is checked **before** `no-games`: on opening Thursday a team that has not played yet is told R11, not R10's "appears after their first game", which would be false while fewer than 8 teams have played. Row 6 exists because the hub offers season + 1 once its schedule is published and `?season=2099` passes the hub's unvalidated `parseInt`. In row 7 the first covered season is modelled as `firstSeason: number | null` (as `lib/data/team-stats.ts` does): R12 is used only when it is known **and** the viewed season is older; otherwise R12b, which names no year.

| State | Team page section | Share page | Image route |
|---|---|---|---|
| ready | both radars, tables, Share buttons | radar + table + buttons | card PNG |
| no-games | R10, no Share buttons | 200, noindex, R10 + link to team page | branded plate with team name |
| small-pool | R11, no Share buttons | 200, noindex, R11 | branded plate |
| uncovered | R12 or R12b | 200, noindex, R12 or R12b | branded plate (no row read) |
| unavailable | R13 (the hub must not 500) | throws → `error.tsx` (dynamic, not cached) | 500, `no-store` |
| unknown team / bad side | existing 404 | `notFound()` | 404, before any read |
| a season the site does not have | existing behaviour (rows 6–7 above) | `notFound()` | 404, no read, no render |

## 8. Copy (every sentence is a constant in `lib/stats/team-radar.ts` and has a test)

| ID | Where | Text | The test that keeps it true |
|---|---|---|---|
| R1 | section lead | "How the {Team} rank among all {N} teams, through {G} games." — "all" only when N = 32, otherwise "the {N} teams that have played"; "1 game" singular | N equals the pool; G equals the team's row count |
| R2 | side subtitles (section, share page, card table header) | "What the offense did" / "What opponents did against this defense" (card header: "What opponents did") | offense from `team_id` rows, defense from `opponent_id` rows (swap test) |
| R3 | footnote | "Each spoke shows the team's rank among the {N} teams that have played: 1st sits on the outer ring, last on the inner ring, and the dashed ring is the middle of the league. Farther out is always better." | `radarScore(1, N) = 1`, `radarScore(N, N) = 0`, ring at 0.5; a better raw value never has the smaller radius, every axis, both sides |
| R4 | footnote | "On offense a lower sack rate, stuff rate and turnover rate ranks higher. On defense it is the reverse: more sacks, stuffs and takeaways rank higher, and lower explosive and success rates allowed rank higher." | direction table asserted axis by axis |
| R5 | footnote | "Every rate adds up the team's box scores for the season. A pass play is any dropback, including sacks and scrambles. QB scrambles of 10+ yards count as explosive runs but not as designed runs, so a team with long scrambles can run high on Explosive run." | weighted-not-mean test; dropback and scramble clauses pinned in pytest |
| R5b | footnote | "Stuff rate leaves out kneel-downs, two-point tries and runs wiped out by a penalty; Run success and Explosive run keep two-point tries and penalty-wiped runs, as the Team Stats page does." | PR 1's synthetic pytest rows (the two-point clause is pinned only there — the week-1 fixture has no two-point run, so that test is not redundant), and the fixture's DET `rush_plays` 36 vs `designed_runs` 32 and TB 17 vs 15 |
| R6 | footnote, weeks 1–4 of the newest season | `earlySeasonNote`: "With only {n} weeks played, one game moves a team a long way." | existing tests |
| R7 | table sub-lines | "Completions of 20+ yards ÷ pass plays" · "Pass plays with EPA above zero" · "Sacks ÷ (pass attempts + sacks)" · Offense: "Turnovers ÷ drives", Defense (under "Takeaway rate"): "Opponent turnovers ÷ opponent drives" · "Runs for no gain or a loss ÷ designed runs" · "Designed runs with EPA above zero" · "Runs of 10+ yards ÷ designed runs incl. penalty-wiped runs and two-point tries" (code review M1: this row divides by `rush_plays`, the Stuff row by `designed_runs`, and both used to say "÷ designed runs" over two counts, BUF 80 and 78) | numerator and denominator column names asserted against `RADAR_AXES`; thresholds pinned in pytest; the defense table renders the defense sub-line (review M2) |
| R8 | card footer | "Farther out = better rank among the {N} teams · dashed ring = middle of the league" | same as R3 |
| R9 | `/team-stats`, **only when `teamsPlayed ≥` the radar threshold constant** (review M9) | "Each team's page has a radar of its explosive, success, sack, stuff and turnover rates." | spoke list equals `RADAR_AXES`; not rendered with 7 teams played, rendered with 8 |
| R10 | no-games | "The {Team} have not played a {season} game yet. Their radar appears after their first game." | state test; with 2 teams played a third team's state is `small-pool`, not `no-games`, so R10 is only ever shown when it is true (review I4) |
| R11 | small-pool | "Team radars start once 8 teams have played this season. Until then there are too few teams to rank against." | the threshold constant drives the rule and the sentence; also the state for a season later than the newest data season |
| R12 | uncovered, first covered season known and the viewed season older | "Team radars start with the {first} season." | no backfill promise |
| R12b | uncovered, otherwise (gap season, or the coverage probe returned `[]`) | "Team radars are not available for the {season} season." | state test per branch, including probe = `[]`; never interpolates an unknown year |
| R13 | unavailable | "The team radar is unavailable right now." | rendered when the read rejects |
| R14 | share page title | "{Team} Offense Radar {season} — Yards Per Pass" / "{Team} Defense Radar {season} — Yards Per Pass" | side word comes from the validated segment |
| R14b | share page description | Offense: "{Team} offense through Week {w}: explosive pass and run rates, pass and run success, sack rate, stuff rate and turnover rate, ranked against every NFL team." Defense: "{Team} defense through Week {w}: the explosive plays and success rates it allowed, and its sack, stuff and takeaway rates, ranked against every NFL team." | "every NFL team" only when N = 32, else "the {N} teams that have played"; a missing spoke is dropped from the list; `w` is the max `week` in the season's radar rows — the same read as the numbers, never a second `data_freshness` read (review M3) |
| R15 | share page, past season, **fallback only** | "Link previews show the {newest} season." | only rendered when the file-convention image is in use and the page's season is not the newest |
| R16 | buttons and links | "Share offense radar" / "Share defense radar"; on the share page "See the {Team} defense radar →" (or offense) and "View the full {Team} page →" | hrefs asserted, season carried |
| R17 | `MetricTooltip` + glossary, new key "Team sack rate" | "Sacks divided by pass attempts plus sacks, added up over the team's games. Scrambles and two-point tries are not counted." | denominator columns (`attempts`, `sacks`) asserted against `RADAR_AXES` |
| R18 | `MetricTooltip` + glossary, new key "Team turnover rate" | "Turnovers (interceptions plus fumbles lost) divided by the team's drives. On defense it is the takeaway rate: opponents' turnovers divided by opponents' drives." | numerator and denominator columns (`turnovers`, `total_drives`) asserted against `RADAR_AXES` |
| R19 | `MetricTooltip` + glossary, new key "Team stuff rate" | "Designed runs stopped for no gain or a loss, divided by designed runs. Kneel-downs, QB scrambles, two-point tries and runs wiped out by a penalty are left out. It counts every designed run, including those by quarterbacks and receivers, so it will not match the running backs' stuff rates." | columns (`stuffed_runs`, `designed_runs`) asserted against `RADAR_AXES`; the text must name kneel-downs and penalty-wiped runs, and say it counts quarterbacks' and receivers' runs and so does not match the backs' rates |
| R20 | a side with fewer than 4 real spokes | "Not enough of these rates are available yet to draw the {offense/defense} radar." | rendered with 3 real spokes, not with 4; the table still renders (review M14) |

R17–R19 are **new keys**. The existing player entries in `MetricTooltip.tsx` (`"Stuff%"`, `"Explosive%"`, the QB sack-percentage entry) are not edited (review I7).

## 9. Small samples

- Rates are play-weighted; a team with 2 games is ranked on its own rate, and the lead line says how many games.
- Every sentence prints N (teams with at least one game, §4). Never "of 32" when fewer have played.
- No radar until 8 teams have played (J9); that check comes before "this team has not played" (§7).
- Ties: 0 turnovers forced (PHI defense today) or 0 sacks allowed (SF) are real values. Tied teams share the better rank and print "T-"; teams tied for last are not on the inner ring (§4).
- Zero denominator → that spoke is missing, not 0. A value of exactly 0% is plotted.
- Stuff rate is missing for a side when either new column is NULL on any of that side's rows (a partly written season, or rows not yet rewritten by a refresh). The league average for stuff is missing whenever any row in the season is NULL.

## 10. Tests

Pytest (PR 1): the four added `GOLD` values; a fixture-wide assertion of §3.1's six-team table; the penalty-wiped-run trap on the real fixture (the 6 `no_play` rush rows are 4 DET + 2 TB; DET would be 8 and TB 5 without `play_type == 'run'`; DET `rush_plays` 36 vs `designed_runs` 32 and TB 17 vs 15, which binds R5b — review I8); defense = the opponent's rows, unaffected; synthetic rows via the `raw` fixture — a 0-yard run is a stuff, a −2 run is a stuff, a 1-yard run is not, a penalty-wiped run is in neither column, a kneel in neither, a scramble in neither, a 2-point run in neither, a stuffed run that is also a lost fumble counts once, a team with no runs gets 0 and 0; `ensure_team_game_stats_columns` issues both `ADD COLUMN IF NOT EXISTS` statements and **commits exactly once**; the run calls it in the order `ensure_team_game_stats_table < ensure_team_game_stats_columns < first upsert_*` (review I6 — "is called" alone would pass with the ALTER inside the season `try:` block); the `CREATE TABLE` body declares both columns as `INT` (the two existing DDL tests enforce it); both names are in `TEAM_GAME_STATS_COLS` and `TEAM_GAME_STATS_INT_COLS`; `upsert_team_game_stats` sends ints.

Vitest (PR 2): golden over the new radar fixture pair; the shared-columns-identical test against the frozen Team Stats fixture; spokes 1–4 equal `buildTeamStats` for all 32 teams on both sides; direction, rank, ties (teams tied for last are not on the inner ring; "T-" label), radius, `radarScore` with a pool of 1, missing spoke, NULL new columns (stuff missing for the side and for the league average), < 4 spokes (R20), pool sizes 0 / 1 / 7 / 8 / 32, unknown team id, numeric strings, `"NaN"`, 1000+ rows; one state test per row of §7's function, including `small-pool` before `no-games`, a season later than the newest, a gap season, and probe = `[]`; every copy row including R12b and R17–R20; R9 rendered only at the threshold; the pure module imports nothing from `lib/data`; chart and section component tests (one vertex per real spoke, gray label on a missing one, each state's message, no `NaN` in any `d`, the defense sub-line); team route test (radar read rejecting still renders the hub; the slice carries `null`, never `NaN`).

Vitest (PR 3): share page — both sides render, `Offense`/`DEFENSE`/`sideways` handling, lower-case team id, `/card/team/BUF` and `/card/team` are 404, metadata (canonical, `og:image` URL carries side and season, noindex on message states, a failed read in `generateMetadata` returns a plain noindex title and does not throw); image route — a season the site does not have is a 404 with **no row read**, unknown team or side is a 404 before any read, an uncovered season makes no row read, attachment header only with `download=1`, sanitized filename, `revalidate` and `runtime` exports present, the per-season memo deletes a rejected entry; Share buttons' hrefs.

Chaos testing (CLAUDE.md gate) after each of PR 2 and PR 3, before review.

## 11. Rollout — three PRs, each shippable alone

| PR | Contains | Safe alone because | Verify |
|---|---|---|---|
| 1 — ingest columns | §3.1, §3.2 ingest + types + the two additive fixture edits + pytest | Nothing reads the columns. The ALTER is additive and idempotent. If the frontend never ships, two unused INT columns exist. | Before merging: `gh run list --workflow data-refresh.yml --limit 3` (no refresh mid-run). After merging: wait for one **successful** scheduled refresh (`gh run list` shows `success`, not just completed; do not trigger one), then a read-only check that both columns exist and are non-NULL on every 2026 row, that `stuffed_runs ≤ designed_runs ≤ rush_plays` on every row, and that the six week-1 rows match §3.1. A failed first refresh is tolerated (the ALTER commits on its own before the season transaction, so the worst case is columns present and NULL with nothing reading them) — wait for the next one. |
| 2 — team-page radars | pure module, read, chart, section, Team Stats sentence, tooltips, glossary, radar fixtures | **Requires PR 1's columns to exist in production** — `TEAM_RADAR_COLUMNS` names them, and PostgREST rejects a select naming an unknown column, which would put R13 on every team page. Works while the columns are still NULL (stuff spoke missing) and without PR 3 (no Share buttons yet). **Merge gate: PR 1's read-only check has passed** (both columns exist and are non-NULL on every 2026 row). | `npx --no-install next dev -p 3100`; all 32 teams; phone width; a 2025 view shows R12. |
| 3 — share cards + images | share pages, actions, image route, preview metadata, Share buttons | Additive routes; the section only gains two links. | Vercel preview (needs Jon's login): both sides for all 32 teams — label clipping ("Tampa Bay Buccaneers"), light team colours on white, dashed ring, a `?season=` link's preview. |

After each PR: `tsc --noEmit`, `next lint`, vitest, pytest, build — separate commands — then the memory file (and CLAUDE.md for PRs 2 and 3, §6). Capture the radar fixture's new columns (§3.2) between PR 1's successful refresh and PR 2; that capture is the same read-only check that gates PR 2.

## 12. What the mockup shows and what it does not

- Real: all 32 teams, both sides, six spokes, ranks and NFL averages, from the 94 saved rows through Week 3 (the Monday night Week 3 game is not in that file, so CHI and PHI show 2 games).
- Placeholder: **Stuff rate**, everywhere it appears, clearly marked. No number was invented; the saved rows predate the new columns.
- Section B and C have a yellow Offense/Defense toggle. That toggle is a mockup control; on the live site each side is its own URL, and the two pages link to each other (R16).
- The share page in the mockup shows the 1200×630 card image at every width. The live share page is HTML built from the same components as the team page, so on a phone the table sits under the radar at readable size; only the downloaded and previewed image is fixed at 1200×630.
- The identity card at the top is a stand-in. Buttons do not copy or download.

## 13. Decisions

All nine were settled by Jon on 2026-10-06:

| # | Question | Decision |
|---|---|---|
| J1 | Where stuff rate comes from | Two new INT columns on `team_game_stats`: `designed_runs`, `stuffed_runs`. Production database change approved. `play_type == 'run'` is required so a penalty-wiped run is never a stuff. |
| J2 | Turnover rate denominator | Per drive (`turnovers ÷ total_drives`) |
| J3 | Sack rate denominator | `sacks ÷ (attempts + sacks)` |
| J4 | Explosive run rate | Reuse the Team Stats number, with its existing caveat |
| J5 | Scale | Rank: 1st on the outer ring, last on the inner ring, dashed ring = middle of the league |
| J6 | Share cards | Separate cards: `/card/team/[team_id]/[side]`, a Share button under each radar (Jon overrode the one-card recommendation) |
| J7 | Share URL family | `/card/team/…` |
| J8 | Position on the team page | Under the schedule, above Passing Attack |
| J9 | Minimum teams before a radar shows | 8 |

Still open and not new: the 2020–2025 backfill (until it runs, past seasons show R12).

## 14. As built (PR 2, 2026-10-06)

Where PR 2's code differs from, or adds to, the sections above (after its chaos pass and code review). PR 3 builds on these, not on the older wording.

1. **Pool and "played" (§4, §7 row 3).** A team has played when it has a row of its own (`team_id`). Every spoke's pool, on both sides, counts only those teams, so no rank can exceed the N the lead prints. A team with only an opponent's row (a half-written game) is `no-games` (R10), not a radar "through 0 games".
2. **Ties (§4).** Two season rates within `RADAR_TIE_EPSILON` (1e-9) are the same rate: they share the better place and print "T-". The two weighted spokes re-multiply stored game rates and carry float noise, which exact comparison ranked 1st and 2nd. The Python reference uses the same rule; the expected file did not change.
3. **Impossible rates (new).** A rate outside 0–1 (stuffed > designed, a negative count, a stored game rate above 1) is a missing spoke, never printed or ranked. The NFL average for that spoke is blanked too (one bad row is diluted, not removed, by the league sum), and the page logs it once per render.
4. **Row hygiene (new).** `buildTeamRadar(rows, season)` ignores rows of another season and counts a repeated `(game_id, team_id)` once (first kept). The read still filters by season; the builder does not take it on trust.
5. **Outline colour (new; PR 3's card must use it).** `radarStrokeColor(primary, secondary)` in `lib/stats/team-radar.ts`: the primary when it is 3:1 or better on white, else the secondary if that is, else `#0f172a`. The light primary stays as the fill tint. Today that changes PIT and NO (gold, under 2:1) to `#101820`.
6. **Fixture provenance (§3.2).** The five extra columns were not joined from a database export. They were computed from the public nflverse play-by-play by ingest's own `aggregate_team_game_stats`, restricted to the frozen fixture's 47 game ids, with no database (`make_radar_rows.py`). The shared columns recomputed identical to the frozen ones (0 differences) and are still copied from the frozen fixture.

Also as built: R7's Explosive run sub-line is longer (see §8); R9 lives in `components/tables/TeamStatsTable.tsx`; the rank chip colour uses the mockup's thirds at 32 teams and the same positions on the 0–1 scale in a smaller pool; the radar read passes its own 5 s signal, so the site-wide read limit leaves it alone (one limit). **For PR 3:** the chart's `lg` size overflows its viewBox by about 4 units on the longest labels and must be fixed before it is used.

## 15. As built (PR 3, 2026-10-06)

Where PR 3's code differs from, or adds to, the sections above.

1. **A failed read in `generateMetadata` throws (§7, review M8 reversed).** The older text said it returns a plain noindex title. Read resilience PR 1A's rule won: a failed read rejects from the page and from its metadata, so a real card never gets a guessed title. `/card` has no `loading.tsx`, so that is a real 500 from `app/error.tsx`.
2. **The image route answers 503, not 500, when a read fails (§7 state table).** `cache-control: no-store`, `Retry-After: 60`, plain text "Team radar image temporarily unavailable. Try again in a few minutes." The same answer when the newest season's rows come back empty, or `data_freshness` is empty on a real database. (Which 404s are stored was changed after the chaos pass: item 13.)
3. **Side is matched exactly (§7).** `offense` or `defense`; `Offense` is a 404 (one URL per card). The team id is still upper-cased, as on the team hub.
4. **Season (§7).** `resolveRadarCardSeason` in `lib/stats/team-radar.ts`, not `resolveCardSeason`: the same rule plus a 1999-2100 range check, so an impossible number is a 404 before the first read on the image route. The canonical and `og:url` come from `canonicalSeason` itself (the page calls the helper; bare for the newest season even when `?season=<newest>` was asked for; `?season=` for a real past season), which matches what the Share buttons and Copy Link produce.
5. **Preview image URL (§7, review M7 decided).** `og:image` and `twitter:image` are the image route with `?season=` and, for a ready card, `&w=<through week>`. No `opengraph-image.tsx` exists in the folder, and R15 is not built (it belongs to the fallback only).
6. **One loader, and the memo holds rows (§7 step 4).** `lib/data/team-radar-card.ts` `loadTeamRadarCard` serves the page, its metadata and the image route. The one-minute per-season memo stores the season's rows (the in-flight promise; a rejection is dropped), not the built model: `teamRadarSlice` is unchanged from PR 2 and building is cheap.
7. **`/card/team` and `/card/team/[team_id]` are real pages that only call `notFound()` (§7, review M11).** Without them `/card/team` fell through to the player card route and read `player_slugs` before its 404. Checked on a local dev server: both answer 404.
8. **Fonts (§5, review M6 not met).** No Inter TTF is in the repo and none was downloaded. The image registers Press Start 2P (band, plate, site line) and the Noto Sans regular file that ships inside next/og (labels, table, footer), both read from disk. Regular weight only, so the image has no bold text. Bundling static Inter 600 / 800 with its OFL file is still open.
9. **The image has no table sub-lines (mockup section C).** The Explosive run sub-line as built in PR 2 is 78 characters and the image's stat column is about 190 px. The share page keeps every sub-line.
10. **Shared geometry (§5).** `RADAR_SIZES` (sm / lg / card), `radarPoint`, `radarPathD`, `radarLabelPosition` and `plottableScore` live in `lib/stats/team-radar.ts`; the page chart and the image both draw from them. `mp` in `lib/og/tecmo-card-image.tsx` was not exported or changed. `lg` is 680 wide (was 640); in a browser the longest possible label ("100.0% · T-32nd") measured 137 units against 157 available.
11. **A side with fewer than 4 real spokes** has no Share button on the team page; its share page and image still exist and show R20 with the table.
12. **One load per request (chaos W1).** The share page's loader is wrapped in React's `cache()`, keyed on two plain values (the team id and the season number asked for, or null), so `generateMetadata` and the page body await the same promise and can never name different seasons or weeks. This is the first `cache()` in the repo: it exists only in the react-server build, so the page's test file replaces `react`'s `cache` with a per-request stand-in (any other test that imports this page must do the same).
13. **The image route draws only for its one exact query form (chaos R1; supersedes item 2's "a 404 is `no-store`", item 4's "impossible number" wording and §7's "junk query parameters … accepted").** No query, or `season` (four digits, 1999-2100), `w` (one or two digits) and `download=1`, each at most once and no other key (`parseRadarImageQuery`). Anything else is a 404 before any read or render, sent with `cache-control: public, max-age=0, s-maxage=3600` so repeating a junk URL costs nothing; the same header on the unknown-team and unknown-side 404s. A well-formed season the site does not have yet stays a `no-store` 404. The share PAGE keeps the site-wide rule (a junk `?season=` is the newest season), and the image URL it prints is always the exact form. The route's seasons list goes through the same one-minute memo as the rows (`getAvailableSeasonsCached`).
14. **A failed coverage probe (chaos R3; §7's state table read closely).** Row 7 of the table gives R12b to a probe that *returned* `[]`, and the team page still maps a failed probe to `[]` because the hub must not fail. On a share card the sentence is the whole content, so `loadTeamRadarCard` rejects when the probe failed AND the answer depended on it (a season other than the newest whose rows came back empty): the page throws and the image route answers 503 `no-store`, instead of the vaguer R12b going out as a success the CDN keeps for an hour. A failed probe is still harmless when the season's rows are there. R12b remains for a gap season the probe did report.
15. **Team id (chaos N3).** Two or three ASCII letters, checked before upper-casing (`parseRadarTeamId`), on the page and the image route: "ſf" and "pıt" upper-case to SF and PIT and used to reach those teams on the image route.
16. **Copy Link (chaos N6; new copy row R16b).** "Copy failed: use the address bar" when nothing reached the clipboard (the clipboard API refused and the old copy command returned false, threw or is missing); "Copied!" only when a copy succeeded. No stray input is left in the page.
17. **Page and image freshness (chaos N1).** The share page exports `revalidate = 3600`, so its Supabase reads sit in Next's data cache for up to an hour; the image route (`revalidate = 0`) reads through the one-minute memo. The two share that memo, so when a share-page view in the same server instance has just filled it from the data cache, an image drawn in the next minute is as old as the page (never older). `/api/revalidate`'s `revalidatePath("/card", "layout")` covers `/card/team/*`, so after a refresh whose revalidate call succeeds the page is current on its next view. That call does not keep the two together in every case: it clears neither the in-process memo (up to a minute) nor images the CDN already holds (up to an hour per URL). A new week is a new `&w=` preview URL, so the preview catches up at once; a same-week correction, and the Download URL (which has no `w`), can lag the page by up to an hour. If the revalidate call fails or has not landed, it is the other way round: the image is ahead of the page until the page's hour turns over.
18. **The memo keeps an empty answer for its minute (code review M6, accepted).** A rejection is dropped at once, but a read that *resolves* empty (`data_freshness` with no rows on a real database, or no rows for the newest season) is memoised like any other, so every image request on that instance answers 503 for up to 60 s instead of retrying on the next request. The answer is still right and never stored by the CDN. If it ever matters: also delete the entry when the resolved value is an empty array.
19. **Rendered locally, not yet on Vercel (code review, 2026-10-06).** next/og's own loader fails on Windows because the three module-load file reads in the bundled `@vercel/og` (`index.node.js`: `fs.readFileSync(fileURLToPath(join(import.meta.url, "../<file>")))`) resolve wrongly there. The reviewer ran this branch's `teamRadarCardImage`, `teamRadarPlateImage` and `radarImageFonts` through a scratch copy of that file with those three paths made absolute (nothing in the repo or `node_modules` changed), on the 2026 weeks 1-3 fixture. The PNGs draw correctly: pixel band, dashed amber ring, 13% tint, all seven two-line labels inside the pane even at "100.0% · T-32nd" with the longest band text, dark outline on PIT and NO, missing spokes, the table-only card, the plate, and the no-fonts fallback. The response carried exactly one `cache-control` header. **Still to confirm on a Vercel preview:** that both font files are readable inside the function (the local build trace cannot show it: `node_modules` is a symlink in the worktree). The signs of a miss are a band that is not pixel-styled or bold table text, and a `Team radar image: font … unavailable` line in the function log. Also look at one ready card, one `&download=1` (file name `BUF-offense-2026-radar.png`), one past-season plate, and the preview of a `?season=` link; if the first image looks broken, retry with an unused `&w=` value so the CDN's copy is not what is on screen. **If a font is missing**, add this to `next.config.mjs` (Next 14.2 key; not added now, because the same loading pattern already works for `/api/stat-card` without it):
20. **Changed with the comparison card (compare card spec §16b, 2026-10-09).** (a) `memoised` now keeps a REJECTION for ten seconds (`MEMO_FAILURE_TTL_MS`), counted from the moment it failed: a failed season-wide or seasons read is answered from memory for that long (image 503, page error) and then read again; it is never kept as a success. This supersedes "a rejection is dropped at once" in items 12, 17 and 18. Why: during a fast-failing outage every image request was a new database request. (b) The image route accepts only the one SPELLING of its query (`parseRadarImageQuery` is handed the raw query string): `?`, `?&`, a trailing `&`, percent-encoded digits or another key order are the stored 404; the share page's own links (`season`, `w`, `download=1`, in that order) are unchanged. (c) `PIXEL` / `SANS` and `memoised` are exported for the comparison card image, which uses `radarImageFonts` as it is.

    experimental: {
      outputFileTracingIncludes: {
        "/api/team-radar/[team_id]/[side]": [
          "./app/fonts/PressStart2P-Regular.ttf",
          "./node_modules/next/dist/compiled/@vercel/og/noto-sans-v27-latin-regular.ttf",
        ],
      },
    },
