# Team Stats page (`/team-stats`) — design spec

**Status:** approved with changes by the spec reviewer (2026-09-28); the review's I1-I5 and M1-M8 are applied below. Task 10 (canonical tag) is deferred until PR #24 merges (§8).
**Branch:** `team-stats-page` off `main` @ 3d8b75a (clean).
**Commits to:** `docs/superpowers/specs/2026-09-28-team-stats-design.md`.
**Inputs:** Jon's approved decisions (`scratchpad/team-stats/decisions.md`), the approved mockup (`team-stats-mockup.html`; its code is `template.html`), the reference aggregation `aggregate.py`, and the real 2026 rows `tgs_2026.json` (94 rows, weeks 1-3, read 2026-09-28).

All `file:line` citations are against `main` @ 3d8b75a unless marked otherwise.

---

## 0. Decisions settled 2026-09-28 (J1–J4)

The approved mockup was wrong in four places. Jon (J1, J2) and the controller (J3, J4) settled them on 2026-09-28 (decisions.md:37-42); the spec below implements the settled option for each.

| # | What the mockup says / shows | Why it is false | Decision |
|---|---|---|---|
| J1 | Cost footnote, Offense: "EPA each offense gave away per game." Defense: "EPA each defense took from opponents per game." | `epa_lost_penalties` is the team's **own flags on both sides of the ball**: ingest selects `penalty_team == team` on every play, offence and defence, and flips the sign when the team was defending (scripts/ingest.py:3529-3540; box score spec 2026-09-15 line 107: "6 of their 10 penalties came on defence"). So the Penalties column on Offense includes the team's *defensive* flags, and on Defense it is the opponent's flags on both sides — including flags the opponent's defense committed against this team's offense. | Keep the column, reword (§5.4 C6) so the sentence says what the column is. |
| J2 | NFL average row prints `lg[c.k]` for every column (template.html:200) — so count columns show league **totals** under "NFL average": 529 explosive plays, 4641 early-down plays, 1364 late-down plays, against team values of 10-30 and ~100-170. | A total is not an average. | Count cells in that row show the **average team**: league total ÷ teams with at least one game, one decimal (529 / 32 = 16.5). One footnote says so (C11). |
| J3 | Uncovered season: "Team stats start with the 2026 season. Earlier seasons arrive with the historical box score backfill." | Promises a backfill that is still Jon's open decision (memory/MEMORY.md:80). Also hard-codes a year (MEMORY.md:25: no hardcoded seasons). | The box score's wording, year derived: "Team stats start with the {firstSeason} season" + "Earlier seasons aren’t available yet." (app/game/[game_id]/page.tsx:178-184). |
| J4 | "Seasons with no team_game_stats … never throw" (decisions.md:24-25). | True for 2020-2025. But the **newest** season in `data_freshness` can never be empty for real: its `team_game_stats` rows and its `data_freshness` row are written in one transaction (`upsert_team_game_stats` at scripts/ingest.py:4185 and `update_freshness` at :4205 both sit inside the `try` that commits at :4206). An empty read there means the read is broken (a dropped RLS policy answers 200-with-no-rows), and the site's rule is to throw rather than render a degraded page (.claude/CLAUDE.md:38). | Throw for the newest season (and when `data_freshness` returned no seasons at all); message for every other empty season. |

Also left out on purpose (not in decisions.md): the mockup's "NEW" badge on the nav item (template.html:37, :75) and the subtitle's "· 2026 season through Week 3 · all 32 teams" (template.html:209) — the DashboardShell badge already prints season and week (components/layout/DashboardShell.tsx:28-30), and "all 32 teams" would be a claim to keep true. Jon can ask for either back.

---

## 1. Goal and scope

A season leaderboard of all 32 teams built by adding up each team's box scores (`team_game_stats`), with an Offense/Defense toggle and three tabs — Efficiency, Early vs Late Downs, What It Cost Them — exactly as Jon approved (decisions.md:7-27), at `/team-stats`, in the nav right after Team Tiers.

**Where the arithmetic runs.** .claude/CLAUDE.md:32 says stats are computed in `scripts/ingest.py`. This page is the documented exception Jon chose (decisions.md:8, "built from `team_game_stats`"): a pure aggregator in `lib/stats/team-stats.ts` runs **in the server component at request time**, never in the browser, over stored per-game rows — the same kind of page-side arithmetic over stored columns the box score already does (lib/stats/box-score.ts:4-8: toxic differential, pass/rush explosive rates). The client component only sorts, formats and colours. A `team_season_box_stats` ingest table is a possible later optimisation, out of scope (§9).

## 2. Data layer

### 2.1 `fetchAllRows` gains an optional options argument (additive)

`lib/data/utils.ts:5-31` today takes `(table, select, filters)`, pages with `.range()` and **no `.order()`**, has no deadline, and rejects with the raw PostgREST object (utils.ts:22). lib/data/games.ts:292-303 documents both hazards (unordered pages can skip/duplicate; the raw object defeats `instanceof Error`).

Change: add a fourth, optional parameter

```ts
export async function fetchAllRows(
  table: string,
  select: string,
  filters: Record<string, unknown>,
  options: { signal?: AbortSignal; order?: readonly string[] } = {}
): Promise<Record<string, unknown>[]>
```

- `order`: each column applied ascending with `.order(col, { ascending: true })` **before** `.range()`.
- `signal`: `.abortSignal(signal)` on every page's query (supabase-js turns an abort into a PostgREST-shaped `error`, so the existing `if (error) throw error` is the handler — lib/data/box-score.ts:82-83).
- With no options, the built query is **call-for-call identical** to today's (no `order`, no `abortSignal` calls). Every existing caller (games.ts:306, players.ts:58, run-gaps.ts:35/63/165/177/196, rushing.ts:18, trends.ts:79/100) passes three arguments and is untouched.

### 2.2 `lib/data/team-stats.ts` (new, server-only)

Imports the Supabase-backed helpers; must never be imported from a `"use client"` file (same rule as lib/data/box-score.ts:1-3).

```ts
/** The columns the page reads — not "*": 30 of team_game_stats' 62 columns. */
export const TEAM_STATS_COLUMNS = [
  "game_id", "team_id", "opponent_id", "season", "week",
  "plays", "pass_plays", "rush_plays", "early_plays", "late_plays",
  "epa_per_play", "success_rate", "first_down_rate",
  "pass_epa_per_play", "pass_success_rate", "pass_first_down_rate",
  "rush_epa_per_play", "rush_success_rate", "rush_first_down_rate",
  "early_epa_per_play", "early_success_rate", "late_epa_per_play", "late_success_rate",
  "explosive_plays", "explosive_pass", "explosive_rush",
  "turnovers", "epa_lost_turnovers", "epa_lost_sacks", "epa_lost_penalties",
] as const;

export type TeamStatsSeason =
  | { state: "ready"; rows: TeamStatsGameRow[] }          // TeamStatsGameRow = Pick<TeamGameStat, …TEAM_STATS_COLUMNS>
  | { state: "uncovered"; firstSeason: number | null };

export async function getTeamStatsSeason(season: number, seasons: number[]): Promise<TeamStatsSeason>
```

