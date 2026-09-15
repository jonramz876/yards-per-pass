# Box Scores — Design Spec

**Date:** 2026-09-15
**Status:** Approved by Jon (brainstormed section by section, mockups chosen in the visual companion)
**Scope:** per-game box score pages for 2026, a weekly scores page, and a homepage scores strip. Charts are a separate later project.

## 1. Goal

Give every played game a page that answers **why a team won**, with the advanced stats the site already specialises in (EPA, success rate, explosive plays) alongside the traditional box score, plus each player's line.

Today nothing links to a game: `games` holds the schedule and final scores, and the weekly player tables hold per-player games, but no team stats exist per game and there is no game page.

## 2. Decisions (all made by Jon)

| Decision | Choice |
|---|---|
| Page leads with | "Why they won" — team-vs-team advanced comparison, player lines below |
| Seasons in v1 | 2026 only; 2020–2025 backfilled later (the ingest step must be season-agnostic) |
| Player lines | Reuse the existing weekly QB/receiver/RB rows (approach A), built so a complete player table can replace it later |
| Game chart (win probability / drives) | Not in v1 — the later charts project |
| Definitions | nflfastR / rbsdm standard (see §4) |
| Team comparison sections | Efficiency core, traditional team stats, what it cost them, early vs late downs |
| Team comparison layout | Side-by-side stat sheet: `AWAY | stat | HOME`, better side shaded, section bands like the team pages. Detail values in parentheses: `+0.24 (52)`, `8 (15%)` |
| Extra efficiency row | Toxic differential (turnover margin + explosive margin), using this page's explosive definition so it reconciles with the row above |
| Player lines layout | Type A: one table per stat type (passing, rushing, receiving) with both teams' rows inside |
| Receiving columns | Adds target share (TGT%) and Y/TGT; YPRR shown **only when route data exists** |
| Entry points | Schedule tiles, Game Log rows (phase 1); scores page + homepage strip (phase 2) |
| Scores page layout | Tecmo game cards grouped by kickoff window |
| Homepage strip | Top of the homepage, above the standings |
| Unplayed games | No page; links only on played games |
| Percentile colouring | Later, after the backfill (a handful of 2026 games is too small a pool) |
| Playoffs | Out of scope (the ingest skips them today) |

## 3. Phases

- **Phase 0 — Game Log score fix.** Its own PR, before box score work. See §9.
- **Phase 1 — box score.** `team_game_stats` + player-row fixes (PR 2), then `/game/[game_id]` with schedule-tile and Game Log links (PR 3).
- **Phase 2 — ways in.** `/scores` page + homepage strip (PR 4).

## 4. Definitions

The site's existing pages use three slightly different play filters; box scores use the nflfastR/rbsdm standard so the numbers match other analytics sites. Unifying the older pages is a follow-up, so **a team's box score EPA/play may differ slightly from its season figure on the team page** until then.

| Item | Definition |
|---|---|
| Plays counted (efficiency) | `(pass == 1 or rush == 1)` and `epa` not null and `posteam` not null. Sacks and scrambles count as passes; plays wiped out by penalty are included; kneels and 2-point tries are excluded |
| Success | `success == 1` (EPA > 0) |
| Explosive | rush gaining 10+ yards, or a completed pass gaining 20+ yards |
| First-down rate (`1st%`) | share of counted plays with `first_down == 1` |
| Early / late downs | downs 1–2 / downs 3–4 |
| Red zone | inside the opponent's 20 (nflverse convention, **not** the site's current "includes the 20") |
| Time of possession | summed per `drive`, never `fixed_drive` (which gave one game 57:46) |
| Traditional counts | official box-score conventions (kneel-downs count as rushing attempts, net passing yards subtract sack yards), so they match ESPN / Pro Football Reference |
| Toxic differential | (opponent turnovers − own turnovers) + (own explosive plays − opponent explosive plays), using the explosive definition above |

**Verified 2026-09-15** against rbsdm's BUF–HOU week 1 page: every row matched exactly — BUF all `+0.28 / 41 / 36 / 56`, rush `−0.26 (19)`, pass `+0.56 (37)`, early `+0.30 (45)`, late `+0.30 (10)`; HOU all `+0.07 / 48 / 32 / 79`, rush `+0.03 (31)`, pass `+0.10 (48)`, early `+0.10 (59)`, late `−0.01 (20)`. The site's current filter gives BUF `+0.25 (52)` for the same game, because it drops 4 penalty-wiped plays and would keep kneels.

## 5. Data: `team_game_stats`

One row per team per game; about 544 rows a season, ~3,200 for a full 2020–2026 backfill. Key: `(game_id, team_id)`, with `season`, `week`, `opponent_id`, `home_away`. Built the same way as `team_situational_stats`: an `aggregate_*` function, an `ensure_*` table function, an `upsert_*` function, all called inside `process_season`'s single transaction, with stale rows cleaned like the other tables (a rescheduled game gets a new `game_id`, so the old row must go).

