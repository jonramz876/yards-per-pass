# Box Scores — Design Spec

**Date:** 2026-09-15 (revised after spec review)
**Status:** design approved by Jon section by section; revised to fix 13 blocking issues from spec review
**Scope:** per-game box score pages for 2026, a weekly scores page, a homepage scores strip. Charts are a separate later project.

## 1. Goal

Give every played game a page that answers **why a team won**, using the advanced stats this site specialises in (EPA, success rate, explosive plays) beside the traditional box score, plus each player's line.

Today nothing links to a game: `games` holds the schedule and final scores, the weekly player tables hold per-player games, but no team stats exist per game and there is no game page.

## 2. Decisions (Jon's, not to be relitigated)

| Decision | Choice |
|---|---|
| Page leads with | "Why they won" — team-vs-team advanced comparison, player lines below |
| Seasons in v1 | 2026 only; 2020–2025 backfilled later (the ingest step is season-agnostic) |
| Player lines | Reuse the existing weekly QB/receiver/RB rows (approach A), built so a complete player table can replace it later |
| Game chart (win probability / drives) | Not in v1 — the later charts project |
| Definitions | nflfastR / rbsdm standard (§4) |
| Team comparison sections | Efficiency core, traditional team stats, what it cost them, early vs late downs |
| Team comparison layout | `AWAY | stat | HOME` stat sheet, better side shaded, section bands like the team pages, detail values in parentheses: `+0.28 (56)`, `8 (15%)` |
| Extra efficiency row | Toxic differential (turnover margin + explosive margin), using this page's explosive definition so it reconciles with the row above |
| Player lines layout | Type A: one table per stat type (passing, rushing, receiving) with both teams' rows inside |
| Receiving columns | Adds target share (TGT%) and Y/TGT; YPRR shown **only when route data exists** |
| Entry points | Schedule tiles and Game Log rows (phase 1); scores page and homepage strip (phase 2) |
| Scores page layout | Tecmo game cards grouped by kickoff window |
| Homepage strip | Top of the homepage, above the standings |
| Unplayed games | No page; links only on played games |
| Percentile colouring | Later, after the backfill |
| Playoffs | Out of scope (the ingest skips them); playoff tiles never link |

## 3. Phases

- **Phase 0 — Game Log score fix** (own PR, first). §9.
- **Phase 1 — box score.** PR 2: `team_game_stats` + player-row work. PR 3: `/game/[game_id]` + schedule-tile and Game Log links.
- **Phase 2 — ways in.** PR 4: `/scores` + homepage strip.

Each PR leaves the site working on its own.

## 4. Definitions

The site's existing pages use three different play filters. Box scores use the nflfastR/rbsdm standard so numbers match other analytics sites; unifying the older pages is a follow-up, so **a team's box score EPA/play may differ from its season figure on the team page** until then.

### Efficiency set

```
(pbp["pass"] == 1) | (pbp["rush"] == 1), and epa not null, and posteam not null
```

That is the whole filter. Specifically:
- **Kneels need no exclusion.** nflverse sets `pass = 0` and `rush = 0` on `qb_kneel`, so they drop out by themselves.
- **2-point tries are KEPT.** Do **not** copy `filter_plays()`'s `two_point_attempt != 1`. Verified: BUF's failed 2-point pass in week 1 is one of their 56 plays, and only the 2-pt-kept version reproduces rbsdm.
- **2-point rows have a null `down`**, so early-down plays + late-down plays can be one fewer than total plays (BUF, MIN, NO and WAS in week 1). The page must not claim they add up.

| Item | Definition |
|---|---|
| Success | `success == 1` (EPA > 0) |
| First-down rate (`1st%`) | share of efficiency-set plays with `first_down == 1` |
| Early / late downs | `down` 1–2 / 3–4 within the efficiency set |
| Pass / rush split | `pass == 1` / `rush == 1` (scrambles and sacks sit in **pass**) |
| Explosive pass | `complete_pass == 1 and yards_gained >= 20` |
| Explosive rush | `(rush == 1 or qb_scramble == 1) and yards_gained >= 10` |
| Toxic differential | (opponent turnovers − own turnovers) + (own explosive plays − opponent explosive plays) |