Algorithm, in order:

1. **Read.** `fetchAllRows("team_game_stats", TEAM_STATS_COLUMNS.join(","), { season }, { signal: boxScoreDeadline(), order: ["game_id", "team_id"] })`.
   - Deadline: reuse `boxScoreDeadline()` / `BOX_SCORE_READ_DEADLINE_MS` (5000 ms, lib/data/box-score.ts:85-88) — same table, same reasoning (a slow Supabase becomes a caught error, not a Vercel 504). One read, one signal.
   - Order: `(game_id, team_id)` is the table's key (MEMORY.md:73). A full REG season is 272 games × 2 = 544 rows, under the 1000-row page, so this never paginates today; the order makes it safe if it ever does.
   - **A failed read throws an `Error`**: catch the raw rejection and rethrow `new Error(\`Failed to fetch team_game_stats for ${season}: ${message}\`)` (message = `err.message` when it is a string, else `JSON.stringify(err)` — the app/page.tsx:97-100 idiom), so `error.tsx` and the logs get a real Error (the trap games.ts:300-303 describes).
2. **Parse.** Each row through `parseNumericFields(row, TEAM_STATS_NUMERIC)` where `TEAM_STATS_NUMERIC = TEAM_GAME_NUMERIC.filter((c) => (TEAM_STATS_COLUMNS as readonly string[]).includes(c))` (lib/data/box-score.ts:33-54, re-used, not copied): NUMERIC arrives as strings; NULL and `"NaN"` become `null` (lib/utils.ts:8-27). The intersection matters: parseNumericFields adds every listed field that is `undefined` as `null` (lib/utils.ts:21-22), so the full list would bolt `explosive_rate`, `yards_per_*` onto rows that never selected them.
3. **Rows found** → `{ state: "ready", rows }`.
4. **No rows** — never `getBoxScore`'s whole-table-empty guard (box-score.ts:392-406, which throws when *no* season has rows). Instead:
   - `seasons.length === 0` → **throw** `Error("Team stats: no seasons from data_freshness (query failed or table empty)")`. `getAvailableSeasons` swallows its own error into `[]` (lib/data/queries.ts:93-100), so an empty list says nothing about coverage; box-score.ts:386-390 throws on the same condition. *(J4)*
   - `season === seasons[0]` (the newest season in `data_freshness`) → **throw** `Error(\`Team stats: ${season} is the newest season in data_freshness but has no team_game_stats rows; the read is failing silently\`)`. *(J4 — see §0 for why this cannot be a real empty season.)*
   - otherwise → `covered = await getBoxScoreSeasonsCached(seasons)` (box-score.ts:194-233: hour-memoised `limit(1)` probes, throws on failure, never memoises a rejection).
     - `covered.includes(season)` → **throw** `Error(\`Team stats: team_game_stats has rows for ${season} but the season read returned none; the read is failing silently\`)`. The probe found a row the full read did not — the same broken-read condition as the newest-season rule, one probe over; without this a broken read on a backfilled season would print a confident "not available" message. (The memo can be up to an hour stale, so a season whose rows were all deleted within the hour would also land here; no such path exists — `cleanup_stale_rows` removes games, not seasons.)
     - else `firstSeason = covered.length > 0 && season < Math.min(...covered) ? Math.min(...covered) : null`; return `{ state: "uncovered", firstSeason }`.
     A probe failure throws (error.tsx) — the only reason to reach it is an empty season, so nothing that works today depends on it.

   This covers 2020-2025 (older than the first covered season → "start with 2026"), a season missing from the middle of a partial backfill, and a `?season=` outside `data_freshness` (e.g. 1999 → "start with 2026"; 2030 → neutral) — all as a message page, never an error and never a blank page.

### 2.3 Cost per view

The route reads `searchParams`, so it renders per request exactly like the leaderboards (MEMORY.md:98 explains why `revalidate` + `searchParams` is dynamic): `getAvailableSeasons` + `getDataFreshness` + one `team_game_stats` read (≤ 544 rows × 30 columns); an uncovered season adds the memoised probe. A failed read reaches `error.tsx`; nothing degraded is cached. `getAvailableSeasons`/`getDataFreshness` keep their current no-deadline behaviour (unchanged, as on every leaderboard).

## 3. The aggregator — `lib/stats/team-stats.ts` (new, pure, client-safe)

No Supabase import. It may import `getTeam` from lib/data/teams.ts (lib/stats/box-score.ts:18 already does; teams.ts has no Supabase).

### 3.1 Types (keys match aggregate.py's output, so the golden file compares key-for-key)

```ts
export interface TeamSideStats {
  gp: number;                       // team-games on this side
  plays: number; pass_plays: number; rush_plays: number; early_plays: number; late_plays: number;
  epa: number | null; pass_epa: number | null; rush_epa: number | null;
  sr: number | null; pass_sr: number | null; rush_sr: number | null;
  fd: number | null; pass_fd: number | null; rush_fd: number | null;
  early_epa: number | null; early_sr: number | null; late_epa: number | null; late_sr: number | null;
  expl: number; expl_rate: number | null;
  expl_pass: number; expl_pass_rate: number | null;
  expl_rush: number; expl_rush_rate: number | null;
  cost_to: number | null; cost_sack: number | null; cost_pen: number | null; cost_total: number | null;
}
export interface TeamStatsRow {
  team: string;                     // team_id
  name: string;                     // getTeam(id)?.name ?? id
  off: TeamSideStats;               // rows where team_id === team
  def: TeamSideStats;               // rows where opponent_id === team (what it allowed)
  toxic: number | null; to_margin: number | null; ex_margin: number | null;
}
export interface TeamStatsModel {
  teams: TeamStatsRow[];            // sorted by team id
  league: TeamSideStats;            // side(all rows)
  leagueToxic: number | null;       // mean toxic over teams with off.gp > 0 (0 by construction)
  teamsPlayed: number;              // teams with off.gp > 0 — divisor for J2's average-team cells
}
export function buildTeamStats(rows: ReadonlyArray<Record<string, unknown>>): TeamStatsModel
```

### 3.2 Rules — each one is aggregate.py's, line for line