**Efficiency:** plays, epa_per_play, success_rate, first_down_rate; the same four for pass and for rush; explosive_plays, explosive_rate, explosive_pass, explosive_rush.
**Early/late:** plays, epa_per_play, success_rate for early downs and for late downs.
**What it cost them:** epa_lost_turnovers, epa_lost_sacks, epa_lost_penalties (the team's own penalties).
**Traditional:** first_downs and the passing/rushing/penalty splits, third_down_att/conv, fourth_down_att/conv, total_plays, total_yards, total_drives, yards_per_play, net_passing_yards, completions, attempts, yards_per_pass, interceptions, sacks, sack_yards, rushing_yards, rushing_attempts, yards_per_rush, red_zone_trips, red_zone_tds, penalties, penalty_yards, turnovers, fumbles_lost, def_st_tds, time_of_possession_seconds.
**For the player tables:** team_targets (so target share divides by the true team total, not a sum of stored player rows).

**Not stored here:** final scores and records, which always come from `games`; and anything per-play or per-drive, which v1 does not keep.

## 6. Page: `/game/[game_id]`

Address uses nflverse's game id, e.g. `/game/2026_01_BUF_HOU` (season, week, away, home).

**Order:** Tecmo scoreboard header (away @ home, final score, week, date, each team's record after that game, links to both team pages) → Efficiency (ending with toxic differential) → Team stats → What it cost them → Early vs late downs → Player stats.

**Player tables (type A).** One table per stat type, away team's rows then home team's, each under a team sub-header:
- **Passing:** C/ATT, YDS, TD, INT, SCK, RTG, EPA/DB, CPOE, SUCC%, aDOT
- **Rushing:** CAR, YDS, TD, YPC, EPA/CAR, SUCC% — including QB runs
- **Receiving:** TGT, REC, YDS, TD, TGT%, YAC, EPA/TGT, CATCH%, aDOT, Y/TGT, and YPRR only when route data exists

Sorted by yards descending within each team. Player names link to their player page. Advanced columns are visually distinguished from basic ones, and EPA values are coloured green/red with the shared `epaTextColor` helper.

**States:**
- unknown game id, or a season with no data → `notFound()`
- game not played (no final score) → `notFound()`; links only render for played games
- played but no play-by-play yet (e.g. Sunday night game the next morning) → scoreboard renders, stat sections show "Stats arrive once play-by-play is published, usually within a few hours"
- a data read fails → the page throws rather than rendering an empty shell, per `.claude/CLAUDE.md`, so ISR keeps the last good copy. The placeholder-credentials escape hatch (`hasNoDatabase`) applies as on the homepage

**Caching:** statically generated with ISR like the rest of the site; `/api/revalidate` gains `/game` (layout) so each nightly run refreshes it. Sitemap gains played games' URLs.

**Mobile:** the comparison fits phone width; player tables scroll sideways inside their own container.

## 7. Links (phase 1)

- **Schedule tiles** (`components/team/ScheduleSection.tsx`): the tile already links the opponent's abbreviation to their team page, and links cannot nest. So on played games the **result/score line becomes the box score link**, leaving the opponent link intact. Unplayed tiles are unchanged.
- **Game Log rows** (`components/player/GameLogTab.tsx`): the result cell ("W 36-31") links to that game's box score. Requires Phase 0, or the link text shows a wrong score.

## 8. Phase 2: `/scores` and the homepage strip

**`/scores`** — navbar entry "Scores" between Rushing and Run Gaps. Opens on the latest week with a finished game; week picker W1–W18 plus the season picker. Tecmo game cards grouped by kickoff window in kickoff order, winner in gold, the "why they won" line, and a box score link. Unplayed games show kickoff time and no link.

**"Why they won" rule.** Score the winner's three edges — EPA/play margin ÷ 0.10, turnover margin ÷ 1, explosive-play margin ÷ 2 — and use the highest scoring one, provided it scores at least 1.0. If the winner trailed badly on another edge (score ≤ −2.0), append a "despite" clause. Wording:
- turnovers → "TB turned it over 4 times" / "+2 turnover margin"
- EPA → "+0.42 EPA/play edge"
- explosives → "7 explosive plays to 2"
- if the winner was behind on all three → "+0.25 EPA/play despite GB's 9 explosive plays"
- nothing scoring 1.0 or more → "Close one: …" with the best available edge
- tie game → "Tie game."

Checked against all 15 finished week 1 games, which produce: turnovers for SEA–NE (+3) and CIN–TB (+4) and DET–NO (+2); EPA for SF–LA (+0.42), JAX–CLE (+0.52), BAL–IND (+0.43), ARI–LAC (+0.31), MIN–GB (+0.25, with the "despite GB's 9 explosive plays" clause), CHI–CAR (+0.23), BUF–HOU (+0.21), LV–MIA (+0.21), NYJ–TEN (+0.27), PIT–ATL (+0.11); explosives for NYG–DAL (4 to 0); and "Close one: 4 explosive plays to 3" for PHI–WAS, whose best edge scores 0.5. Each branch gets a test.

**Homepage strip** — directly under the "Updated … Through Week N" line, above the standings: the latest week's finals as small Tecmo score tiles that scroll sideways, each linking to its box score, plus that week's upcoming games with kickoff time, and a "Week N scores ›" link to `/scores`. The week shown advances as soon as the next week's first game is final. Its data reads join the homepage's protected set, so a failed read makes the page refuse to render rather than caching a half-empty homepage.

Both read only `games` and `team_game_stats`; no further pipeline work.

## 9. Phase 0: Game Log score fix

`aggregate_qb_weekly_stats` and its receiver/RB siblings (`scripts/ingest.py:1922-1969`) take each game's score from the last run or pass play, so points scored afterwards — a walk-off field goal, a defensive score after the last snap — are missing. Across 2020–2025 that is **17–31 wrong scores and 17–28 wrong W/L/T per season**, visible in every Game Log tab today.

Fix: results and scores come from `games`.

**Recommended implementation:** read the score and result from `games` when the Game Log renders, and stop trusting the stored columns. It fixes all six historical seasons the moment it deploys, with no production write and no re-ingest. The ingest keeps writing those columns (other code may read them), but they stop being the source of truth for display.

**Alternative, not recommended for Phase 0:** correct the stored rows by re-ingesting 2020–2025. It needs Jon's approval for a production write and ~6 minutes of seed runs, and fixes nothing that the read-time join doesn't. Worth folding into the 2020–2025 backfill when that happens anyway.

Box scores read scores from `games` regardless, so they are unaffected by the choice.

## 10. Player-row fixes (PR 2)

Found while mocking this up against real data:
1. **QB runs have no EPA or success rate.** `qb_weekly_stats` stores only rushing attempts/yards/TDs, so Josh Allen's 5 carries and 2 rushing TDs show "—". Add rushing EPA and success rate for QBs.
2. **A receiver target is missing.** Play-by-play shows Keon Coleman with 2 targets in BUF–HOU; `receiver_weekly_stats` has 1. Find the cause in the weekly aggregation and fix it.
3. **Target share divides by `team_targets`** from `team_game_stats` (BUF 29, HOU 37), never by a sum of stored rows.
4. **Known and accepted:** nflverse credits 10 of Allen's 334 passing yards to no receiver (his receivers total 324), most likely a lateral. Player lines will not always sum to team totals; the plan confirms the cause and documents it rather than "fixing" it.

## 11. Testing

**Python (pytest):**
- small made-up games covering every stored stat, plus overtime, ties, defensive and special-teams TDs, safeties, kneel-downs, penalty-wiped plays, 2-point tries, a lateral, a team with zero pass attempts, and a game with no plays yet
- **golden tests** pinning real week 1 games: efficiency rows must match rbsdm exactly (BUF–HOU numbers in §4), traditional rows must match the official ESPN box score (BUF–HOU: 20/26 first downs, 409/381 yards, 3-9 and 7-16 on third down, 1-3 and 4-5 in the red zone, 10-85 and 7-106 penalties, 0/2 turnovers, 23:43 / 36:17 possession). Fixtures are a small extract of those games' plays, not a full-season file
- season-agnostic: the same function run for a 2025 game produces sane output

**Frontend (vitest):** each section renders from a fixture; the "stats arrive" state; not-found states; links present only on played games; the hook rule across all 15 week 1 games; the strip advancing to a new week; YPRR hidden when no route data and shown when present; an error in any protected read prevents a blank render.

**After each merge:** compare three live box scores against rbsdm and ESPN before starting the next PR.

## 12. Risks

- **Numbers differ from the site's own team pages** until the play-filter unification follow-up. Called out in the glossary.
- **Player lines don't sum to team totals** (§10.4). Documented on the page's data note.
- **YPRR is empty for the current season.** nflverse publishes participation only after a season ends (2025's file appeared 2026-02-10), so the column hides itself for 2026 games until then. No free in-season source exists: Next Gen Stats and FTN charting carry no routes-run.
- **Playoff games have no box score** while the ingest skips them.
- **Backfill is a production write** and stays Jon's call.

## 13. Follow-ups (not in this work)

Backfill 2020–2025; percentile colouring against all games since 2020; drives, scoring summary and biggest plays; a complete per-game player table with defence and kicking (approach B); win probability and other charts (the separate charts project); unify the site's play filters; preview pages for unplayed games; playoffs.