**Scrambles are explosive runs but pass plays for EPA.** nflverse sets `pass = 1, rush = 0, complete_pass = 0` on scrambles, so without the `qb_scramble` clause 19 of week 1's 10+ yard scrambles vanish — a 10% undercount (163 vs 182 explosives). The page's glossary tooltip states this.

**Both explosive rules are already penalty-safe** — do not "harden" them later. All 292 week-1 `no_play` rows have `yards_gained == 0` and `complete_pass == 0`, so a wiped-out play can never be explosive; kneels have `rush = 0` and `qb_scramble = 0`; 2-point plays cannot reach either threshold.

**Verified 2026-09-15** against rbsdm's BUF–HOU week 1 page, every row exact: BUF all `+0.28 / 41 / 36 / 56`, rush `−0.26 (19)`, pass `+0.56 (37)`, early `+0.30 (45)`, late `+0.30 (10)`; HOU all `+0.07 / 48 / 32 / 79`, rush `+0.03 (31)`, pass `+0.10 (48)`, early `+0.10 (59)`, late `−0.01 (20)`. The site's current `filter_plays` gives BUF `+0.247 (52)` for the same game: it drops 4 penalty-wiped plays and keeps the kneel.

### Traditional set (official box-score conventions, matching ESPN / PFR)

Computed from **raw play-by-play**, not the efficiency set, and each with its own rule:

| Stat | Rule | Week 1 BUF/HOU check |
|---|---|---|
| Total yards | `passing_yards` + `rushing_yards` + sack `yards_gained` (negative), 2-pt excluded. Plain `yards_gained` does **not** work (it counts return yards) | 409 / 381 ✅ |
| Net passing yards | `passing_yards` − sack yards lost | 323 / 257 ✅ |
| Comp/Att, Yards per pass | completions, attempts; net passing ÷ (attempts + sacks) | 20/29 · 10.4, 26/38 · 6.3 ✅ |
| Rushing yards / attempts / YPR | `rush_attempt == 1` including kneels and scrambles | 86 · 21 · 4.1, 124 · 32 · 3.9 ✅ |
| Total plays | rush attempts + pass attempts excluding sacks + sacks. **This is a third play count**, different from the efficiency plays (56/79) and from the pass/rush splits | 52 / 73 ✅ |
| Yards per play | total yards ÷ total plays (the count above) | 7.9 / 5.2 ✅ |
| Sacks / sack yards | `sack == 1`; yards from `yards_gained` on those plays. **Stored positive** (11 / 17), not the raw negative, so the page renders ESPN's "2-11" without a double minus. The negative value is only used inside total yards | 2-11 / 3-17 ✅ |
| Interceptions | `interception == 1` on this team's pass plays | 0 / 0 ✅ |
| Fumbles lost | `fumble_lost == 1` on this team's plays. Never co-occurs with an interception on the same play, so `turnovers` has no internal double count | 0 / 2 ✅ |
| 3rd / 4th down | attempts and conversions **excluding `no_play` rows** — the opposite of the efficiency filter. Including them gives HOU 8-of-18 | 3-9 / 7-16 ✅ |
| First downs (total) | `first_down_pass + first_down_rush + first_down_penalty` | 20 / 26 ✅ |
| Red zone trips / TDs | **drive-level**: a drive is a trip if any snap reaches `yardline_100 <= 20`; a score if that drive ends in a TD **scored by this team** (`td_team == team`), so a red-zone pick-six is not credited to the offence (no such case in week 1, so the golden test cannot catch it). Scrimmage plays only, 2-pt excluded (play-level counting gives BUF 6 trips because extra points snap from the 15) | 1-3 / 4-5 ✅ |
| Penalties / yards | `penalty == 1 and penalty_team == team` | 10-85 / 7-106 ✅ |
| Turnovers | `interception == 1` + `fumble_lost == 1` | 0 / 2 ✅ |
| Total drives | distinct `drive` over rows with this `posteam` and non-null `drive` (4 week-1 rows have a posteam but null drive) | 12 / 11 ✅ |
| Time of possession | one `drive_time_of_possession` per (game, team, `drive`) over **all** raw rows with a posteam — 1 of 354 week-1 drives (TEN drive 6) has no scrimmage play and would otherwise be lost. Never `fixed_drive` | 23:43 / 36:17 ✅ (sums to 60:00; 68:26 in the OT game) |
| Defensive / ST TDs | rows where `td_team == team and posteam != team` (3 in week 1, all INT/fumble returns) | 0 / 0 ✅ |

