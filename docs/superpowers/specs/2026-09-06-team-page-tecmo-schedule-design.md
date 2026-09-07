# Team Page: Tecmo Restyle + Schedule & Results — Design Spec

**Date:** 2026-09-06. **Status:** Jon approved direction (mockup option C, minus the team OVR badge). Mockup reference: `.superpowers/brainstorm/4602-1788736028/content/schedule-options.html`.

## Goal

Every team page gets (1) a Schedule & Results section — full season schedule immediately, scores/W-L filling in automatically as games are played — and (2) the Tecmo visual identity the player pages already carry, unifying the page's three competing card styles. NO team OVR badge (explicitly cut; defining a team rating deserves its own study).

## Part 1 — Data: `games` table

**Source:** nflverse schedules release, `https://github.com/nflverse/nflverse-data/releases/download/schedules/games.csv` (~2 MB, all seasons 1999+, future games present with null scores; verified 2026 has all 272 REG games with gameday/gametime; scores populate as games complete).

**Table `games`** (lean subset): `game_id TEXT PRIMARY KEY`, `season INT`, `game_type TEXT` (REG/POST/WC/DIV/CON/SB as sourced), `week INT`, `gameday DATE`, `weekday TEXT`, `gametime TEXT` (ET "13:00", nullable), `home_team TEXT`, `away_team TEXT`, `home_score REAL NULL`, `away_score REAL NULL`. No FK to teams (raw nflverse codes; they match the site's team ids for 2020+). RLS public-read like every other table. Index on `(season, home_team)` and `(season, away_team)`.

**Ingest** (`scripts/ingest.py`): new `ingest_schedules(conn, season)` — downloads games.csv (with the existing @retry; a cached module-level frame so `--all` downloads once), filters to the season, upserts (ON CONFLICT game_id DO UPDATE scores/gameday/gametime — reschedules and score updates flow through). **Called in `main()`'s season loop BEFORE `process_season`, outside the DataNotYetPublished skip** — this is the load-bearing ordering: the schedule must ingest even when no PBP exists yet (pre-season), and must not be skipped when the season is ingested normally. Dry-run: `conn is None` → log the would-upsert count and return without writing. The `ingest_schedules` call in main() must be wrapped in its own `try/except Exception` (log warning, continue) — the loop's existing except catches ONLY DataNotYetPublished, so an unwrapped schedules failure would kill the whole run. ON CONFLICT update set includes scores, gameday, gametime, AND weekday (reschedules change the day name). pytest: transform test (column subset/rename if any, null scores tolerated), plus the ordering guarantee if testable without DB.

**Backfill after merge:** run the seed workflow (2020–2025) + one refresh (2026) so all seasons' schedules land.

## Part 2 — Query + Schedule section

**`lib/data/games.ts`**: `getTeamSchedule(teamId, season): Promise<TeamGame[]>` — rows where team is home or away, ordered by week; derive per-row: `opponent_id`, `home_away`, `played` (both scores non-null), `result` ('W'/'L'/'T' from the team's perspective), `team_score`/`opponent_score`. Type `TeamGame` in lib/types. Wire into `lib/data/team-hub.ts` Promise.all (`.catch(() => [])`) + `TeamHubData.schedule`.

**`components/team/ScheduleSection.tsx`** (mockup B, "Tecmo Season Grid"):
- Card: white rounded-xl shadow, team-color pixel band header `SCHEDULE & RESULTS` left + the record (`{wins}-{losses}(-{ties})` from team_season_stats, already fetched) right, band text via `textColorForBackground`.
- Dark navy `#0f172a` panel, CSS grid of game tiles: `grid-cols-3 sm:grid-cols-6`. **Bye rule (reviewer-pinned):** bye weeks = `{1..max(week over the season's REG rows)}` minus the team's scheduled REG weeks — REG-scoped so playoff rows (game_type WC/DIV/CON/SB, weeks 19–22 in the source) never create phantom byes, and 2020's 17-week season needs no hardcode. Playoff tiles append AFTER the REG grid, labeled by round (WC/DIV/CON/SB).
- Tile: pixel-font week+date line (`W1 · 9/13`), opponent (`@HOU` away / `HOU` home — linked to `/team/HOU`), then: played → `W 27-20` (green tile `#14532d`/border `#4ade80`) or `L 24-31` (red `#7f1d1d`/`#f87171`) or `T` (slate); upcoming → kickoff line (`SUN 1:00`, from weekday+gametime, ET; omit when gametime null) on navy `#1e293b` tile, **the next unplayed game gets the bright `#60a5fa` border**; BYE weeks (1..18 minus scheduled weeks) → dashed dark tile `BYE`.
- Numbers/scores in the regular font; pixel font labels only (site convention). Auto text colors — no hardcoded white on variable backgrounds.
- `title` tooltip per tile: full line (`Week 3 · Sun Sep 27, 1:00 PM ET · vs LA Chargers`; played: final score).
- Empty schedule (no rows): render nothing (section omitted).
- **Upcoming-season rule (amendment 2026-09-06, Jon: "I want to see the schedule even if no games have been played"):** when the viewed season is the LATEST stats season, team-hub also fetches `getTeamSchedule(teamId, season + 1)`; if non-empty, the section shows THAT schedule instead, band labeled `SCHEDULE · {year}` (record segment omitted — the record belongs to the viewed stats season, not the upcoming one). Historical views (`?season=` older than latest) always show their own year. **Mechanism (reviewer-pinned):** `getTeamHubData` gains an `isLatestSeason: boolean` param supplied by the page from its already-fetched `seasons[0]` (do NOT derive inside team-hub — its own getAvailableSeasons resolves too late in the Promise.all to gate the fetch); ScheduleSection gains `upcomingSeason?: number` — when set, the band renders `SCHEDULE · {upcomingSeason}` and the record segment is omitted regardless of teamStats (distinct from the existing null-teamStats state, which keeps the `SCHEDULE & RESULTS` label). **v2 of the rule (amendment, Jon: "how can I see the 2025 results?"): the upcoming schedule ADDS a section rather than replacing the viewed season's.** `TeamHubData` carries BOTH `schedule` (viewed season, unchanged semantics) and `upcomingSchedule: TeamGame[]`; TeamHubContent renders TWO ScheduleSections when upcomingSchedule is non-empty — the upcoming one first (`SCHEDULE · {year}`, no record), the viewed season's (`SCHEDULE & RESULTS`, record) directly below. Each section still self-omits when its own array is empty, so post-flip only one renders. The upcoming instance's grid `aria-label` differentiates (`{teamName} {year} schedule` vs the default) — two identical labels would confuse screen readers. `TeamHubData` final shape: `schedule` (viewed season), `upcomingSchedule: TeamGame[]`, `upcomingSeason: number | undefined` (kept, re-documented as "year of upcomingSchedule when non-empty"); all v1 replacement-semantics comments in team-hub swept. Effect: the 2026 slate appears on every team page today, pre-season; the rule self-retires when 2026 stats flip the latest season (season+1=2027 will be empty until next May's schedule release, at which point next year's schedule pre-surfaces again — intended).
- Placement: FIRST section in TeamHubContent's stack, above Passing Attack (context before analysis, right under the identity header that shows the record).
- Tests: renders a tile per game + bye tiles; W/L/upcoming/next-game states; opponent links; empty → null.

## Part 3 — Team page Tecmo restyle

Content of every section is UNTOUCHED — this is a chrome/styling pass.

- **Unified card idiom**: every section becomes `bg-white rounded-xl shadow overflow-hidden` with a team-color pixel band header (band text via `textColorForBackground`, section name uppercase pixel font, like the card/passing-map bands). Sections and their band labels: `PASSING ATTACK`, `GROUND GAME`, `RUSHING BY DOWN & DISTANCE`, `SITUATIONAL EFFICIENCY`, `DEFENSE`, `{DIVISION}` (e.g. `AFC EAST`). Interior padding/content markup unchanged (the two bare sections — DownDistanceHeatmap, SituationalDashboard — gain the card wrapper).
- **TeamIdentityCard → Tecmo header** (mockup C top card): team-color band (`{TEAM NAME}` left, `{CONFERENCE} {DIVISION}` right); body row: logo, pixel line `12-5 · 2ND AFC EAST` (division rank derived from `allTeamStats` — team-hub already fetches ALL 32 teams' records — filtered to the division via NFL_TEAMS; wins-desc sort, ties share rank), second pixel line `OFF EPA 3RD · DEF EPA 11TH · TO DIFF +9`. NO OVR badge.
- **Pre-season launch state (reviewer-required):** schedules backfill BEFORE any week-1 stats exist, so a team page can have a full schedule while `teamStats === null`. When teamStats is null: the ScheduleSection band shows just `SCHEDULE & RESULTS` (record segment omitted); the identity header omits the record + division-rank pixel line and the EPA/TO-diff line (band + logo + name still render). Nothing may crash or show `undefined`/`NaN`.
- **Turnover differential**: add `takeaways`, `giveaways`, `turnover_diff` to the `TeamSeasonStat` interface (already in the DB payload via select("*"), never typed/rendered — reviewer-verified earlier). Display signed (`+9`/`−3`).
- **Cleanup within touched files only**: the 4× copy-pasted `ordinalSuffix` helpers may be replaced with `ordinal` from `lib/stats/percentiles` where those files are already being edited; do NOT refactor untouched files. GroundGameSection's discarded `teamDefGaps` prop (`void _teamDefGaps`) may be removed from its interface + call site.
- Desktop scale-up conventions follow the card (lg: pixel sizes step up).

## Out of scope

Team OVR badge; `/teams` index page changes; team OG images; playoffs bracket views; betting lines/spreads from games.csv (ingested columns exclude them).

## Verification

- Gates: tsc, vitest (new ScheduleSection + games-transform tests), pytest, placeholder-env build.
- Chaos-lite cases: team with 0 games (pre-backfill), ties, null gametime, playoff rows render as appended round-labeled tiles and NEVER as phantom byes, season 2020 (17-week REG max — covered by the REG-scoped bye rule), null teamStats (pre-season launch state), team codes on relocated franchises (2020 LV/LA fine; no seasons < 2020 on site).
- Post-merge: backfill workflows; verify a live team page shows the 2026 schedule; verify record band renders.