| Rule | aggregate.py | TS |
|---|---|---|
| `num(v)`: a finite number, or a numeric string parsed to one; anything else (null, undefined, "", "NaN", Infinity, objects) → `null` | :16-21 (`float(v)`, `math.isfinite`) | `typeof v === "number"` → finite check; `typeof v === "string" && v.trim() !== ""` → `Number(v)` then finite check; else null |
| Play-weighted rate: Σ(rate × den) / Σ den over rows where `num(rate) !== null` and `num(den)` is non-zero; `null` when Σ den is 0 | :24-32 | `wavg(rows, rateCol, denCol)` |
| Rate → denominator pairs: epa/sr/fd ← `plays`; pass_* ← `pass_plays`; rush_* ← `rush_plays`; early_epa/early_sr ← `early_plays`; late_epa/late_sr ← `late_plays` | :39-48 | same 13 pairs, one constant table `RATE_COLUMNS` |
| Counts are `Σ (num(v) ?? 0)` | :35-36 | `total(rows, col)` |
| `expl_rate = expl / plays`, `expl_pass_rate = expl_pass / pass_plays`, `expl_rush_rate = expl_rush / rush_plays`, each `null` when its denominator total is 0 | :57-63 | same |
| Costs = Σ `epa_lost_*` / gp; `cost_total` = sum of the three | :64-68 | same, **except** gp = 0 → all four `null` (aggregate.py's `gp or 1` gives 0.00, which would print a false "0.00" for a team with no games; aggregate.py never sees such a team, so goldens are unaffected) |
| Defense = the opponents' offensive rows: `rows.filter(r => r.opponent_id === team)` | :79 | same |
| Toxic, per offensive row of the team: find the other row of the same `game_id` (`team_id !== team`); **skip the game if there is none**; `to_margin += opp.turnovers − own.turnovers`, `ex_margin += own.explosive_plays − opp.explosive_plays` (nulls as 0); `toxic = to_margin + ex_margin` | :80-89 | same; `toxic`, `to_margin`, `ex_margin` are `null` when the team has no offensive rows |
| League = `side(all rows)`; its `gp` is the number of team-game rows (94 today), so league costs are per team-game | :91 | same |
| Team set = every row's `team_id` | :77 | **∪ every id in `NFL_TEAMS`** (lib/data/teams.ts:9-42), so a team that hasn't played (Thursday night of week 1, a bye) is a row of dashes with GP 0 rather than missing; an id in the rows but not in `NFL_TEAMS` still appears (name = id) — nothing silently disappears. The model keeps counts at 0 for such a team (aggregate.py-compatible); the presentation layer treats every count of a side with `gp === 0` as `null`: printed "—", sorted with the nulls (last), `#` "—". |

Output is JSON-serialisable by construction: every number is finite or `null`; no `NaN`, `Infinity` or `undefined` (Next cannot serialise NaN server→client — .claude/CLAUDE.md:39).

`leagueToxic` is always 0 when every game has both rows — each game adds +x to one team and −x to the other, and a skipped game is skipped for the one team that has a row. It is computed, not hard-coded, and the NFL-average cell prints it (the mockup printed a literal "0", template.html:200).

## 4. Golden and behaviour tests for the aggregator — `__tests__/stats/team-stats.test.ts`

### 4.1 Fixture (must be committed with this spec — the scratchpad is session-only)

Prepared in `scratchpad/team-stats/fixture/` by `make_fixture.py` (read-only; re-runs aggregate.py on the trimmed rows and asserts the output is unchanged):

- `__tests__/stats/fixtures/team-game-stats-2026-w1-3.json` — **all 94 real rows** of 2026 weeks 1-3, only the 30 `TEAM_STATS_COLUMNS`, sorted `(game_id, team_id)`, 87 KB. All 94 are needed: every team's defense and toxic read its opponents' rows, and the league row reads everything. Includes CHI and PHI at 2 games (their week-3 game had not been ingested on 2026-09-28), 0 null rates.
- `__tests__/stats/fixtures/team-stats-2026-w1-3.expected.json` — aggregate.py's output for those rows: `teams[id].off|def|toxic|to_margin|ex_margin` and `league`.

The scripts that produced them are committed at `docs/superpowers/specs/team-stats-reference/` (`aggregate.py`, `make_fixture.py`; M7) so the golden values can be audited. Like `wr-te-2025-pool.json` (MEMORY.md:124): **never re-capture these to make a test pass.** A failing golden means the TS disagrees with the reference.

### 4.2 Tests

1. **Golden, every value.** For each of the 32 teams × both sides × every key in `TeamSideStats`, plus `toxic`, `to_margin`, `ex_margin`, and every `league` key: `expect(actual).toBeCloseTo(expected, 12)` (null ↔ null exact). *Comment in the test:* re-sorting the same rows changes float summation order; the largest difference measured was 1.7e-18 (league `epa`), so 12 places is the tolerance — do not "tighten" it to `toBe`.
2. **Spot values as a reader sees them** (the acceptance numbers, through the page's formatters): SF offense EPA/play prints `+0.330`; MIN defense EPA/play `−0.204` (U+2212); league EPA/play `+0.008`; SF toxic `+17`; CHI GP 2.
3. **Season = play-weighted sum, not the mean of game rates.** NYG late-down EPA/play from the fixture: games of 10, 17, 14 late plays at +1.149, −0.786, −0.142. Weighted = **−0.094** (the expected file); the mean of the three rates is **+0.074** — a naive average flips the sign. Assert the aggregator returns the weighted value and that it is not within 0.1 of the mean. Plus a synthetic pair (10 plays at +1.0, 90 plays at 0.0 → 0.100, never 0.500).
4. **A one-game team equals its box-score row exactly.** Filter the fixture to week 1 (every team one game): every team's `off` rates `toBe` the row's stored rates (13 pairs), counts equal, `expl_rate` equals `explosive_plays / plays`, costs equal the stored `epa_lost_*`. `toBe` is safe on these rows: (r × d) / d reproduced r bit-for-bit in all 1,222 rate cells of the fixture (measured); comment says so.
5. **Nulls and zeros.** Synthetic rows:
   - zero pass plays in every game → `pass_epa`, `pass_sr`, `pass_fd`, `expl_pass_rate` are `null`; `epa` is still the rush-only rate;
   - a null rate with a non-zero denominator (and a `"NaN"` string, and `undefined`) in one of two games → the rate is the other game's, and that game's denominator is left out (aggregate.py:28-29);
   - a numeric **string** rate/count is parsed (aggregate.py's `float(v)`);
   - a missing opponent row → that game is skipped for toxic only; GP, rates and costs still count it;
   - a team in `NFL_TEAMS` with no rows → GP 0 on both sides, every rate/cost/toxic `null`, counts 0 in the model; through the presentation helpers every cell prints "—" and the team sorts last on every column, both sides, both directions;
   - an unknown `team_id` → present, `name` = id;
   - `buildTeamStats([])` → 32 rows of dashes, league rates `null`, `teamsPlayed` 0, `leagueToxic` null;
   - `JSON.parse(JSON.stringify(model))` deep-equals `model` for the fixture and for every synthetic case (no NaN/undefined anywhere).
6. **1000+ rows.** 1,100 synthetic rows (550 games) aggregate without error and with league `gp` 1,100 (chaos rule, .claude/CLAUDE.md:24).

## 5. Page and client table

### 5.1 Files

- `app/team-stats/page.tsx` — server component, `export const revalidate = 3600`, the leaderboards' season resolution (app/rushing/page.tsx:25-33).
- `app/team-stats/loading.tsx`, `app/team-stats/error.tsx` — copies of app/rushing/loading.tsx / error.tsx, error title "Unable to load team stats".
- `components/tables/TeamStatsTable.tsx` — `"use client"`.
- `lib/stats/team-stats.ts` also holds the pure presentation pieces (column table, formatting, colour, sort, URL parse/build, copy) so they are unit-tested without React.

### 5.2 Server page

```tsx
const { season } = await searchParams;
const seasons = await getAvailableSeasons();
// parseSeasonParam: parseInt, but only a whole number from 1999 to 2100 counts; anything else is absent
const currentSeason = parseSeasonParam(season) ?? (seasons[0] || fallbackSeason());
const [data, freshness] = await Promise.all([getTeamStatsSeason(currentSeason, seasons), getDataFreshness(currentSeason)]);
```

Renders `<DashboardShell title="Team Stats" seasons currentSeason freshness>` (DashboardShell.tsx:16-69 — title, freshness badge, SeasonSelect), then:

- `ready` → `<TeamStatsTable key={currentSeason} model={buildTeamStats(data.rows)} season={currentSeason} throughWeek={freshness?.through_week ?? null} isLatestSeason={currentSeason === seasons[0]} />`. Keyed by season so a season change remounts it (the /receivers fix, app/receivers/page.tsx:55, __tests__/app/receivers-page.test.tsx:1-5).
- `uncovered` → a centred message in the leaderboards' empty-state style (app/qb-leaderboard/page.tsx:47-50): heading `uncoveredHeading(season, firstSeason)` and, when `firstSeason` is set, the line `UNCOVERED_BODY` (§5.4 C9).

**Metadata** (`generateMetadata`, the same season resolution as the body: `parseSeasonParam(season) ?? seasons[0] ?? fallbackSeason()`, so an implausible `?season=` such as `99999999999999999999` is the default season in both and never reaches the database — chaos ERROR 2):
- With `seasons.length === 0` (data_freshness unread), coverage is unknown: return the title only — no description, no probe, no robots. The body throws only if the `team_game_stats` read is also empty; otherwise it renders the table.
- `title: \`NFL Team Stats ${s}\`` (the layout template adds " — Yards Per Pass", app/layout.tsx:16-18).
- `description`: ready (or not probed) → `\`Every NFL team's offense and defense for the ${s} season: EPA per play, success rate, explosive plays, early and late downs, and what turnovers, sacks and penalties cost.\``; uncovered (the probe below says so) → the C9 heading plus "." — the description must not promise a table the page does not show.
- **noindex, follow** for an uncovered season, like the box score's message pages (app/game/[game_id]/page.tsx:144-153): when `s !== seasons[0]`, `try { covered = await getBoxScoreSeasonsCached(seasons) } catch (err) { console.error(...); covered = null }`; `robots: { index: false, follow: true }` only when `covered` is an array that does not include `s`. **Fail-open on purpose:** a probe error leaves the page indexable rather than failing the metadata of a page whose body may be fine; the body's own read decides whether it errors. The newest season never probes.

### 5.3 Client table (`TeamStatsTable`)

**Controls**, top to bottom, in site styles (not the mockup's CSS):
1. Offense | Defense segmented toggle — the RB scoring-format toggle's classes (components/tables/RBLeaderboard.tsx:553-566: `flex rounded-lg border …`, active `bg-navy text-white`).
2. Tabs "Efficiency", "Early vs Late Downs", "What It Cost Them" — the leaderboard tab buttons (RBLeaderboard.tsx:455-470: `overflow-x-auto scrollbar-hide`, active `bg-navy text-white`).
3. Subtitle `SUBTITLE[side]` (C2) in `text-sm text-gray-500`.
4. The Team Tiers note (C1) in a `bg-blue-50 text-navy text-xs rounded-md px-3 py-2` box, with "Team Tiers" linked to `/teams`.
5. Table; 6. footnote block `mt-4 text-xs text-gray-400 space-y-1 border-t border-gray-100 pt-3` (RBLeaderboard.tsx:776).

**Columns** (`TEAM_STATS_COLUMNS_BY_TAB` in lib/stats/team-stats.ts). Fixed left: `#`, Team (logo `getTeamLogo(id)` 20×20 + id, name in `hidden sm:inline` — the leaderboards' logo cell, RBLeaderboard.tsx:705-712; linked to `/team/{id}`, plus `?season={season}` when `!isLatestSeason`; when `getTeam(id)` is undefined: no logo and no link, id text only), GP (`row[side].gp`).

| Tab | Group header | Key | Header | Format | Colour | Neutral |
|---|---|---|---|---|---|---|
| Efficiency | EPA / play ⓘ | `epa`, `pass_epa`, `rush_epa` | All, Pass, Rush | `fmtFixed(v, 3, true)` | yes | |
| | Success rate ⓘ | `sr`, `pass_sr`, `rush_sr` | All, Pass, Rush | `fmtPct(v)` | | |
| | 1st down rate | `fd`, `pass_fd`, `rush_fd` | All, Pass, Rush | `fmtPct(v)` | | |
| | Explosive plays ⓘ | `expl`, `expl_rate`, `expl_pass_rate`, `expl_rush_rate` | Plays, Rate, Pass, Rush | `fmtInt` / `fmtPct` | | |
| | Toxic *(Offense only)* | `toxic` (team-level) | Diff | `fmtSignedInt` | | |
| Early vs Late Downs | Early downs (1st–2nd) | `early_plays`, `early_epa`, `early_sr` | Plays, EPA/play, Success | `fmtInt` / f3 / `fmtPct` | EPA | `early_plays` |
| | Late downs (3rd–4th) | `late_plays`, `late_epa`, `late_sr` | Plays, EPA/play, Success | same | EPA | `late_plays` |
| What It Cost Them | EPA lost per game | `cost_to`, `cost_sack`, `cost_pen`, `cost_total` | Turnovers, Sacks, Penalties, Total | `fmtFixed(v, 2, true)` | | |

Formatters are the box score's (lib/stats/box-score.ts:39-58): U+2212 minus, a value that rounds to zero prints unsigned, `null`/NaN → em dash. ⓘ = `MetricTooltip` with the existing keys **"EPA / play", "Success rate", "Explosive plays"** only (components/ui/MetricTooltip.tsx:121-136). Not "1st down rate" (its text points at a "Team stats" row this page does not have, MetricTooltip.tsx:133-134) and not "Toxic differential" ("counted above", :137-138, is box-score layout); the footnotes cover both.

**Header:** two rows — group labels (navy) over column labels, as in the mockup (template.html:176-189). Sorted column header `bg-navy/60` with ▼/▲; headers sort via `onClick` on the `<th>`, as the leaderboards do (RBLeaderboard.tsx:590-603). The group row, `#`, Team and GP headers do not sort (GP has no `data-k` in the mockup either, template.html:184); `sort=gp` in the URL falls back to the tab default.

**Sorting.**
- Better-first direction: Offense → higher first for every non-neutral column (costs are almost always ≤ 0, but a team's own penalties can net positive EPA in a game, so this is higher first, not closer to zero). Defense → lower first for every non-neutral column. Toxic → higher first. Neutral (Plays) → higher first on both sides.
- Default sort per tab = first non-neutral column (mockup, template.html:158): Efficiency `epa`, Downs `early_epa`, Cost `cost_to`; direction better-first.
- Clicking a new header → that column, better-first. Clicking the sorted header → flips.
- Null values always last (either direction); ties (and null-null) by team id ascending, in both directions (the mockup's comparator has no tiebreak when descending — template.html:165 — fixed here).
- `#` = the row's position in the current sort; "—" when the sort value is null (template.html:192).
- Switching tab → that tab's default sort, better-first. Switching side → keep tab; keep the sort column if it exists on the new side, else the tab default (Toxic → EPA All); direction resets to better-first.

**URL state** (the leaderboards' pattern, RBLeaderboard.tsx:176-292: read with validation, write with `router.push(…, { scroll: false })`, defaults omitted, other params such as `season` kept):
- `side=def` (absent = offense), `tab=downs|cost` (absent = efficiency), `sort=<key>` (absent = tab default), `dir=asc|desc` (absent = better-first for that column and side).
- Invalid `side`/`tab` → default; a `sort` not in the current tab/side's columns (e.g. `sort=toxic&side=def`, `sort=cost_to&tab=eff`) → tab default; any `dir` other than `asc`/`desc` → better-first.
- Pure `parseTeamStatsParams(params)` / `buildTeamStatsQuery(state, params)` in lib/stats/team-stats.ts.

**Colour — EPA per play columns only** (`epa`, `pass_epa`, `rush_epa`, `early_epa`, `late_epa`), via the existing rule, never a new one:
```ts
export function teamEpaClass(v, avg, side) {
  return side === "off"
    ? epaVsAverageClass(v, avg, EPA_BAND.play, 3)
    : epaVsAverageClass(v == null ? v : -v, avg == null ? avg : -avg, EPA_BAND.play, 3);
}
```
`epaVsAverageClass` (lib/stats/formatters.ts:163-176) compares both numbers **as printed** at 3 dp, band 0.03 inclusive (EPA_BAND.play, :78), green above / red below / grey inside. On Defense, lower is better, so both values are negated: `toFixed` is sign-symmetric, so the printed difference just changes sign. The average is the **league row's** value for that column. Colour is on only when `league.plays >= EPA_AVERAGE_MIN_PLAYS.play` (600, formatters.ts:81); otherwise every EPA cell is `text-gray-700` and C7b replaces C7. Every other column is plain `text-gray-700`; a dash is `text-gray-400`.

**NFL average row** (last row of `tbody`, `bg-gray-50 font-semibold text-gray-600`, label "NFL average", # and GP blank): rates and costs = `model.league[key]` in the column's format; count columns (`expl`, `early_plays`, `late_plays`) = `model.league[key] / model.teamsPlayed` to one decimal (`fmtFixed(v, 1)`), dash when `teamsPlayed` is 0 *(J2)*; Toxic = `fmtSignedInt(model.leagueToxic)`. Never coloured.

**Mobile.** The table sits in `border border-gray-200 rounded-md overflow-x-auto` (RBLeaderboard.tsx:582); `#` and Team are sticky left (RBLeaderboard.tsx:586-587 pattern) so a team stays visible while scrolling columns; team names hidden below `sm`. Tabs scroll horizontally on their own. The page itself must not scroll sideways at 375 px (DashboardShell's `min-w-0`, DashboardShell.tsx:33).

### 5.4 Visitor-facing copy — every sentence, exact wording, where it shows, what pins it

All copy lives in **exported string constants/functions in `lib/stats/team-stats.ts`** (plain TS string literals, not JSX text — avoids the escape trap in MEMORY.md:95) and the component renders them verbatim.

| Id | Text | Shows | Pinned by |
|---|---|---|---|
| C1 | "These rankings add up every game’s box score, so they use the same play filter as the box scores and rbsdm.com. A team’s EPA/play here can differ from its figure on Team Tiers, which counts plays differently." | ready, always | vitest: loader reads `team_game_stats` (the box score's table, box-score.ts:242); link to `/teams`. pytest (§6.1): `filter_plays` over the committed parquet fixture gives BUF 52 plays in 2026_01_BUF_HOU (measured; test_team_game_stats.py:128-131's 52 is `total_plays`, a different count); `team_game_stats.plays` is 56, and the TS source contains C1. |
| C2 | Offense "What each offense did"; Defense "What opponents did against each team" | ready | vitest: defense rows are opponents' rows (`def` of MIN = Σ of rows with `opponent_id` MIN). |
| C3 | Per tab (`DEFENSE_NOTE.eff` / `.downs`), each naming only what its tab shows. Efficiency: "Defense ranks what opponents did against each team, so lower EPA, success and explosive rates rank higher." Early vs Late Downs: "Defense ranks what opponents did against each team, so lower EPA and success rates rank higher." | Defense, Efficiency and Downs tabs | vitest: on Defense every non-neutral column's default direction is ascending, and the rendered first row after the default sort has the lowest EPA; "each tab's footnotes mention only what that tab shows" (every side × tab: a footnote naming explosive, toxic, success, turnovers/sacks/penalties or EPA/play needs such a column on that tab). |
| C4 | "Explosive plays are completions of 20+ yards and runs of 10+ (QB scrambles count as runs). The rush explosive rate divides by designed runs only, so a team with long scrambles can run high." | Efficiency tab, both sides | pytest (§6.1) reruns the explosive rules: a 20-yd completion and a 10-yd run count, a 19-yd and a 9-yd don't, a 12-yd scramble counts in `explosive_rush` but not `rush_plays` (tests/test_team_game_stats.py:338-358 pattern); vitest: `expl_rush_rate = explosive_rush / rush_plays`, and a synthetic team with `explosive_rush > rush_plays` prints over 100%. |
| C5 | "Toxic differential is turnover margin plus explosive-play margin, one figure for the whole team." | Efficiency tab, **Offense only** (the column is Offense only) | vitest: `toxic === to_margin + ex_margin` for all 32 fixture teams; the Toxic column and C5 are absent on Defense. |
| C6 *(J1)* | Offense: "EPA each team lost per game to its own turnovers, sacks and penalties. Penalties count the team’s flags on both sides of the ball, as in the box score. Higher (less negative) is better." Defense: "EPA each team’s opponents lost per game to their own turnovers, sacks and penalties (their flags on both sides of the ball). More negative is better." | Cost tab | pytest (§6.1): a defensive flag by team X moves X's `epa_lost_penalties` (pattern tests/test_team_game_stats.py:133-137); vitest: cost = Σ/gp, and Offense sorts higher first, Defense more-negative first; a synthetic team with a positive `cost_pen` sorts above one at −0.10 on Offense (I2: `epa_lost_penalties` can be positive — 2026_02_PIT_NE PIT +1.90, 2026_03_SEA_WAS WAS +2.32). |
| C6b | "A strip-sack counts in both the Turnovers and Sacks columns, as in the box score, so Total counts it twice." | Cost tab, both sides | pytest: re-asserts tests/test_team_game_stats.py:400-410 (strip-sack in both `epa_lost_*`) and the TS source contains "counts it twice"; vitest: text equals the box score's rule (STRIP_SACK_NOTE, lib/stats/box-score.ts:612) in meaning — asserted by both containing "strip-sack" and "both"; a synthetic row where `epa_lost_turnovers` and `epa_lost_sacks` both carry the same −3.0 gives `cost_total` −6.0. |
| C7 | `EPA/play is green (better) or red (worse) against the NFL average in the bottom row, grey within ${EPA_BAND.play.toFixed(2)}.` → "…grey within 0.03." | Efficiency and Downs tabs, when colour is on | built **from the constant**; vitest: renders "0.03" and a cell exactly 0.030 from the average (as printed) is grey, 0.031 is coloured, on both sides. |
| C7b | `EPA colours start once the ${season} season has enough plays to set a league average.` | Efficiency and Downs, when `league.plays < 600` | vitest with a 1-game fixture subset (≈130 plays): no green/red class anywhere, C7b shown, C7 absent. |
| C8 | `With only ${n} ${n === 1 ? "week" : "weeks"} played, one game moves a team a long way.` | when `isLatestSeason` and `throughWeek` is 1-4 (`EARLY_SEASON_MAX_WEEK = 4`) | vitest: shown for 1 ("1 week") and 3, absent for 5, absent when `throughWeek` null or the season isn't the latest. |
| C9 | Heading `firstSeason != null ? \`Team stats start with the ${firstSeason} season\` : \`Team stats aren’t available for the ${season} season\``; body (only with firstSeason) "Earlier seasons aren’t available yet." | uncovered | vitest (loader + route): 2025 with covered [2026] → "start with the 2026 season"; 2030 → neutral heading, no body. |
| C10 | Metadata title/description (§5.2) | `<head>` | route test: title "NFL Team Stats 2026"; ready description names only the three tabs' stats; uncovered 2025 description is "Team stats start with the 2026 season." |
| C11 *(J2)* | "In the NFL average row, rates are league-wide and counts are for the average team." | tabs with a count column (Efficiency, Downs) | vitest: SF-fixture average row prints 16.5 for explosive plays (529 / 32), not 529. |

## 6. Tests outside the aggregator

### 6.1 `tests/test_team_stats_copy.py` (new; the paired-pytest pattern of tests/test_qb_counting_rules.py:197-218, which runs the aggregator and reads the TS text)

- `test_team_tiers_counts_plays_differently` — on the committed BUF_HOU parquet fixture (tests/conftest.py:19): `len(filter_plays(pbp)` rows with `posteam == 'BUF'` for that game`)` ≠ the `plays` value `aggregate_team_game_stats` stores for BUF (56); and `lib/stats/team-stats.ts` contains C1's "counts plays differently". (If `filter_plays` ever adopted the box score's set, the sentence would become false and this fails.)
- `test_explosive_rules_match_the_footnote` — synthetic rows through `aggregate_team_game_stats` (the `raw` fixture): as in §5.4 C4; and the TS source contains "completions of 20+ yards", "runs of 10+", "designed runs only".
- `test_penalty_cost_counts_flags_on_both_sides` — a defensive flag by the team lowers its `epa_lost_penalties` by that play's EPA; the TS source contains "flags on both sides of the ball".
- `test_strip_sack_counts_in_both` — as C6b; TS source contains "strip-sack" and "counts it twice".

### 6.2 Vitest files (new unless noted)

- `__tests__/data/utils.test.ts` — `fetchAllRows`: no options → recorded calls are exactly `select, range, eq…` (no `order`, no `abortSignal`); with options → `order` per column before `range`, `abortSignal` on every page; paginates 1000 + 1 rows; rejects with the raw error (unchanged). Fake client as in __tests__/data/box-score.test.ts:1-31.
- `__tests__/data/team-stats.test.ts` — `getTeamStatsSeason`: wire rows with NUMERIC as strings (box-score.test.ts:55-64 `wireRow` idea) come back as numbers; select list equals `TEAM_STATS_COLUMNS`; filter `season`; `order` game_id, team_id; an `AbortSignal` is passed; a PostgREST error rejects with an `Error` naming the season; empty + `seasons []` throws; empty + newest season throws; empty + 2025 with covered [2026] → uncovered, firstSeason 2026; empty + 2030 → firstSeason null; empty + 2025 with covered [2026, 2025] → throws (read failing silently); probe rejection → rejects.
- `__tests__/stats/team-stats.test.ts` — §4, plus (M3) the fixture minus one week-1 game (30 teams with a row in week 1 only): `teamsPlayed` 30 and the average-row explosive cell = league `expl` / 30; plus the presentation units: column table per tab/side (Toxic Offense-only; neutral flags), better-first direction per side, comparator (nulls last both ways, team-id tiebreak both ways), URL parse/build round trips and every invalid-value fallback, `teamEpaClass` symmetry (Offense/Defense at +0.030, +0.031, −0.030, −0.031 from the average as printed; `null` → gray-400; average `null` → gray-700; a value printing as `−0.000`), each copy function (§5.4).
- `__tests__/components/TeamStatsTable.test.tsx` — RTL with mocked `next/navigation` (leaderboards.test.tsx:10-21) over the real fixture model: 33 body rows (32 + average); default Efficiency/Offense sorted by EPA All descending with SF first and `+0.330`; Defense puts MIN first with `−0.204` in green; SF defense `−0.009` grey against league `+0.008`; header click pushes `?sort=…` and a second click `&dir=…`; side toggle pushes `side=def` and drops `dir`; tab switch pushes `tab=downs` and resets sort; `?side=def&sort=toxic` falls back to EPA; GP shows 2 for CHI; only EPA columns ever carry green/red; average row prints 16.5 / `+0.008` / `0`; footnotes per §5.4 in each side × tab state; only the three allowed MetricTooltip keys are rendered (`aria-label="What is …?"`, MetricTooltip.tsx:153); team links `/team/SF` (latest season) and `/team/SF?season=2025` (not latest); the scroll container has `overflow-x-auto`.
- `__tests__/app/team-stats-route.test.tsx` — server page with mocked data modules (receivers-page.test.tsx:9-15 pattern): ready → child is `TeamStatsTable` keyed by season with `buildTeamStats` output; uncovered → the C9 message and no table; a loader rejection propagates (the page does not catch); metadata title/description; robots noindex for uncovered 2025, indexable for 2026 without calling the probe, indexable (and logged) when the probe rejects.
- `__tests__/components/Navbar.test.tsx` — the link list is Team Tiers, **Team Stats**, Passing, … in that order; Team Stats → `/team-stats` and carries `?season=` like the others (Navbar.tsx:41-45); active style on `/team-stats`; the desktop row's classes are `gap-3 xl:gap-6` (no `gap-8`, no plain `gap-6`).
- `__tests__/app/sitemap.test.ts` *(edit)* — the count at :43 becomes `11 + 32 + 3`; `/team-stats` is present with `lastModified` = data freshness and priority 0.9.
- `__tests__/app/revalidate-route.test.ts` *(edit)* — `["/team-stats"]` is revalidated (the `/team` layout call at app/api/revalidate/route.ts:20 does not cover `/team-stats`).

## 7. Sitemap, glossary, nav, revalidate

- **Sitemap** (app/sitemap.ts:32-44): add `{ url: \`${base}/team-stats\`, lastModified: dataUpdated, changeFrequency: "weekly", priority: 0.9 }` right after `/teams`.
- **Revalidate** (app/api/revalidate/route.ts:11-22): add `revalidatePath("/team-stats")` after `/teams`. Harmless on a dynamic route, keeps the list complete.
- **Nav** (components/layout/Navbar.tsx:10-19): insert `{ href: "/team-stats", label: "Team Stats" }` after Team Tiers (season-carrying, no `noSeason`). Desktop row is `gap-8` in `max-w-6xl` (Navbar.tsx:50, :57). In the same commit, change that container's `gap-8` to `gap-3 xl:gap-6`. Measured 2026-09-28 on the live site: with nine links, `gap-8` wraps Team Tiers, Team Stats and Run Gaps at 1280 px, and `gap-6` wraps none. Re-measured on a built server after the chaos pass: `gap-6` at 1024 wraps Team Stats as well as main's Team Tiers and Run Gaps, so below `xl` the gap is `gap-3` — no label wraps at 1024, and at 768 the row ends at 728 px instead of main's 839 (no sideways page scroll), though Team Stats wraps there like Team Tiers and Run Gaps (no spacing avoids it at 768). No other nav change. The desktop row already overflows its container at 768 on main (the search button ends about 86 px past it). That is out of scope and is Jon's call separately.
- **Glossary: no new entries.** The page reuses three existing tooltip definitions that are true here and explains the rest in footnotes. The pending box-score glossary entries (EPA/play, success rate, explosive plays, toxic; MEMORY.md:103) stay a separate follow-up. Nothing existing becomes false: glossary "Off EPA/Play" already says the box score counts plays differently from Team Tiers (app/glossary/page.tsx:115-118).
- **Docs:** .claude/CLAUDE.md:32 gains " — exception: `/team-stats` sums `team_game_stats` rows in `lib/stats/team-stats.ts` on the server (play-weighted, spec 2026-09-28)"; :33 data-fetching list gains `lib/data/team-stats.ts` (server-only; pure builders in `lib/stats/team-stats.ts`); :35 nav labels gain Team Stats; memory/MEMORY.md gets a Team Stats section (J1-J4 outcomes, the fixture rule, the fetchAllRows options).

## 8. PR #24 (canonical tags) — not merged yet

PR #24 (`quickwin-b-search`, 2 commits on origin, not on main) adds `canonicalSeason(seasonParam, seasons)` and `playerHref` to lib/utils.ts, a canonical on every season page (`${base}/<path>` bare, or `?season=<s>` for a real past season — e.g. its app/rushing/page.tsx diff), `export const revalidate = 3600` on app/sitemap.ts, and `__tests__/app/canonical.test.ts` with a `SEASON_PAGES` table.

This spec **does not copy** that helper (two copies would drift). Instead:
- Tasks 1-9 don't touch the lines #24 changes except `app/sitemap.ts` and `__tests__/app/sitemap.test.ts` (different hunks, should auto-merge) and `memory/MEMORY.md` (Task 9 and #24 both edit it; resolve by hand at the Task 10 rebase), and nothing in lib/utils.ts.
- Task 10 may run **after** Task 11 when #24 lands later; the table order does not require it first. As built on 2026-09-28, Task 10 was skipped: #24 had not merged, so it lands as a follow-up after #24.
- **Task 10 is gated on #24 merging:** rebase `team-stats-page` onto the new main; in `generateMetadata` add `alternates: { canonical: \`${base}/team-stats${cs != null ? \`?season=${cs}\` : ""}\` }` with `cs = canonicalSeason(season, seasons)` exactly as #24's rushing page does; add `["/team-stats", teamStatsMeta]` to `SEASON_PAGES` in `__tests__/app/canonical.test.ts` (which then asserts bare / junk / past-season / empty-list cases for this page too), and mock `@/lib/data/team-stats` / `@/lib/data/box-score` there.
- If Jon wants this page live before #24 lands, ship Tasks 1-9 and do Task 10 as #24's follow-up — the page is then in the same state as every other season page today (no canonical). Team Stats links to no player pages, so `playerHref` is not needed.

## 9. Out of scope

The traditional "Team stats" section (decisions.md:14); moving Team Tiers onto the box-score play filter (decisions.md:9); an ingest-side season table; an OG image for the page (the layout default applies; /rushing has none either); percentile shading/heatmap; conference/division filters; per-game (rather than season-total) counts; the explosive-rush denominator that includes scrambles (MEMORY.md:101 — needs an ingest column); the 2020-2025 backfill; playoffs (team_game_stats is regular season only); the NEW nav badge.

## 10. Risks to pages that work today

| Page / surface | What this touches | Guard |
|---|---|---|
| **Nav on every page** | `NAV_LINKS` gains one item; desktop row width | Navbar test (order, hrefs, season carry, active state); the only allowed style change is `gap-8` → `gap-3 xl:gap-6` in §7. Preview check: at 375, 768, 1024 and 1280 px, compared with main: no nav label wraps that doesn't wrap on main, and no nav element ends further right than on main. At 375 the page itself does not scroll sideways, and the table scrolls inside its box. |
| **Every `fetchAllRows` caller** (players, rushing, run-gaps, games/sitemap, trends, homepage) | new optional 4th parameter | default path asserted call-for-call identical (§6.2); full vitest + tsc + build green; no caller edited. |
| **Team Tiers** (`/teams`) | nothing but the nav | its tests unchanged; C1 only links to it. |
| **Box score** (`/game/…`, link gates) | imports only: `TEAM_GAME_NUMERIC`, `boxScoreDeadline`, `getBoxScoreSeasonsCached`, the lib/stats/box-score formatters; nothing in those files changes | box-score tests unchanged and green. Shared memo: this page calls `getBoxScoreSeasonsCached` with the same `seasons` list as team/player pages (same key, box-score.ts:199) — only on an empty season or in metadata; the memo returns copies (:209) so nothing here can corrupt it. |
| **Sitemap / revalidate** | one entry each | edited tests. |
| **CI** | ci.yml runs lint, tsc, build, pytest — **not vitest** (MEMORY.md:43) | run vitest locally before every push (commands in §11). |

## 11. Tasks (ordered; each is test-first and leaves tsc, lint, vitest and pytest green)

Paths below are relative to the repo root `C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass` (call it `$R`). Agent shells reset `cd`, so run each check by absolute path, one command per call (MEMORY.md:50):
- vitest: `node "$R/node_modules/vitest/vitest.mjs" run --root "$R" <files>`
- tsc: `node "$R/node_modules/typescript/bin/tsc" --noEmit -p "$R/tsconfig.json"`
- lint: `npm --prefix "$R" run lint`
- pytest: `PYTHONDONTWRITEBYTECODE=1 py -3 -m pytest "$R/tests" -q -p no:cacheprovider`
- build (Task 11): `NEXT_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co NEXT_PUBLIC_SUPABASE_ANON_KEY=placeholder-key-for-build-only npm --prefix "$R" run build`

Every commit: the task's tests fail first, then pass; full vitest + tsc + lint (+ pytest for Task 4) before committing. Watch CRLF (MEMORY.md:97) and never stage `__pycache__` (MEMORY.md:51).

| # | Task | Files | Verify |
|---|---|---|---|
| 0 | Commit this spec, the two fixture files (from `scratchpad/team-stats/fixture/`) and the reference scripts that produced them (M7): `aggregate.py` and `make_fixture.py` under `docs/superpowers/specs/team-stats-reference/` (read-only, no key; `fetch_tgs.py` stays out; a one-line header says their input paths point at the scratchpad) | `docs/superpowers/specs/2026-09-28-team-stats-design.md`, `__tests__/stats/fixtures/team-game-stats-2026-w1-3.json`, `__tests__/stats/fixtures/team-stats-2026-w1-3.expected.json`, `docs/superpowers/specs/team-stats-reference/aggregate.py`, `docs/superpowers/specs/team-stats-reference/make_fixture.py` | `git diff --stat` shows only these 5 |
| 1 | `fetchAllRows` options (§2.1) | `lib/data/utils.ts`, `__tests__/data/utils.test.ts` | vitest `__tests__/data/utils.test.ts`, then full vitest |
| 2 | Aggregator (§3) + golden/behaviour tests (§4) | `lib/stats/team-stats.ts`, `__tests__/stats/team-stats.test.ts` | vitest `__tests__/stats/team-stats.test.ts` |
| 3 | Presentation pieces: column table, directions, comparator, `teamEpaClass`, URL parse/build, copy constants/functions (§5.3-5.4) | `lib/stats/team-stats.ts`, `__tests__/stats/team-stats.test.ts` | same file |
| 4 | Python copy pins (§6.1) | `tests/test_team_stats_copy.py` | pytest `$R/tests/test_team_stats_copy.py`, then full pytest |
| 5 | Loader (§2.2) | `lib/data/team-stats.ts`, `__tests__/data/team-stats.test.ts` | vitest that file |
| 6 | Client table (§5.3) | `components/tables/TeamStatsTable.tsx`, `__tests__/components/TeamStatsTable.test.tsx` | vitest that file |
| 7 | Route: page, loading, error, metadata (§5.2) | `app/team-stats/page.tsx`, `app/team-stats/loading.tsx`, `app/team-stats/error.tsx`, `__tests__/app/team-stats-route.test.tsx` | vitest that file |
| 8 | Nav, sitemap, revalidate (§7) | `components/layout/Navbar.tsx`, `app/sitemap.ts`, `app/api/revalidate/route.ts`, `__tests__/components/Navbar.test.tsx`, `__tests__/app/sitemap.test.ts`, `__tests__/app/revalidate-route.test.ts` | vitest those 3 files |
| 9 | Docs (§7) | `.claude/CLAUDE.md`, `memory/MEMORY.md` | read-through |
| 10 | Canonical — **only after #24 merges** (§8); skipped in the 2026-09-28 build, lands after #24 | rebase; `app/team-stats/page.tsx`, `__tests__/app/canonical.test.ts` | vitest `__tests__/app/canonical.test.ts` + full suite |
| 11 | Quality gates, in order: build (placeholder env); **chaos agent** (.claude/CLAUDE.md:15-26: null/NaN rows, zero-pass and zero-rush teams, a missing opponent row, 0 rows, 1000+ rows, unknown team ids, junk `side/tab/sort/dir/season` params, a string-typed season list) — fix every CRASH/ERROR; code review; push; PR; Vercel preview checked at 375, 768, 1024 and 1280 px, compared with main: no nav label wraps that doesn't wrap on main, and no nav element ends further right than on main; at 375 the page itself does not scroll sideways, and the table scrolls inside its box; CI green; merge | — | as listed |

## 12. Live acceptance checks (after deploy)

Values below are 2026 **through Week 3 as of 2026-09-28**, with CHI and PHI at 2 games (their week-3 game had not been ingested). Any later ingest changes them, so the check is **against a fresh aggregation**, not these literals, unless `data_freshness` still says Week 3 and CHI/PHI GP is still 2:
- Fresh aggregation, key-free: for SF, open `/game/<id>` for each of its games (links on `/team/SF`), take EPA/play and plays from each box score, and compute Σ(EPA × plays) / Σ plays by hand; it must match `/team-stats` to the printed 3 dp. Or rerun `scratchpad/team-stats/fetch_tgs.py` + `aggregate.py` (read-only, anon key) if that script is still at hand.

| URL | Expect (as of Week 3) |
|---|---|
| `/team-stats` | 200, title "NFL Team Stats 2026 — Yards Per Pass"; nav shows Team Tiers, Team Stats, Passing…; Team Stats active; badge "2026 Season · Through Week 3 · …"; SF first, EPA/play `+0.330` green; NFL average row `+0.008`, success 44%, explosive plays 16.5; SF toxic `+17`, KC `+11`; CHI and PHI GP 2; C8 "With only 3 weeks played…" |
| `/team-stats?side=def` | MIN first at `−0.204` (green), LV second `−0.198`; SF `−0.009` grey; no Toxic column; C3 shown |
| `/team-stats?tab=downs` | NYG late-down EPA/play `−0.094` (not `+0.074`); SF late `+0.763` |
| `/team-stats?tab=cost` | SF Total `−8.08`, league Total `−16.02`; C6 and C6b shown |
| `/team-stats?season=2025` | 200 message "Team stats start with the 2026 season" / "Earlier seasons aren’t available yet."; `<meta name="robots" content="noindex, follow">`; no table |
| `/team-stats?side=zzz&tab=zzz&sort=zzz&dir=zzz` | same as `/team-stats` |
| `/sitemap.xml` | contains `/team-stats` (after #24's hourly regeneration, or after the deploy without it) |
| `/teams`, `/game/2026_01_BUF_HOU`, `/rushing`, `/team/SF` | unchanged from pre-merge snapshots (take them before merging) |
| 375 px wide | no sideways page scroll; the table scrolls inside its box with rank + team pinned |