**First downs deliberately double-count one case.** One HOU play (3rd-and-2 run for 6 yards *plus* defensive holding) sets both `first_down_rush` and `first_down_penalty`. Only the sum of parts reaches ESPN's 26; `sum(first_down)` gives 25. This diverges in 91 of 544 (16.7%) 2025 team-games by 1–3. We store the sum of parts so the total always equals its own sub-rows and matches ESPN, and the glossary notes it.

### "What it cost them"

| Stat | Rule |
|---|---|
| EPA lost to turnovers | sum of `epa` on the team's own interception and lost-fumble plays |
| EPA lost to sacks | sum of `epa` on plays where the team was sacked |
| EPA lost to penalties | (sum of `epa` on penalty plays where this team had the ball) − (sum of `epa` on penalty plays where this team was on defense). The naive one-sided version **flips sign**: BUF gets +2.39, because 6 of their 10 penalties came on defence where the EPA belongs to HOU. Sign-corrected: −8.52 |

**A strip-sack counts in both** the sack row and the turnover row. That overlap is intended; the page says so in a footnote.

## 5. Data: `team_game_stats`

One row per team per game — 544 a season; ~3,776 for a 2020–2026 backfill (2020 had 256 games). Key `(game_id, team_id)` plus `season`, `week`, `opponent_id`, `home_away`.

**Efficiency:** plays, epa_per_play, success_rate, first_down_rate; the same four for pass and for rush; early_plays/epa/success, late_plays/epa/success; explosive_plays, explosive_rate, explosive_pass, explosive_rush.
**What it cost them:** epa_lost_turnovers, epa_lost_sacks, epa_lost_penalties.
**Traditional:** first_downs, first_downs_pass, first_downs_rush, first_downs_penalty, third_down_att/conv, fourth_down_att/conv, total_plays, total_yards, total_drives, yards_per_play, net_passing_yards, completions, attempts, yards_per_pass, interceptions, sacks, sack_yards, rushing_yards, rushing_attempts, yards_per_rush, red_zone_trips, red_zone_tds, penalties, penalty_yards, turnovers, fumbles_lost, def_st_tds, time_of_possession_seconds.
**For the player tables:** `team_targets` — plays with a non-null `receiver_player_id`, `pass_attempt == 1`, `sack != 1`, `qb_scramble != 1`, `two_point_attempt != 1`: the exact set `aggregate_receiver_weekly_stats` counts, so TGT% sums to 100%. **BUF 28, HOU 37** (not 29/37 — pass attempts are a different number).

**Not stored:** final scores and records (always from `games`), and anything per-play or per-drive.

**How it runs.** `aggregate_team_game_stats(pbp, season)` takes **raw** play-by-play — following `aggregate_team_stats(plays, pbp, season)` at `scripts/ingest.py:237`, **not** the situational aggregators, which only receive `filter_plays()` output and so can't see `no_play`, kicking, or 2-pt rows. `ensure_team_game_stats_table(conn)` joins the other `ensure_*` calls at `scripts/ingest.py:3495-3508`, which sit **before** `process_season`'s try/rollback and each commit their own DDL. Only the upsert and cleanup run inside the transaction.

**Stale rows.** `cleanup_stale_rows` deletes by `team_id != ALL(...)` or `player_id != ALL(...)`, which can never delete a game-keyed row (all 32 teams are always present). It gains a `game_ids` parameter and `DELETE FROM team_game_stats WHERE season = %s AND game_id != ALL(%s)`, so a rescheduled game's old row goes. The orphan row in `games` itself has no cleanup (known debt in MEMORY.md) and would show on `/scores` as a scoreless card with a past kickoff forever — §8 labels those "result not yet reported" rather than hiding them, so a broken schedules feed can never make real finished games vanish.

## 6. Page: `/game/[game_id]`

Address uses nflverse's id: `/game/2026_01_BUF_HOU` (season, week, away, home).

**Order:** Tecmo scoreboard header (away @ home, final score, week, date, each team's record after that game, links to both team pages) → Efficiency (ending with toxic differential) → Team stats → What it cost them → Early vs late downs → Player stats.

**Records** are counted from that team's `games` rows through that week, reusing `winPct`/`compareRecords` tie semantics; `games` has no record column.

**Player tables (type A).** Rows are fetched by `season + week + team_id IN (away, home)`, taken from the `games` row — never by parsing the URL. Away team's rows first, then home, under team sub-headers, sorted by yards descending; names link to player pages.
- **Passing:** C/ATT, YDS, TD, INT, SCK, RTG, EPA/DB, CPOE, SUCC%, aDOT — `qb_weekly_stats`
- **Rushing:** CAR, YDS, TD, YPC, EPA/CAR, SUCC% — `rb_weekly_stats` + QB rushing from `qb_weekly_stats` (§10.1)
- **Receiving:** TGT, REC, YDS, TD, TGT%, YAC, EPA/TGT, CATCH%, aDOT, Y/TGT, and YPRR only when route data exists — **`receiver_weekly_stats` only**. Its position filter already includes RB/FB (`scripts/ingest.py:2186`), so unioning `rb_weekly_stats` would duplicate every RB.

**Every EPA cell needs `val == null || Number.isNaN(val)`.** `epaTextColor` (`lib/stats/formatters.ts:48`) guards `isNaN` only, and `isNaN(null)` is false, so a null EPA would render amber "neutral" instead of grey — the same footgun as the September 11 team-page crash. Zero-volume players produce null EPA/DB, EPA/CAR and EPA/TGT.

**States:**
- unknown game id → `notFound()`
- game not played (no final score) → `notFound()`; links never render for it
- **played REG game in a season with no `team_game_stats`** (every 2020–2025 game until the backfill) → a 200 page, `noindex`: the scoreboard plus "Box scores start with the 2026 season", linking both team pages. Never a blank page (MEMORY.md rule)
- played, season covered, but play-by-play not published yet → scoreboard plus "Stats arrive once play-by-play is published, usually within a few hours"
- a protected read fails → the page throws rather than rendering an empty shell, so ISR keeps the last good copy. `hasNoDatabase` is module-private in `app/page.tsx:34`, so it moves to `lib/supabase/server.ts` and both pages import it. That module is server-only (it builds the Supabase server client), so it must never be imported from a `"use client"` file

**Rendering:** no `generateStaticParams` — team pages enumerate from the static `NFL_TEAMS` constant with no DB read, but game ids would need one, and a Supabase blip would then fail every build. Pages are generated on demand with `revalidate = 3600`; `/api/revalidate` gains `/game` (layout). The sitemap lists played, covered games.

**Mobile:** the comparison fits phone width; player tables scroll sideways in their own container.

## 7. Links (phase 1)

A link renders only when **`game_type === "REG"`** and **the game's season has `team_game_stats`**, resolved from data rather than hardcoding 2026. Without that gate, 1,709 played rows — 1,693 of them 2020–2025 — plus 78 playoff rows would all point at the message page. Playoff tiles never link.

**The gate read must be season-distinct via `fetchAllRows()`**, or derived from `data_freshness`. A plain `team_game_stats?select=season` hits PostgREST's 1000-row default — about two seasons out of ~3,776 backfilled rows — and would *disable* links for seasons that do have box scores. Verified live: `games?select=season` over 1,965 rows returns only 2020, 2021, 2022, 2023 and 2026; 2024 and 2025 vanish.

**Threading the list to the components.** Both consumers are client components — `components/team/TeamHubContent.tsx:2` and `components/player/PlayerPageContent.tsx:2` are `"use client"` — so the seasons list is fetched in `app/team/[team_id]/page.tsx` and `app/player/[slug]/page.tsx` and passed down as a serialized prop.

- **Schedule tiles** (`components/team/ScheduleSection.tsx`): the tile already links the opponent abbreviation to their team page and links cannot nest, so the **result/score line** becomes the box score link. Unplayed and uncovered tiles are unchanged.
- **Game Log rows** (`components/player/GameLogTab.tsx`): the result cell ("W 36-31") links to the box score. Requires Phase 0 or the link text shows a wrong score.

## 8. Phase 2: `/scores` and the homepage strip

**`/scores`** — navbar entry "Scores" between Rushing and Run Gaps. Opens on the latest week with a finished game; week and season pickers are query params, which force dynamic rendering (MEMORY.md), so the page renders per request. It is added to the sitemap's static list. **On a read failure it shows `error.tsx` to that visitor** — there is no cached copy to fall back on, so §6's "throw and keep the last good page" reasoning does not apply here; that is accepted for this page. (`/teams` is a poor precedent to copy: it declares `revalidate = 3600` and is listed in `/api/revalidate`.)

Any read not scoped to one season must use `fetchAllRows()` — for `games` **and** `team_game_stats` — because of the 1000-row cap described in §7.

Tecmo game cards grouped by **kickoff window** — `weekday` + `gametime` (24-hour ET text, non-null on all 1,965 rows), with Sunday 16:05 and 16:25 treated as one late-afternoon group — in kickoff order. Winner in gold, the "why they won" line, a box score link.

**Games with no score.** Unplayed games show kickoff time and no link. A game whose kickoff has clearly passed but has no score is **labelled "result not yet reported"**, never hidden: `ingest_schedules` only logs a warning on failure (`scripts/ingest.py:3578-3581`), so a broken schedules feed would otherwise make real finished games disappear from the page — worse than a stale card. Comparing kickoff to "now" needs an explicit DST-aware ET→UTC conversion (`gametime` is ET text, and `ScheduleSection.tsx:59-60` exists because `new Date("2026-09-13")` parses as UTC midnight). Cards for weeks older than `data_freshness.through_week` that still have no score keep the same label.

**"Why they won" rule.** Score the winner's three edges — EPA/play margin ÷ 0.10, turnover margin ÷ 1, explosive margin ÷ 2 — and take the highest if it scores ≥ 1.0.
- turnovers → "TB turned it over 4 times" / "+2 turnover margin"
- EPA → "+0.42 EPA/play edge"
- explosives → "7 explosive plays to 2" (counts use §4's scramble-inclusive rule, so they are not the ESPN-style totals)
- winner trailing badly on another edge (that edge scores ≤ −2.0) → append "despite GB's 9 explosive plays"
- **ties in score** → fixed priority: turnovers, then EPA, then explosives (7 of 272 2025 games tie, e.g. `2025_07_CAR_NYJ` at 2.0/2.0), so output never depends on iteration order
- **winner negative on all three** (2 of 272 in 2025, e.g. `2025_13_ATL_NYJ`) → "Won it on special teams and field position" is wrong to assert, so: "Won despite a −1.58 EPA/play deficit"
- nothing ≥ 1.0 → "Close one: …" with the best edge
- tie game → "Tie game."

Verified against all **16** week 1 games (week 1 is complete; DEN–KC finished 2026-09-14, KC 31 DEN 10): turnovers for SEA–NE (+3), CIN–TB (**+3**, TB turned it over 4 times) and DET–NO (+2); EPA for JAX–CLE (+0.52), KC–DEN (+0.50), BAL–IND (+0.43), SF–LA (+0.42), ARI–LAC (+0.31), NYJ–TEN (+0.27), MIN–GB (+0.25, with the despite clause), CHI–CAR (+0.23), BUF–HOU (+0.21), LV–MIA (+0.21), PIT–ATL (+0.11); explosives for **NYG–DAL (4 to 1**, score 1.50, still ahead of EPA's 0.92); **"Close one: 6 explosive plays to 5"** for PHI–WAS (margin +1, score 0.50). Those last two include scrambles per §4 — counting only `rush == 1` would give the older 4-to-0 and 4-to-3 strings, which are wrong. MIN–GB's despite clause is unaffected (GB has 9 explosives under either rule). Tests cover each branch and must not hardcode a game count.

**Homepage strip** — directly under the "Updated … Through Week N" line, above the standings: the latest week's finals as small Tecmo score tiles that scroll sideways, each linking to its box score, plus that week's upcoming games with kickoff time, and a "Week N scores ›" link. The week advances as soon as the next week's first game is final. Its reads must **throw** on error (use a `getTeamSchedule`-style read, `lib/data/games.ts:87` — not `hasScheduleForSeason`, `:110`, which swallows errors into `false`), so they join the homepage's protected set and a failure can't cache a half-empty homepage.

Both read only `games` and `team_game_stats`; no pipeline work beyond Phase 1.

## 9. Phase 0: Game Log score fix

`_derive_game_context` (`scripts/ingest.py:1922-1969`), the helper used by all three weekly aggregators (`:1977`, `:2136`, `:2254`), takes each game's score from `max(total_home_score)` / `max(total_away_score)` over the **filtered** plays, so points scored after the last run or pass are missing. Replaying 2025 reproduces **31 wrong scores and 28 flipped W/L/T** — the top of the 17–31 / 17–28 range. (2026 week 1 has 0 of 16 wrong, so it cannot be spot-checked on current data.)

**Recommended fix:** read score and result from `games` when the Game Log renders. It corrects all six seasons on deploy, with no production write.

`GameLogTab` currently receives `{ weeklyStats, position, season, teamId }`, `WeeklyRow` has **no `game_id`**, and `resultStr` (`components/player/GameLogTab.tsx:36-41`) reads `team_score`/`opponent_score`. The fix adds a prop keyed by **`(team_id, week)`** — not by week alone, which cannot hold two teams — whose values are `{ game_id, team_score, opponent_score, result, opponent_id }`.

**`teamId` must not be used as the fetch key.** `components/player/PlayerPageContent.tsx:203` passes `teamId={player.current_team_id}` — the player's *current* team, not the viewed season's (a separate known bug). Keying off it would make A.J. Brown's 2025 Game Log look up **Patriots** games for all 17 weeks: a whole wrong season, produced by the fix meant to correct 31 games. The server fetch must cover **every distinct `team_id` present in `weeklyStats`**, and each row looks itself up by its own `team_id` and `week`.

**Alternative, not recommended now:** re-ingest 2020–2025 to correct the stored columns. Needs Jon's approval for a production write, fixes nothing extra, and is best folded into the backfill.

## 10. Player-row work (PR 2)

1. **QB rushing EPA and success rate.** `qb_weekly_stats` stores only rushing attempts/yards/TDs, so Josh Allen's 5 carries and 2 rushing TDs show "—". Add `rush_epa_per_carry` and `rush_success_rate` (NUMERIC). `ensure_qb_weekly_stats_table` (`scripts/ingest.py:2393`) is `CREATE TABLE IF NOT EXISTS` only and cannot add columns, so this needs `ALTER TABLE … ADD COLUMN IF NOT EXISTS` in the style of `ensure_qb_season_stats_columns` (`:1546-1568`), plus the new columns in `upsert_qb_weekly_stats`'s `cols` list.
2. **Target share** divides by `team_targets` from `team_game_stats` (§5) — never by a sum of stored rows.
3. **Verified non-bugs, do not "fix":**
   - Keon Coleman's second BUF–HOU target is the **failed 2-point conversion**, which official stats exclude. His weekly row's 1 target is correct. Adding 2-pt tries to targets would break `receiver_season_stats` against PFR and the frozen `__tests__/stats/fixtures/wr-te-2025-pool.json`.
   - 10 of Allen's 334 passing yards belong to no receiver: `pass short left to 0-K.Coleman … for 1 yard. Lateral to 10-K.Shakir … for 10 yards` — `passing_yards` 11, `receiving_yards` 1. Player lines will not always sum to team totals.
   - **The Rushing table cannot sum to team `rushing_attempts`, for two reasons.** WR/TE rushes (jet sweeps) appear in no weekly table — `aggregate_rb_weekly_stats` filters to RB/FB rushers (`:2257-2264`) and `qb_weekly_stats` to QBs — and `aggregate_qb_weekly_stats` deliberately drops `play_type == 'qb_kneel'` (MEMORY.md's kneel fix), while the traditional team count includes kneels. BUF's 21 attempts include one kneel. Both reasons go in the page's data note with the lateral case.

## 11. Testing

**Python (pytest):**
- made-up games covering every stored stat and the tricky cases: a 2-point try (kept in efficiency, excluded from targets and traditional counts), kneels, penalty-wiped plays, a strip-sack, a lateral, a defensive TD, a safety, a drive with no scrimmage play, a team with zero pass or zero rush attempts (synthetic only — 0 of 544 2025 team-games), and a game with no plays yet
- **golden test** on real games: efficiency rows must match rbsdm exactly (§4's BUF–HOU numbers) and traditional rows the official ESPN box score — 20/26 first downs, 409/381 yards, **52/73 total plays, 7.9/5.2 yards per play**, 3-9 / 7-16 third down, 1-3 / 4-5 red zone, **2-11 / 3-17 sacks**, 10-85 / 7-106 penalties, 0/2 turnovers, 23:43 / 36:17 possession. Every stored traditional column must appear in a golden assertion, or an error in it is invisible. Use **NO–DET** as the overtime case (TOP sums to 68:26, result derives correctly)
- **Fixture:** a committed parquet of all raw rows for 2–3 whole games (~180 rows each, ~40 columns). It must be the **complete** row set, not a pass/run extract — time of possession, drives, penalties and red zone all need kicking and `no_play` rows. `tests/` has no `conftest.py` or fixtures directory today (existing tests hand-build minimal DataFrames, e.g. 8 columns in `tests/test_situational.py`), so the plan adds one and **puts the parquet loader in `conftest.py`**, not in each test. `scripts/requirements.txt` pins pandas 2.2.3 and pyarrow 18.1.0, and nothing in `.gitignore` excludes it
- season-agnostic: the same function on a 2025 game gives sane output

**Frontend (vitest, not run by CI — run locally before merge):** each section renders from a fixture; the "stats arrive", "box scores start with 2026" and not-found states; links only on played, covered, REG games; the hook rule for every branch; the strip advancing a week; YPRR hidden without route data and shown with it; a failing protected read prevents a blank render; null EPA renders grey, not amber.

**After each merge:** compare three live box scores against rbsdm and ESPN before starting the next PR.

## 12. Risks and things visible on the page

- **Three play counts that disagree, on purpose.** For BUF–HOU the page shows efficiency plays **56/79**, total plays **52/73** (traditional), and rush plays **19** beside rushing attempts **21** — the 21 decomposing exactly as 19 + 1 kneel + 1 scramble. All three need one on-page note, not just a glossary entry, or they read as bugs.
- **Numbers differ from this site's own team pages** until the filter-unification follow-up.
- **First downs deliberately double-count** one rare play type to match ESPN (§4).
- **A strip-sack appears in two "what it cost them" rows** (§4).
- **Player lines don't sum to team totals** — laterals and WR/TE rushes (§10.3).
- **YPRR is empty for the current season.** nflverse publishes participation only after a season ends (2025's file landed 2026-02-10), so the column hides itself for 2026. No free in-season source: Next Gen Stats and FTN charting carry no routes run.
- **Playoffs and 2020–2025 have no box score** until the backfill; links are gated and direct visits get the message page.
- **The backfill is a production write** and stays Jon's call.

## 13. Follow-ups (not in this work)

Backfill 2020–2025; percentile colouring; drives, scoring summary and biggest plays; a complete per-game player table with defence and kicking; win probability and other charts; unify the site's play filters; clean up orphan `games` rows from reschedules; make `epaTextColor` null-safe; add vitest to CI; preview pages for unplayed games; playoffs.

`.claude/CLAUDE.md` also needs these edits when this ships: the "Nav labels" line gains **Scores**, "13 Supabase tables total" becomes 14 with `team_game_stats`, and any new data module (e.g. `lib/data/scores.ts`) joins the "Data fetching" list.
