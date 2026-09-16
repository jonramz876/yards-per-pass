# Box Scores PR 2 — `team_game_stats` + QB Rushing EPA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every played 2026 regular-season game gets one `team_game_stats` row per team — the nflfastR/rbsdm efficiency numbers, the official ESPN-style box score, the "what it cost them" EPA rows and the target-share denominator — written by the nightly ingest, and `qb_weekly_stats` gains the QB rushing EPA/carry and success rate the box score page needs.

**Architecture:** A new `aggregate_team_game_stats(pbp, season)` in `scripts/ingest.py` reads the **raw** play-by-play frame (kicks and `no_play` rows included, unlike every situational aggregator) and merges four per-(game, team) helper frames — efficiency, costs, traditional, targets — onto a base frame that has both teams of every game. `ensure_team_game_stats_table` / `upsert_team_game_stats` / a `game_ids` clause in `cleanup_stale_rows` mirror the existing DDL, upsert and cleanup patterns and are wired into `process_season`. `aggregate_qb_weekly_stats` computes `rush_epa_per_carry` and `rush_success_rate` over exactly the carries it already counts, and an `ALTER TABLE … ADD COLUMN IF NOT EXISTS` adds the columns. A committed 567-row parquet of three complete week-1 games drives golden tests; synthetic raw rows cover every tricky case in the spec. No frontend changes.

**Tech Stack:** Python 3.12 (CI) / 3.14 (local), pandas 2.2.3 (CI) / 3.0.1 (local), pyarrow 18.1.0 / 23, psycopg2 `execute_values`, pytest 8. GitHub Actions (`ci.yml`, `data-refresh.yml`), `gh` CLI, Supabase PostgREST for the read-only production check.

**Spec:** `docs/superpowers/specs/2026-09-15-box-scores-design.md`. PR 2 = §3 "Phase 1, PR 2". Binding: §4 (every definition and verified number), §5 (table, columns, how it runs, stale rows), §10 (player-row work, as corrected by commit 6ba8690: QB rushing EPA over designed runs **plus scrambles**), §11 "Python (pytest)", §12 risks. §6–§8 are PR 3/PR 4 — the column names here are what they will read.

## Global Constraints

- **Windows + Git Bash.** One command per Bash call. Never chain with `&&` or `||`. Agent shells reset the working directory, so every command uses an absolute, quoted path. The repo is `C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass` (the path has spaces).
- **Two pandas lines must both pass.** Local: `py -3` = Python 3.14, pandas 3.0.1, pyarrow 23. CI (`test-python` job): Python 3.12 with `scripts/requirements.txt` pins pandas 2.2.3, pyarrow 18.1.0. Only Python 3.14 is installed locally, so **CI is the pandas-2 gate** — write for both: no pandas-3-only APIs, no chained assignment (`df[mask]['col'] = …`), never assume string columns are the `str` dtype (compare with `==`, `.isin()`, `.notna()`), no `groupby.apply`. A column that must hold `None` is built as a `pd.Series(..., dtype=object)` — a plain list of floats and `None` becomes float64 with NaN.
- **pytest:** always `PYTHONDONTWRITEBYTECODE=1 py -3 -m pytest "<repo>/tests…" -q -p no:cacheprovider`. Never stage `__pycache__` (it is gitignored; `git add` files by name).
- **Never** use `DATABASE_URL`, never connect to the production database from this machine, never print or write a secret. `.env.local` holds the site's anon key; the Task 10 script reads it and prints nothing but row counts and stat values.
- **NULL, never NaN, in every stored numeric column** (repo convention, MEMORY.md "Stored NaN instead of NULL" debt). Which `team_game_stats` columns can be NULL: the 17 rate columns in `TEAM_GAME_STATS_RATE_COLS` (`epa_per_play`, `success_rate`, `first_down_rate`, the pass/rush/early/late variants, `explosive_rate`, `yards_per_play`, `yards_per_pass`, `yards_per_rush`) when their denominator is 0, and `time_of_possession_seconds` when a team has drives but nflverse gave none a clock. Every count and yard total is 0 when a team had none; the three `epa_lost_*` sums are 0.0. On `qb_weekly_stats`, `rush_epa_per_carry` / `rush_success_rate` are NULL for a game with no carries.
- **Match `scripts/ingest.py`'s patterns; do not refactor anything you were not asked to touch.** The file is CRLF in the working tree (`core.autocrlf=true`); the Edit tool matches on content, so anchor every edit on the exact text this plan quotes. Line numbers in this plan are as of `main` @ 5277094 (before any task) and are orientation only — later tasks shift them.
- **Spec §4 is the definition of every number.** Three places this plan goes beyond its literal text, each documented in code and tests, none changing a verified number: (1) `def_st_tds` adds `kickoff_attempt == 1` to the `td_team == team and posteam != team` rule, because nflverse puts the **receiving** team in `posteam` on kickoffs (164 of 171 week-1 kickoff rows), so a kickoff-return TD would otherwise be missed; (2) `qb_spike` counts as a snap from scrimmage for 3rd/4th-down attempts and red-zone trips (0 spikes in BUF–HOU, so the golden numbers are unchanged); (3) turnovers stay keyed by `posteam` exactly as §4 says, so a punt the **receiving** team muffs (`2026_01_CHI_CAR`) is credited to nobody — recorded as a strict `xfail` test, not "fixed".
- **Fixture rules (spec §11):** the parquet holds every raw row of its games (kicks, `no_play`, timeouts) but only the 51 columns the new code reads; it is cut by the deterministic script in Task 1, carries no pandas metadata, and is committed, so no test ever depends on a scratch file. Nothing committed references any session scratchpad path.
- **Quality gates:** chaos test (Task 7) before code review (Task 8); fix every CRASH/ERROR first. Docs/memory task (Task 9) before shipping.
- **Ship:** branch `box-scores-pr2` (it already exists — this plan's commit is on it), one PR to `main`, CI polled with a background until-loop over `gh pr checks … --json bucket` (never `--watch`), `gh pr merge <n> --merge` once green, then `gh workflow run data-refresh.yml`, wait for it, read its log, verify with read-only REST GETs (Task 10).
- **Commits:** stage files by name; end every commit message with `Co-Authored-By: Claude <noreply@anthropic.com>` (if your session's attribution reminder names a specific model, use that line instead).

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `tests/fixtures/pbp_2026_week1_games.parquet` | Create (Task 1) | 567 raw rows × 51 columns: `2026_01_BUF_HOU` (golden), `2026_01_NO_DET` (overtime), `2026_01_TB_CIN` (defensive TDs, 4 turnovers) |
| `tests/conftest.py` | Create (Task 1) | Fixture loader (`pbp_fixture`, `team_game_rows`), `RawPlays` synthetic-row builders (`raw` fixture), `team_game_row()` helper, `RAW_PBP_COLUMNS` |
| `tests/test_team_game_stats.py` | Create (Task 1), extend (Tasks 2, 3) | Fixture integrity; golden BUF–HOU / NO–DET / TB–CIN; every synthetic case in spec §11 |
| `scripts/ingest.py` | Modify (Tasks 2, 4, 5) | `REQUIRED_PBP_COLS`; new `team_game_stats` section (constants, helpers, `aggregate_team_game_stats`, `ensure_team_game_stats_table`, `upsert_team_game_stats`) between `ingest_schedules` and `cleanup_stale_rows`; `cleanup_stale_rows(game_ids=)`; `process_season` wiring; `aggregate_qb_weekly_stats` rushing EPA/SR; `ensure_qb_weekly_stats_columns`; `upsert_qb_weekly_stats` cols |
| `tests/test_team_game_stats_pipeline.py` | Create (Task 4) | DDL, upsert row typing, cleanup guard, `process_season` wiring (the slug-bug guard) |
| `tests/test_qb_rushing_epa.py` | Create (Task 5) | Synthetic one-run-one-scramble QB, Allen/Stroud from the fixture, ALTER TABLE, upsert NULLs |
| `tests/test_team_game_stats_smoke.py` | Create (Task 6) | Whole-file smoke check, skipped unless `YPP_PBP_PARQUET` is set |
| `memory/MEMORY.md`, `.claude/CLAUDE.md` | Modify (Task 9) | New memory section; "13 Supabase tables total" → 14 with `team_game_stats` |

Out of scope: any `app/`, `components/`, `lib/` change (PR 3 adds the TypeScript types and page); `scripts/schema.sql` (the original 4-table bootstrap file; every later table is created by an `ensure_*` function, and this one is too); rewriting the 31 wrong stored weekly scores (backfill, spec §9).

---

### Task 1: Fixture parquet, `conftest.py`, fixture-integrity tests

**Files:**
- Create: `tests/fixtures/pbp_2026_week1_games.parquet` (cut by a scratch script, then committed)
- Create: `tests/conftest.py`
- Create: `tests/test_team_game_stats.py` (fixture-integrity tests only; Tasks 2 and 3 append to it)
- Scratch (not committed): `<your scratchpad>/extract_fixture.py`

**Interfaces:**
- Consumes: nothing from the repo (the aggregator does not exist yet; `team_game_rows` imports it lazily, inside the fixture body, so it is only needed once Task 2's tests use it).
- Produces, in `tests/conftest.py`: `FIXTURE_PATH: str`, `FIXTURE_GAMES: list[str]`, `RAW_PBP_COLUMNS: list[str]` (the 51 fixture columns), `NAN`, class `RawPlays` with static builders `play(**overrides)`, `rush(yards=4.0, **overrides)`, `scramble(yards=7.0, **overrides)`, `kneel(**overrides)`, `sack(yards_lost=7.0, **overrides)`, `no_play(**overrides)`, `kick(play_type='kickoff', **overrides)`, `game(*frames) -> pd.DataFrame`; pytest fixtures `raw` (→ `RawPlays`), `pbp_fixture` (session, the 567-row frame), `team_game_rows` (session, `aggregate_team_game_stats(pbp_fixture, 2026)`); helper `team_game_row(rows, game_id, team_id) -> pd.Series`.

- [ ] **Step 1: Confirm the branch**

```bash
git -C "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" status --short --branch
```

Expected: `## box-scores-pr2` (the plan commit is already on it) and nothing else. If you are on another branch: `git -C "<repo>" switch box-scores-pr2`. Then make sure `main` has not moved:

```bash
git -C "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" fetch origin
```

```bash
git -C "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" merge-base --is-ancestor origin/main box-scores-pr2
```

Expected: exit code 0. If it exits 1, rebase: `git -C "<repo>" rebase origin/main` (the branch holds only this plan, so there is nothing to conflict).

- [ ] **Step 2: Find a full-column 2026 play-by-play file**

The fixture is cut from nflverse's `play_by_play_2026.parquet`. Read `.superpowers/sdd/pr2-plan-brief.md` (gitignored, in the repo) — its "Data sources" section names a local copy of the week-1 file from the spec-review session. If that file still exists, use it as `<source>`. Otherwise download the current release into your scratchpad:

```bash
curl -L -o "<your scratchpad>/play_by_play_2026.parquet" https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_2026.parquet
```

Either way `<source>` is a scratch path: it goes on the command line only, never into a committed file.

- [ ] **Step 3: Write the extraction script to your scratchpad**

Save exactly this as `<your scratchpad>/extract_fixture.py`:

```python
"""Extract the box-score pytest fixture from a full nflverse play-by-play parquet.

Usage:  py -3 extract_fixture.py <source play_by_play parquet> <destination parquet>

Keeps EVERY raw row of the chosen games (kicks, no_play, timeouts included)
but only the columns the box-score code reads. Rows are sorted by
(game_id, play_id) and the pandas schema metadata is dropped, so the file
reads the same way on pandas 2.2.3 (CI) and pandas 3 (local) — exactly like
the real nflverse release file, which has no pandas metadata either.
"""
import sys

import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.parquet as pq

# 2026_01_BUF_HOU: the golden game (rbsdm + ESPN verified).
# 2026_01_NO_DET:  the overtime game (possession sums to 68:26).
# 2026_01_TB_CIN:  one defensive TD per team, TB's 4 turnovers, a strip-sack.
GAMES = ['2026_01_BUF_HOU', '2026_01_NO_DET', '2026_01_TB_CIN']

COLUMNS = [
    # identity and context
    'game_id', 'season', 'season_type', 'week', 'home_team', 'away_team',
    'posteam', 'defteam', 'play_id', 'drive', 'play_type', 'down', 'yardline_100',
    'total_home_score', 'total_away_score',
    # play flags
    'pass', 'rush', 'pass_attempt', 'rush_attempt', 'qb_dropback', 'qb_scramble',
    'sack', 'complete_pass', 'two_point_attempt', 'kickoff_attempt',
    'first_down', 'first_down_pass', 'first_down_rush', 'first_down_penalty',
    # outcomes
    'epa', 'success', 'cpoe', 'yards_gained', 'passing_yards', 'rushing_yards', 'air_yards',
    'pass_touchdown', 'rush_touchdown', 'td_team',
    'interception', 'fumble', 'fumble_lost', 'fumbled_1_team', 'fumbled_1_player_id',
    'penalty', 'penalty_team', 'penalty_yards',
    'drive_time_of_possession',
    # players
    'passer_player_id', 'rusher_player_id', 'receiver_player_id',
]


def main(src: str, dst: str) -> None:
    table = pq.read_table(src, columns=COLUMNS)
    table = table.filter(pc.is_in(table['game_id'], value_set=pa.array(GAMES)))
    order = pc.sort_indices(table, sort_keys=[('game_id', 'ascending'), ('play_id', 'ascending')])
    table = table.take(order).replace_schema_metadata(None)
    pq.write_table(table, dst, compression='snappy')
    counts = pc.value_counts(table['game_id'])
    print(f'{table.num_rows} rows, {table.num_columns} columns -> {dst}')
    for entry in counts.to_pylist():
        print(f"  {entry['values']}: {entry['counts']} rows")


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
```

- [ ] **Step 4: Cut the fixture**

```bash
mkdir -p "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass/tests/fixtures"
```

```bash
py -3 "<your scratchpad>/extract_fixture.py" "<source>" "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass/tests/fixtures/pbp_2026_week1_games.parquet"
```

Expected output (game order may vary):

```text
567 rows, 51 columns -> …/tests/fixtures/pbp_2026_week1_games.parquet
  2026_01_BUF_HOU: 180 rows
  2026_01_NO_DET: 218 rows
  2026_01_TB_CIN: 169 rows
```

The file is about 33 KB. **If the counts differ**, nflverse has revised week 1 since 2026-09-15 and the golden numbers in Task 2 may no longer hold: stop and report the new counts instead of continuing.

- [ ] **Step 5: Create `tests/conftest.py`**

```python
"""Shared fixtures for the box-score (team_game_stats) tests — box score spec §11.

tests/fixtures/pbp_2026_week1_games.parquet holds EVERY raw row (kicks,
no_play, timeouts included) of three 2026 week-1 games, but only the columns
the box-score code reads. It was cut from nflverse's play_by_play_2026.parquet
by the extraction script in
docs/superpowers/plans/2026-09-16-box-scores-pr2-team-game-stats.md (Task 1)
and carries no pandas metadata, so pandas 2.2.3 (CI) and pandas 3 (local) read
it the same way they read the real release file.
"""
import os
import sys

import pandas as pd
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripts'))

FIXTURE_PATH = os.path.join(os.path.dirname(__file__), 'fixtures', 'pbp_2026_week1_games.parquet')

# 2026_01_BUF_HOU: golden game (rbsdm + ESPN verified). 2026_01_NO_DET: overtime
# (possession sums to 68:26). 2026_01_TB_CIN: a defensive TD each way, TB's 4 turnovers.
FIXTURE_GAMES = ['2026_01_BUF_HOU', '2026_01_NO_DET', '2026_01_TB_CIN']

# Every column in the fixture = every raw column the box-score code reads.
RAW_PBP_COLUMNS = [
    # identity and context
    'game_id', 'season', 'season_type', 'week', 'home_team', 'away_team',
    'posteam', 'defteam', 'play_id', 'drive', 'play_type', 'down', 'yardline_100',
    'total_home_score', 'total_away_score',
    # play flags
    'pass', 'rush', 'pass_attempt', 'rush_attempt', 'qb_dropback', 'qb_scramble',
    'sack', 'complete_pass', 'two_point_attempt', 'kickoff_attempt',
    'first_down', 'first_down_pass', 'first_down_rush', 'first_down_penalty',
    # outcomes
    'epa', 'success', 'cpoe', 'yards_gained', 'passing_yards', 'rushing_yards', 'air_yards',
    'pass_touchdown', 'rush_touchdown', 'td_team',
    'interception', 'fumble', 'fumble_lost', 'fumbled_1_team', 'fumbled_1_player_id',
    'penalty', 'penalty_team', 'penalty_yards',
    'drive_time_of_possession',
    # players
    'passer_player_id', 'rusher_player_id', 'receiver_player_id',
]

NAN = float('nan')

# A completed 8-yard pass by the away team (KC at BUF), 1st & 10 from the KC 25.
# Numeric blanks are NaN (never None) so comparisons like yards_gained >= 20 work.
_RAW_PLAY_DEFAULTS = {
    'game_id': '2026_01_KC_BUF', 'season': 2026, 'season_type': 'REG', 'week': 1,
    'home_team': 'BUF', 'away_team': 'KC', 'posteam': 'KC', 'defteam': 'BUF',
    'play_id': 1.0, 'drive': 1.0, 'play_type': 'pass', 'down': 1.0, 'yardline_100': 75.0,
    'total_home_score': 20.0, 'total_away_score': 27.0,
    'pass': 1.0, 'rush': 0.0, 'pass_attempt': 1.0, 'rush_attempt': 0.0, 'qb_dropback': 1.0,
    'qb_scramble': 0.0, 'sack': 0.0, 'complete_pass': 1.0, 'two_point_attempt': 0.0,
    'kickoff_attempt': 0.0,
    'first_down': 0.0, 'first_down_pass': 0.0, 'first_down_rush': 0.0, 'first_down_penalty': 0.0,
    'epa': 0.5, 'success': 1.0, 'cpoe': 3.0, 'yards_gained': 8.0, 'passing_yards': 8.0,
    'rushing_yards': NAN, 'air_yards': 6.0,
    'pass_touchdown': 0.0, 'rush_touchdown': 0.0, 'td_team': None,
    'interception': 0.0, 'fumble': 0.0, 'fumble_lost': 0.0, 'fumbled_1_team': None,
    'fumbled_1_player_id': None,
    'penalty': 0.0, 'penalty_team': None, 'penalty_yards': NAN,
    'drive_time_of_possession': '2:30',
    'passer_player_id': 'QB1', 'rusher_player_id': None, 'receiver_player_id': 'WR1',
}


class RawPlays:
    """Builders for synthetic RAW play-by-play rows, each a one-row DataFrame
    flagged the way nflverse flags that play type. `pass` is a Python keyword,
    so override it with **{'pass': 0.0} when a test needs to."""

    @staticmethod
    def play(**overrides) -> pd.DataFrame:
        """A completed pass (see _RAW_PLAY_DEFAULTS)."""
        row = dict(_RAW_PLAY_DEFAULTS)
        row.update(overrides)
        return pd.DataFrame([row], columns=RAW_PBP_COLUMNS)

    @staticmethod
    def rush(yards=4.0, **overrides) -> pd.DataFrame:
        """A designed run by RB1 for `yards`."""
        row = {'play_type': 'run', 'pass': 0.0, 'rush': 1.0, 'pass_attempt': 0.0, 'rush_attempt': 1.0,
               'qb_dropback': 0.0, 'complete_pass': 0.0, 'passing_yards': NAN,
               'rushing_yards': float(yards), 'yards_gained': float(yards), 'air_yards': NAN, 'cpoe': NAN,
               'passer_player_id': None, 'rusher_player_id': 'RB1', 'receiver_player_id': None}
        row.update(overrides)
        return RawPlays.play(**row)

    @staticmethod
    def scramble(yards=7.0, **overrides) -> pd.DataFrame:
        """A QB1 scramble: a pass play for EPA (pass = 1, rush = 0) and a rush attempt."""
        row = {'play_type': 'run', 'pass': 1.0, 'rush': 0.0, 'pass_attempt': 0.0, 'rush_attempt': 1.0,
               'qb_dropback': 1.0, 'qb_scramble': 1.0, 'complete_pass': 0.0, 'passing_yards': NAN,
               'rushing_yards': float(yards), 'yards_gained': float(yards), 'air_yards': NAN, 'cpoe': NAN,
               'passer_player_id': None, 'rusher_player_id': 'QB1', 'receiver_player_id': None}
        row.update(overrides)
        return RawPlays.play(**row)

    @staticmethod
    def kneel(**overrides) -> pd.DataFrame:
        """A victory-formation kneel by QB1: pass = rush = 0, but a rush attempt."""
        row = {'play_type': 'qb_kneel', 'pass': 0.0, 'rush': 0.0, 'pass_attempt': 0.0, 'rush_attempt': 1.0,
               'qb_dropback': 0.0, 'complete_pass': 0.0, 'passing_yards': NAN, 'rushing_yards': -1.0,
               'yards_gained': -1.0, 'epa': -0.9, 'success': 0.0, 'air_yards': NAN, 'cpoe': NAN,
               'passer_player_id': None, 'rusher_player_id': 'QB1', 'receiver_player_id': None}
        row.update(overrides)
        return RawPlays.play(**row)

    @staticmethod
    def sack(yards_lost=7.0, **overrides) -> pd.DataFrame:
        """QB1 sacked for `yards_lost`: pass_attempt = 1 AND sack = 1, yards_gained negative."""
        row = {'sack': 1.0, 'complete_pass': 0.0, 'passing_yards': NAN, 'yards_gained': -float(yards_lost),
               'epa': -1.5, 'success': 0.0, 'air_yards': NAN, 'cpoe': NAN, 'receiver_player_id': None}
        row.update(overrides)
        return RawPlays.play(**row)

    @staticmethod
    def no_play(**overrides) -> pd.DataFrame:
        """A pre-snap penalty on the offence (false start): no attempt, no yards, EPA present."""
        row = {'play_type': 'no_play', 'pass': 0.0, 'rush': 0.0, 'pass_attempt': 0.0, 'rush_attempt': 0.0,
               'qb_dropback': 0.0, 'complete_pass': 0.0, 'yards_gained': 0.0, 'passing_yards': NAN,
               'epa': -0.6, 'success': 0.0, 'air_yards': NAN, 'cpoe': NAN,
               'penalty': 1.0, 'penalty_team': 'KC', 'penalty_yards': 5.0,
               'passer_player_id': None, 'rusher_player_id': None, 'receiver_player_id': None}
        row.update(overrides)
        return RawPlays.play(**row)

    @staticmethod
    def kick(play_type='kickoff', **overrides) -> pd.DataFrame:
        """A kicking row. On a kickoff nflverse's posteam is the RECEIVING team."""
        row = {'play_type': play_type, 'pass': 0.0, 'rush': 0.0, 'pass_attempt': 0.0, 'rush_attempt': 0.0,
               'qb_dropback': 0.0, 'complete_pass': 0.0, 'down': NAN if play_type in ('kickoff', 'extra_point') else 4.0,
               'yards_gained': 0.0, 'passing_yards': NAN, 'epa': 0.1, 'success': 1.0, 'air_yards': NAN, 'cpoe': NAN,
               'kickoff_attempt': 1.0 if play_type == 'kickoff' else 0.0,
               'passer_player_id': None, 'rusher_player_id': None, 'receiver_player_id': None}
        row.update(overrides)
        return RawPlays.play(**row)

    @staticmethod
    def game(*frames) -> pd.DataFrame:
        """Stack one-row frames into a raw play-by-play frame."""
        return pd.concat(frames, ignore_index=True)


@pytest.fixture
def raw() -> RawPlays:
    return RawPlays


@pytest.fixture(scope='session')
def pbp_fixture() -> pd.DataFrame:
    """All raw rows of the three fixture games (read once per session)."""
    return pd.read_parquet(FIXTURE_PATH)


@pytest.fixture(scope='session')
def team_game_rows(pbp_fixture) -> pd.DataFrame:
    """aggregate_team_game_stats over the whole fixture: 6 rows, 3 games."""
    from ingest import aggregate_team_game_stats
    return aggregate_team_game_stats(pbp_fixture, 2026)


def team_game_row(rows: pd.DataFrame, game_id: str, team_id: str) -> pd.Series:
    """The single team_game_stats row for (game_id, team_id)."""
    sub = rows[(rows['game_id'] == game_id) & (rows['team_id'] == team_id)]
    assert len(sub) == 1, f"expected exactly one row for {game_id} {team_id}, got {len(sub)}"
    return sub.iloc[0]
```

- [ ] **Step 6: Create `tests/test_team_game_stats.py` with the fixture-integrity tests**

The imports cover Tasks 2 and 3, which append to this file.

```python
"""Tests for aggregate_team_game_stats — box score spec §4 (definitions), §5
(table), §11 (golden game + tricky cases)."""
import math

import pandas as pd
import pytest
from pytest import approx

from conftest import FIXTURE_GAMES, RAW_PBP_COLUMNS, team_game_row

BUF_HOU = '2026_01_BUF_HOU'
NO_DET = '2026_01_NO_DET'
TB_CIN = '2026_01_TB_CIN'

KEY_COLS = ['game_id', 'team_id', 'season', 'week', 'opponent_id', 'home_away']


# ---------------------------------------------------------------------------
# Fixture integrity
# ---------------------------------------------------------------------------

class TestFixture:
    def test_has_every_raw_row_of_the_three_games(self, pbp_fixture):
        counts = pbp_fixture['game_id'].value_counts().to_dict()
        assert counts == {BUF_HOU: 180, NO_DET: 218, TB_CIN: 169}
        assert sorted(counts) == sorted(FIXTURE_GAMES)

    def test_keeps_kicks_and_penalty_rows(self, pbp_fixture):
        """Possession, drives, penalties and red zone need the rows filter_plays drops."""
        kinds = pbp_fixture['play_type'].value_counts()
        for play_type in ('kickoff', 'punt', 'extra_point', 'field_goal', 'no_play', 'qb_kneel'):
            assert kinds.get(play_type, 0) > 0, play_type
        assert pbp_fixture['play_type'].isna().sum() > 0  # game start / end rows

    def test_columns_are_exactly_the_ones_the_code_reads(self, pbp_fixture):
        assert list(pbp_fixture.columns) == RAW_PBP_COLUMNS
        assert (pbp_fixture['season_type'] == 'REG').all()
        assert (pbp_fixture['week'] == 1).all()
```

- [ ] **Step 7: Run the new file**

```bash
PYTHONDONTWRITEBYTECODE=1 py -3 -m pytest "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass/tests/test_team_game_stats.py" -q -p no:cacheprovider
```

Expected: `3 passed`.

- [ ] **Step 8: Run the whole Python suite (the new conftest must not disturb the existing 262 tests)**

```bash
PYTHONDONTWRITEBYTECODE=1 py -3 -m pytest "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass/tests" -q -p no:cacheprovider
```

Expected: `265 passed`.

- [ ] **Step 9: Commit**

```bash
git -C "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" add tests/fixtures/pbp_2026_week1_games.parquet tests/conftest.py tests/test_team_game_stats.py
```

```bash
git -C "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" commit -m "test: raw play-by-play fixture and builders for the box score tests" -m "Three complete 2026 week-1 games (BUF-HOU golden, NO-DET overtime, TB-CIN defensive TDs), every raw row but only the 51 columns the box-score code reads, no pandas metadata. conftest.py loads it and builds synthetic raw rows flagged the way nflverse flags them (box score spec section 11)." -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: `aggregate_team_game_stats` — every column, proven by the golden game

**Files:**
- Modify: `scripts/ingest.py` — `REQUIRED_PBP_COLS` (lines 87–99 on main); new section inserted between the end of `ingest_schedules` (line 3258, `log.info("Upserted %d schedule rows for %d", …)`) and `def cleanup_stale_rows(` (line 3261)
- Test: `tests/test_team_game_stats.py` (append the golden tests)

**Interfaces:**
- Consumes: `tests/conftest.py` from Task 1 (`pbp_fixture`, `team_game_rows`, `team_game_row`, `FIXTURE_GAMES`).
- Produces (all module-level in `scripts/ingest.py`): `TEAM_GAME_STATS_COLS: list[str]` (the 62 stored columns, in table order), `TEAM_GAME_STATS_INT_COLS`, `TEAM_GAME_STATS_SUM_COLS`, `TEAM_GAME_STATS_RATE_COLS`, `_SCRIMMAGE_PLAY_TYPES`, `aggregate_team_game_stats(pbp: pd.DataFrame, season: int) -> pd.DataFrame` (one row per team per REG game, columns exactly `TEAM_GAME_STATS_COLS`, sorted by `game_id` then away/home; empty frame with those columns when there are no REG rows), and private helpers `_ratio(frame, num, den) -> pd.Series`, `_top_seconds(value) -> int | None`, `_team_game_frame(reg)`, `_team_game_efficiency(reg)`, `_team_game_costs(reg)`, `_team_game_traditional(reg)`, `_team_game_targets(reg)`, each returning a frame keyed by `game_id`, `team_id`. Task 4 appends `ensure_team_game_stats_table` and `upsert_team_game_stats` right after `aggregate_team_game_stats` and wires it into `process_season`.

- [ ] **Step 1: Append the failing golden tests**

Append to the end of `tests/test_team_game_stats.py`:

```python


# ---------------------------------------------------------------------------
# Golden: 2026_01_BUF_HOU — efficiency vs rbsdm, traditional vs ESPN (spec §4)
# ---------------------------------------------------------------------------

def _eff(plays, epa, succ, fd):
    return {'plays': plays, 'epa_per_play': approx(epa, abs=5e-5),
            'success_rate': approx(succ, abs=5e-5), 'first_down_rate': approx(fd, abs=5e-5)}


GOLD = {
    'BUF': {
        **_eff(56, 0.2780, 0.4107, 0.3571),
        **{f'pass_{k}': v for k, v in _eff(37, 0.5557, 0.4595, 0.4324).items()},
        **{f'rush_{k}': v for k, v in _eff(19, -0.2628, 0.3158, 0.2105).items()},
        'early_plays': 45, 'early_epa_per_play': approx(0.3013, abs=5e-5), 'early_success_rate': approx(0.4222, abs=5e-5),
        'late_plays': 10, 'late_epa_per_play': approx(0.2955, abs=5e-5), 'late_success_rate': approx(0.4000, abs=5e-5),
        'explosive_plays': 8, 'explosive_pass': 5, 'explosive_rush': 3, 'explosive_rate': approx(8 / 56, abs=1e-9),
        'epa_lost_turnovers': approx(0.00, abs=0.005), 'epa_lost_sacks': approx(-3.27, abs=0.005),
        'epa_lost_penalties': approx(-8.52, abs=0.005),
        'first_downs': 20, 'first_downs_pass': 13, 'first_downs_rush': 5, 'first_downs_penalty': 2,
        'third_down_att': 9, 'third_down_conv': 3, 'fourth_down_att': 1, 'fourth_down_conv': 0,
        'total_plays': 52, 'total_yards': 409, 'total_drives': 12, 'yards_per_play': approx(7.9, abs=0.05),
        'net_passing_yards': 323, 'completions': 20, 'attempts': 29, 'yards_per_pass': approx(10.4, abs=0.05),
        'interceptions': 0, 'sacks': 2, 'sack_yards': 11,
        'rushing_yards': 86, 'rushing_attempts': 21, 'yards_per_rush': approx(4.1, abs=0.05),
        'red_zone_trips': 3, 'red_zone_tds': 1, 'penalties': 10, 'penalty_yards': 85,
        'turnovers': 0, 'fumbles_lost': 0, 'def_st_tds': 0, 'time_of_possession_seconds': 23 * 60 + 43,
        'team_targets': 28,
    },
    'HOU': {
        **_eff(79, 0.0713, 0.4810, 0.3165),
        **{f'pass_{k}': v for k, v in _eff(48, 0.0977, 0.5208, 0.3333).items()},
        **{f'rush_{k}': v for k, v in _eff(31, 0.0303, 0.4194, 0.2903).items()},
        'early_plays': 59, 'early_epa_per_play': approx(0.1003, abs=5e-5), 'early_success_rate': approx(0.4746, abs=5e-5),
        'late_plays': 20, 'late_epa_per_play': approx(-0.0144, abs=5e-5), 'late_success_rate': approx(0.5000, abs=5e-5),
        'explosive_plays': 8, 'explosive_pass': 4, 'explosive_rush': 4, 'explosive_rate': approx(8 / 79, abs=1e-9),
        'epa_lost_turnovers': approx(-7.00, abs=0.005), 'epa_lost_sacks': approx(-8.66, abs=0.005),
        'epa_lost_penalties': approx(-9.69, abs=0.005),
        'first_downs': 26, 'first_downs_pass': 11, 'first_downs_rush': 10, 'first_downs_penalty': 5,
        'third_down_att': 16, 'third_down_conv': 7, 'fourth_down_att': 2, 'fourth_down_conv': 2,
        'total_plays': 73, 'total_yards': 381, 'total_drives': 11, 'yards_per_play': approx(5.2, abs=0.05),
        'net_passing_yards': 257, 'completions': 26, 'attempts': 38, 'yards_per_pass': approx(6.3, abs=0.05),
        'interceptions': 0, 'sacks': 3, 'sack_yards': 17,
        'rushing_yards': 124, 'rushing_attempts': 32, 'yards_per_rush': approx(3.9, abs=0.05),
        'red_zone_trips': 5, 'red_zone_tds': 4, 'penalties': 7, 'penalty_yards': 106,
        'turnovers': 2, 'fumbles_lost': 2, 'def_st_tds': 0, 'time_of_possession_seconds': 36 * 60 + 17,
        'team_targets': 37,
    },
}


class TestGoldenBufHou:
    def test_every_stored_column_has_a_golden_value(self):
        """An error in a column without an assertion would be invisible (spec §11)."""
        from ingest import TEAM_GAME_STATS_COLS
        assert set(GOLD['BUF']) == set(TEAM_GAME_STATS_COLS) - set(KEY_COLS)
        assert set(GOLD['HOU']) == set(GOLD['BUF'])

    @pytest.mark.parametrize('team', ['BUF', 'HOU'])
    @pytest.mark.parametrize('column', sorted(GOLD['BUF']))
    def test_golden(self, team_game_rows, team, column):
        row = team_game_row(team_game_rows, BUF_HOU, team)
        assert row[column] == GOLD[team][column], f"{team}.{column}"

    def test_keys(self, team_game_rows):
        buf = team_game_row(team_game_rows, BUF_HOU, 'BUF')
        hou = team_game_row(team_game_rows, BUF_HOU, 'HOU')
        assert (buf['season'], buf['week'], buf['opponent_id'], buf['home_away']) == (2026, 1, 'HOU', 'away')
        assert (hou['season'], hou['week'], hou['opponent_id'], hou['home_away']) == (2026, 1, 'BUF', 'home')

    def test_three_play_counts_disagree_on_purpose(self, team_game_rows):
        """Efficiency plays 56, total plays 52, rush plays 19 beside 21 attempts (spec §12)."""
        buf = team_game_row(team_game_rows, BUF_HOU, 'BUF')
        assert (buf['plays'], buf['total_plays'], buf['rush_plays'], buf['rushing_attempts']) == (56, 52, 19, 21)

    def test_the_wrong_penalty_formulas_are_not_what_we_store(self, team_game_rows):
        """Summing every flag in the game gives BUF +1.17; skipping the sign flip +2.39 (spec §4)."""
        buf = team_game_row(team_game_rows, BUF_HOU, 'BUF')
        assert buf['epa_lost_penalties'] != approx(1.17, abs=0.05)
        assert buf['epa_lost_penalties'] != approx(2.39, abs=0.05)

    def test_possession_sums_to_sixty_minutes(self, team_game_rows):
        rows = team_game_rows[team_game_rows['game_id'] == BUF_HOU]
        assert rows['time_of_possession_seconds'].sum() == 3600

    def test_early_plus_late_is_one_short_for_buf(self, team_game_rows):
        """BUF's failed 2-point pass is in the efficiency set but has no down (spec §4)."""
        buf = team_game_row(team_game_rows, BUF_HOU, 'BUF')
        hou = team_game_row(team_game_rows, BUF_HOU, 'HOU')
        assert buf['early_plays'] + buf['late_plays'] == buf['plays'] - 1
        assert hou['early_plays'] + hou['late_plays'] == hou['plays']


class TestGoldenOtherGames:
    def test_overtime_possession_sums_to_68_26(self, team_game_rows):
        rows = team_game_rows[team_game_rows['game_id'] == NO_DET]
        assert len(rows) == 2
        assert rows['time_of_possession_seconds'].sum() == 68 * 60 + 26

    def test_defensive_touchdowns_and_turnovers_tb_cin(self, team_game_rows):
        """A pick-six each way; TB turned it over 4 times, CIN once (spec §8's +3 margin)."""
        tb = team_game_row(team_game_rows, TB_CIN, 'TB')
        cin = team_game_row(team_game_rows, TB_CIN, 'CIN')
        assert (tb['def_st_tds'], cin['def_st_tds']) == (1, 1)
        assert (tb['turnovers'], cin['turnovers']) == (4, 1)
        assert (tb['home_away'], cin['home_away']) == ('away', 'home')

    def test_output_shape(self, team_game_rows):
        from ingest import TEAM_GAME_STATS_COLS
        assert list(team_game_rows.columns) == TEAM_GAME_STATS_COLS
        assert len(team_game_rows) == 6
        assert team_game_rows.groupby('game_id').size().to_dict() == {g: 2 for g in FIXTURE_GAMES}
        assert not team_game_rows.isna().any().any()
```

- [ ] **Step 2: Run the file to see the golden tests fail**

```bash
PYTHONDONTWRITEBYTECODE=1 py -3 -m pytest "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass/tests/test_team_game_stats.py" -q -p no:cacheprovider
```

Expected: the 3 `TestFixture` tests pass; every golden test fails or errors with `ImportError: cannot import name 'aggregate_team_game_stats' from 'ingest'` (the `team_game_rows` fixture) or `cannot import name 'TEAM_GAME_STATS_COLS'`.

- [ ] **Step 3: Require the columns the new code reads**

In `scripts/ingest.py`, `REQUIRED_PBP_COLS` ends with:

```python
    'total_home_score', 'total_away_score',
]
```

Change that to:

```python
    'total_home_score', 'total_away_score',
    # box scores (team_game_stats): read from RAW rows, so they must exist
    'pass', 'rush', 'first_down', 'first_down_pass', 'first_down_rush', 'first_down_penalty',
    'down', 'drive', 'yardline_100', 'td_team', 'kickoff_attempt',
    'penalty', 'penalty_team', 'penalty_yards', 'fumbled_1_team',
    'drive_time_of_possession',
]
```

- [ ] **Step 4: Insert the `team_game_stats` section**

`ingest_schedules` ends with the line `    log.info("Upserted %d schedule rows for %d", len(rows), season)`, followed by two blank lines and `def cleanup_stale_rows(conn, season: int, team_ids: list, player_ids: list, …`. Insert the following block between them (keep two blank lines on each side):

```python
# --- team_game_stats: one row per team per game (box score spec §4/§5) ---

# Play types that are a snap from scrimmage. no_play (penalty-wiped) rows,
# kicks and timeouts are not.
_SCRIMMAGE_PLAY_TYPES = ('pass', 'run', 'qb_kneel', 'qb_spike')

TEAM_GAME_STATS_COLS = [
    'game_id', 'team_id', 'season', 'week', 'opponent_id', 'home_away',
    # efficiency (nflfastR / rbsdm play set)
    'plays', 'epa_per_play', 'success_rate', 'first_down_rate',
    'pass_plays', 'pass_epa_per_play', 'pass_success_rate', 'pass_first_down_rate',
    'rush_plays', 'rush_epa_per_play', 'rush_success_rate', 'rush_first_down_rate',
    'early_plays', 'early_epa_per_play', 'early_success_rate',
    'late_plays', 'late_epa_per_play', 'late_success_rate',
    'explosive_plays', 'explosive_rate', 'explosive_pass', 'explosive_rush',
    # what it cost them
    'epa_lost_turnovers', 'epa_lost_sacks', 'epa_lost_penalties',
    # traditional (official box-score conventions)
    'first_downs', 'first_downs_pass', 'first_downs_rush', 'first_downs_penalty',
    'third_down_att', 'third_down_conv', 'fourth_down_att', 'fourth_down_conv',
    'total_plays', 'total_yards', 'total_drives', 'yards_per_play',
    'net_passing_yards', 'completions', 'attempts', 'yards_per_pass',
    'interceptions', 'sacks', 'sack_yards',
    'rushing_yards', 'rushing_attempts', 'yards_per_rush',
    'red_zone_trips', 'red_zone_tds', 'penalties', 'penalty_yards',
    'turnovers', 'fumbles_lost', 'def_st_tds', 'time_of_possession_seconds',
    # for the player tables (target share denominator)
    'team_targets',
]

# Counts and yard totals: 0 when the team had none, never NULL.
TEAM_GAME_STATS_INT_COLS = [
    'plays', 'pass_plays', 'rush_plays', 'early_plays', 'late_plays',
    'explosive_plays', 'explosive_pass', 'explosive_rush',
    'first_downs', 'first_downs_pass', 'first_downs_rush', 'first_downs_penalty',
    'third_down_att', 'third_down_conv', 'fourth_down_att', 'fourth_down_conv',
    'total_plays', 'total_yards', 'total_drives', 'net_passing_yards',
    'completions', 'attempts', 'interceptions', 'sacks', 'sack_yards',
    'rushing_yards', 'rushing_attempts', 'red_zone_trips', 'red_zone_tds',
    'penalties', 'penalty_yards', 'turnovers', 'fumbles_lost', 'def_st_tds',
    'team_targets',
]

# EPA sums: 0.0 when the team had no such plays (BUF lost 0.00 EPA to turnovers).
TEAM_GAME_STATS_SUM_COLS = ['epa_lost_turnovers', 'epa_lost_sacks', 'epa_lost_penalties']

# Rates: NULL when the denominator is 0 (a team with no rush plays has no rush EPA/play).
TEAM_GAME_STATS_RATE_COLS = [
    'epa_per_play', 'success_rate', 'first_down_rate',
    'pass_epa_per_play', 'pass_success_rate', 'pass_first_down_rate',
    'rush_epa_per_play', 'rush_success_rate', 'rush_first_down_rate',
    'early_epa_per_play', 'early_success_rate', 'late_epa_per_play', 'late_success_rate',
    'explosive_rate', 'yards_per_play', 'yards_per_pass', 'yards_per_rush',
]


def _ratio(frame: pd.DataFrame, num: str, den: str) -> pd.Series:
    """num / den per row as Python floats; None where den is 0 (stored as NULL,
    never NaN). dtype=object keeps the None — a plain list of floats and None
    would become a float64 column with NaN."""
    return pd.Series([float(n) / float(d) if d else None for n, d in zip(frame[num], frame[den])],
                     index=frame.index, dtype=object)


def _top_seconds(value):
    """'12:34' -> 754. None for a missing or unparseable drive_time_of_possession."""
    if pd.isna(value):
        return None
    parts = str(value).split(':')
    if len(parts) != 2:
        return None
    try:
        return int(parts[0]) * 60 + int(parts[1])
    except ValueError:
        return None


def _team_game_frame(reg: pd.DataFrame) -> pd.DataFrame:
    """One row per (game_id, team_id) for every game in the frame — both teams,
    even one that never had the ball — with week, opponent_id and home_away."""
    games = reg.groupby('game_id').agg(
        week=('week', 'first'),
        home_team=('home_team', 'first'),
        away_team=('away_team', 'first'),
    ).reset_index().dropna(subset=['home_team', 'away_team'])
    home = games.rename(columns={'home_team': 'team_id', 'away_team': 'opponent_id'})
    home['home_away'] = 'home'
    away = games.rename(columns={'away_team': 'team_id', 'home_team': 'opponent_id'})
    away['home_away'] = 'away'
    frame = pd.concat([home, away], ignore_index=True)
    return frame[['game_id', 'team_id', 'week', 'opponent_id', 'home_away']]


def _team_game_efficiency(reg: pd.DataFrame) -> pd.DataFrame:
    """Efficiency set (spec §4): pass == 1 or rush == 1, EPA present, a possessing
    team. Kneels drop out on their own (pass = rush = 0); 2-point tries are KEPT
    (they have a null down, so early + late can be one short of plays)."""
    eff = reg[((reg['pass'] == 1) | (reg['rush'] == 1)) & reg['epa'].notna() & reg['posteam'].notna()].copy()
    eff['succ'] = (eff['success'] == 1).astype(int)
    eff['fd'] = (eff['first_down'] == 1).astype(int)
    # Scrambles are pass plays for EPA (pass = 1, rush = 0) but explosive RUNS.
    # Both rules are penalty-safe: no_play rows have yards_gained 0.
    eff['expl_pass'] = ((eff['complete_pass'] == 1) & (eff['yards_gained'] >= 20)).astype(int)
    eff['expl_rush'] = (((eff['rush'] == 1) | (eff['qb_scramble'] == 1)) & (eff['yards_gained'] >= 10)).astype(int)

    def sums(sub: pd.DataFrame, prefix: str, first_down: bool) -> pd.DataFrame:
        spec = {
            f'{prefix}plays': ('epa', 'size'),
            f'{prefix}epa_sum': ('epa', 'sum'),
            f'{prefix}succ_sum': ('succ', 'sum'),
        }
        if first_down:
            spec[f'{prefix}fd_sum'] = ('fd', 'sum')
        return sub.groupby(['game_id', 'posteam']).agg(**spec)

    parts = [
        sums(eff, '', True),
        sums(eff[eff['pass'] == 1], 'pass_', True),
        sums(eff[eff['rush'] == 1], 'rush_', True),
        sums(eff[eff['down'].isin([1, 2])], 'early_', False),
        sums(eff[eff['down'].isin([3, 4])], 'late_', False),
        eff.groupby(['game_id', 'posteam']).agg(
            explosive_pass=('expl_pass', 'sum'),
            explosive_rush=('expl_rush', 'sum'),
        ),
    ]
    out = pd.concat(parts, axis=1).reset_index().rename(columns={'posteam': 'team_id'})
    out['explosive_plays'] = out['explosive_pass'].fillna(0) + out['explosive_rush'].fillna(0)
    return out


def _team_game_costs(reg: pd.DataFrame) -> pd.DataFrame:
    """Turnovers (attributed by fumbled_1_team, spec §4) and the EPA lost to
    turnovers, sacks and the team's OWN penalties."""
    off = reg[reg['posteam'].notna()].copy()
    off['is_int'] = (off['interception'] == 1).astype(int)
    # fumble_lost flags the PLAY; fumbled_1_team says who lost the ball. A pick the
    # defence fumbles back is 1 turnover, not 2 (spec §4; known 1-of-544 limitation:
    # a second, separate lost fumble recorded only in fumbled_2_team is not counted).
    off['is_fl'] = ((off['fumble_lost'] == 1) & (off['fumbled_1_team'] == off['posteam'])).astype(int)
    off['to_epa'] = off['epa'].where((off['is_int'] == 1) | (off['is_fl'] == 1), 0.0)
    off['sack_epa'] = off['epa'].where(off['sack'] == 1, 0.0)
    own = off.groupby(['game_id', 'posteam']).agg(
        interceptions=('is_int', 'sum'),
        fumbles_lost=('is_fl', 'sum'),
        epa_lost_turnovers=('to_epa', 'sum'),
        epa_lost_sacks=('sack_epa', 'sum'),
    ).reset_index().rename(columns={'posteam': 'team_id'})
    own['turnovers'] = own['interceptions'] + own['fumbles_lost']

    # This team's own flags only (penalty_team == team), on offence AND defence.
    # EPA belongs to the possessing team, so a flag while defending is subtracted.
    pen = reg[(reg['penalty'] == 1) & reg['penalty_team'].notna()].copy()
    pen['signed_epa'] = pen['epa'].fillna(0.0).where(pen['posteam'] == pen['penalty_team'], -pen['epa'].fillna(0.0))
    flags = pen.groupby(['game_id', 'penalty_team']).agg(
        penalties=('penalty', 'size'),
        penalty_yards=('penalty_yards', lambda s: s.fillna(0).sum()),
        epa_lost_penalties=('signed_epa', 'sum'),
    ).reset_index().rename(columns={'penalty_team': 'team_id'})
    return own.merge(flags, on=['game_id', 'team_id'], how='outer')


def _team_game_traditional(reg: pd.DataFrame) -> pd.DataFrame:
    """Official box-score counts (spec §4 traditional set), from RAW rows."""
    off = reg[reg['posteam'].notna()].copy()
    no2 = off[off['two_point_attempt'] != 1].copy()
    no2['is_att'] = ((no2['pass_attempt'] == 1) & (no2['sack'] != 1)).astype(int)
    no2['is_comp'] = (no2['complete_pass'] == 1).astype(int)
    no2['is_rush'] = (no2['rush_attempt'] == 1).astype(int)
    passing = no2.groupby(['game_id', 'posteam']).agg(
        attempts=('is_att', 'sum'),
        completions=('is_comp', 'sum'),
        passing_yards=('passing_yards', lambda s: s.fillna(0).sum()),
        rushing_attempts=('is_rush', 'sum'),
        rushing_yards=('rushing_yards', lambda s: s.fillna(0).sum()),
    )

    off['is_sack'] = (off['sack'] == 1).astype(int)
    off['sack_yds'] = off['yards_gained'].fillna(0).where(off['sack'] == 1, 0.0)
    off['fdp'] = (off['first_down_pass'] == 1).astype(int)
    off['fdr'] = (off['first_down_rush'] == 1).astype(int)
    off['fdn'] = (off['first_down_penalty'] == 1).astype(int)
    misc = off.groupby(['game_id', 'posteam']).agg(
        sacks=('is_sack', 'sum'),
        sack_yards_raw=('sack_yds', 'sum'),
        first_downs_pass=('fdp', 'sum'),
        first_downs_rush=('fdr', 'sum'),
        first_downs_penalty=('fdn', 'sum'),
        total_drives=('drive', 'nunique'),
    )

    # 3rd / 4th down: snaps from scrimmage on that down (no_play excluded), a
    # conversion when the play earned a first down (a TD counts).
    scrim = off[off['play_type'].isin(_SCRIMMAGE_PLAY_TYPES) & (off['two_point_attempt'] != 1)].copy()
    scrim['conv'] = (scrim['first_down'] == 1).astype(int)
    downs = {}
    for down, prefix in ((3, 'third'), (4, 'fourth')):
        d = scrim[scrim['down'] == down].groupby(['game_id', 'posteam']).agg(
            att=('conv', 'size'), conv=('conv', 'sum'),
        )
        downs[f'{prefix}_down_att'] = d['att']
        downs[f'{prefix}_down_conv'] = d['conv']
    downs = pd.DataFrame(downs)

    # Red zone is drive-level: a trip once any scrimmage snap starts inside the
    # 20; a score when that drive ends in a TD by THIS team (td_team), so a
    # red-zone pick-six is not credited to the offence.
    rz_drives = scrim[(scrim['yardline_100'] <= 20) & scrim['drive'].notna()][['game_id', 'posteam', 'drive']].drop_duplicates()
    td_drives = off[(off['td_team'] == off['posteam']) & off['drive'].notna()][['game_id', 'posteam', 'drive']].drop_duplicates()
    td_drives['rz_td'] = 1
    rz = rz_drives.merge(td_drives, on=['game_id', 'posteam', 'drive'], how='left')
    red_zone = rz.groupby(['game_id', 'posteam']).agg(
        red_zone_trips=('drive', 'size'),
        red_zone_tds=('rz_td', lambda s: int(s.fillna(0).sum())),
    )

    # Time of possession: one drive_time_of_possession per (game, team, drive)
    # over ALL raw rows — a drive with no scrimmage play still owns its clock.
    top = off[off['drive'].notna()].groupby(['game_id', 'posteam', 'drive'])['drive_time_of_possession'].first()
    top = top.map(_top_seconds).reset_index()
    top_sum = top.groupby(['game_id', 'posteam'])['drive_time_of_possession'].agg(
        top_seconds=lambda s: s.dropna().sum(),
        top_known=lambda s: s.notna().sum(),
    )

    # Defensive / special-teams TDs: credited to a team that did not have the
    # ball. nflverse sets posteam to the RECEIVING team on kickoffs, so a
    # kickoff-return TD has td_team == posteam and needs the kickoff clause.
    tds = reg[reg['td_team'].notna()]
    dst = tds[(tds['posteam'] != tds['td_team']) | (tds['kickoff_attempt'] == 1)]
    def_st = dst.groupby(['game_id', 'td_team']).size().rename('def_st_tds')
    def_st.index = def_st.index.set_names(['game_id', 'posteam'])

    out = pd.concat([passing, misc, downs, red_zone, top_sum, def_st], axis=1).reset_index()
    return out.rename(columns={'posteam': 'team_id'})


def _team_game_targets(reg: pd.DataFrame) -> pd.DataFrame:
    """team_targets: exactly the plays aggregate_receiver_weekly_stats counts
    (filter_plays' play types, no 2-pt, a receiver, a non-sack non-scramble pass
    attempt), so every player's target share sums to 100%."""
    tgt = reg[
        reg['play_type'].isin(['pass', 'run', 'qb_kneel']) &
        (reg['two_point_attempt'] != 1) &
        reg['receiver_player_id'].notna() &
        (reg['pass_attempt'] == 1) &
        (reg['sack'] != 1) &
        (reg['qb_scramble'] != 1) &
        reg['posteam'].notna()
    ]
    return tgt.groupby(['game_id', 'posteam']).size().rename('team_targets').reset_index().rename(columns={'posteam': 'team_id'})


def aggregate_team_game_stats(pbp: pd.DataFrame, season: int) -> pd.DataFrame:
    """One row per team per regular-season game from RAW play-by-play (box score
    spec §4/§5). Takes the unfiltered frame, like aggregate_team_stats' pbp
    argument: time of possession, drives, penalties and red zone need the
    kicking and no_play rows that filter_plays drops.

    Counts and yard totals are 0 when a team had none; EPA sums are 0.0; rates
    are None (SQL NULL, never NaN) when their denominator is 0.
    """
    if pbp.empty or 'season_type' not in pbp.columns:
        return pd.DataFrame(columns=TEAM_GAME_STATS_COLS)
    reg = pbp[pbp['season_type'] == 'REG']
    if reg.empty:
        return pd.DataFrame(columns=TEAM_GAME_STATS_COLS)

    frame = _team_game_frame(reg)
    for part in (_team_game_efficiency(reg), _team_game_costs(reg),
                 _team_game_traditional(reg), _team_game_targets(reg)):
        frame = frame.merge(part, on=['game_id', 'team_id'], how='left')

    # Derived totals (spec §4): sack yards are negative in the raw data and only
    # enter total/net yards that way; the stored sack_yards is positive.
    frame['sack_yards_raw'] = frame['sack_yards_raw'].fillna(0.0)
    frame['passing_yards'] = frame['passing_yards'].fillna(0.0)
    frame['rushing_yards'] = frame['rushing_yards'].fillna(0.0)
    frame['net_passing_yards'] = frame['passing_yards'] + frame['sack_yards_raw']
    frame['total_yards'] = frame['net_passing_yards'] + frame['rushing_yards']
    frame['sack_yards'] = -frame['sack_yards_raw']
    for c in ('attempts', 'sacks', 'rushing_attempts'):
        frame[c] = frame[c].fillna(0)
    frame['total_plays'] = frame['rushing_attempts'] + frame['attempts'] + frame['sacks']
    frame['dropbacks'] = frame['attempts'] + frame['sacks']
    # Sum of parts on purpose: one play can be a rush AND a penalty first down,
    # and only the sum reaches ESPN's total (spec §4).
    frame['first_downs'] = (frame['first_downs_pass'].fillna(0) + frame['first_downs_rush'].fillna(0)
                            + frame['first_downs_penalty'].fillna(0))

    for c in TEAM_GAME_STATS_INT_COLS:
        frame[c] = frame[c].fillna(0).astype(int)
    for c in TEAM_GAME_STATS_SUM_COLS:
        frame[c] = frame[c].fillna(0.0).astype(float)
    for c in ('epa_sum', 'succ_sum', 'fd_sum', 'pass_epa_sum', 'pass_succ_sum', 'pass_fd_sum',
              'rush_epa_sum', 'rush_succ_sum', 'rush_fd_sum', 'early_epa_sum', 'early_succ_sum',
              'late_epa_sum', 'late_succ_sum'):
        frame[c] = frame[c].fillna(0.0)

    frame['epa_per_play'] = _ratio(frame, 'epa_sum', 'plays')
    frame['success_rate'] = _ratio(frame, 'succ_sum', 'plays')
    frame['first_down_rate'] = _ratio(frame, 'fd_sum', 'plays')
    frame['pass_epa_per_play'] = _ratio(frame, 'pass_epa_sum', 'pass_plays')
    frame['pass_success_rate'] = _ratio(frame, 'pass_succ_sum', 'pass_plays')
    frame['pass_first_down_rate'] = _ratio(frame, 'pass_fd_sum', 'pass_plays')
    frame['rush_epa_per_play'] = _ratio(frame, 'rush_epa_sum', 'rush_plays')
    frame['rush_success_rate'] = _ratio(frame, 'rush_succ_sum', 'rush_plays')
    frame['rush_first_down_rate'] = _ratio(frame, 'rush_fd_sum', 'rush_plays')
    frame['early_epa_per_play'] = _ratio(frame, 'early_epa_sum', 'early_plays')
    frame['early_success_rate'] = _ratio(frame, 'early_succ_sum', 'early_plays')
    frame['late_epa_per_play'] = _ratio(frame, 'late_epa_sum', 'late_plays')
    frame['late_success_rate'] = _ratio(frame, 'late_succ_sum', 'late_plays')
    frame['explosive_rate'] = _ratio(frame, 'explosive_plays', 'plays')
    frame['yards_per_play'] = _ratio(frame, 'total_yards', 'total_plays')
    frame['yards_per_pass'] = _ratio(frame, 'net_passing_yards', 'dropbacks')
    frame['yards_per_rush'] = _ratio(frame, 'rushing_yards', 'rushing_attempts')

    # Possession: the summed clock of the team's drives; NULL only when it had
    # drives but nflverse gave none of them a drive_time_of_possession.
    frame['top_known'] = frame['top_known'].fillna(0)
    frame['time_of_possession_seconds'] = pd.Series([
        None if (drives > 0 and known == 0) else int(secs if pd.notna(secs) else 0)
        for drives, known, secs in zip(frame['total_drives'], frame['top_known'], frame['top_seconds'])
    ], index=frame.index, dtype=object)

    frame['season'] = season
    frame['week'] = frame['week'].astype(int)
    frame = frame.sort_values(['game_id', 'home_away']).reset_index(drop=True)
    log.info("Aggregated team game stats for %d team-games (%d games)", len(frame), frame['game_id'].nunique())
    return frame[TEAM_GAME_STATS_COLS]
```

- [ ] **Step 5: Run the file**

```bash
PYTHONDONTWRITEBYTECODE=1 py -3 -m pytest "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass/tests/test_team_game_stats.py" -q -p no:cacheprovider
```

Expected: `124 passed` (3 fixture + 112 parametrized golden + 6 other BUF–HOU + 3 other games). If a golden value fails, the code deviates from spec §4 — fix the code; never change a number in `GOLD` (they are rbsdm/ESPN verified).

- [ ] **Step 6: Run the whole suite**

```bash
PYTHONDONTWRITEBYTECODE=1 py -3 -m pytest "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass/tests" -q -p no:cacheprovider
```

Expected: `386 passed`.

- [ ] **Step 7: Commit**

```bash
git -C "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" add scripts/ingest.py tests/test_team_game_stats.py
```

```bash
git -C "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" commit -m "feat: aggregate_team_game_stats — one row per team per game from raw play-by-play" -m "Efficiency set (pass/rush flags, EPA present, 2-pt kept), explosive plays with the scramble clause, turnovers attributed by fumbled_1_team, EPA lost to turnovers/sacks/own penalties, the official ESPN-style box score and team_targets, per box score spec section 4/5. Every column pinned against rbsdm and ESPN for 2026_01_BUF_HOU; NO-DET overtime possession and TB-CIN defensive TDs pinned too. Rates are None, never NaN, when the denominator is 0." -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: Synthetic games — every tricky case in spec §11

**Files:**
- Test: `tests/test_team_game_stats.py` (append)

**Interfaces:**
- Consumes: `aggregate_team_game_stats`, `TEAM_GAME_STATS_COLS`, `TEAM_GAME_STATS_INT_COLS`, `TEAM_GAME_STATS_RATE_COLS` (Task 2); the `raw` fixture and `team_game_row` (Task 1).
- Produces: nothing new in the code. These tests characterise the spec's edge cases; Task 2's implementation already satisfies them. **If one fails, the code deviates from spec §4 — fix the code and keep Task 2's golden tests green; never weaken a test.** Two are strict `xfail`s that document known limitations and must report XFAIL (an XPASS fails the run, which is the point: if the rule ever changes, the spec must change with it).

- [ ] **Step 1: Append the synthetic cases**

Append to the end of `tests/test_team_game_stats.py`:

```python


# ---------------------------------------------------------------------------
# Synthetic games — every tricky case in spec §11
# ---------------------------------------------------------------------------

def _one(raw, *frames, season=2026):
    """Aggregate a synthetic game and return KC's row (the away team in the defaults)."""
    from ingest import aggregate_team_game_stats
    out = aggregate_team_game_stats(raw.game(*frames), season)
    return team_game_row(out, out['game_id'].iloc[0], 'KC')


class TestEfficiencySet:
    def test_kneel_is_not_an_efficiency_play_but_is_a_rushing_attempt(self, raw):
        row = _one(raw, raw.play(), raw.rush(3.0), raw.kneel())
        assert row['plays'] == 2
        assert row['rush_plays'] == 1
        assert row['rushing_attempts'] == 2  # ESPN counts the kneel as a carry
        assert row['rushing_yards'] == 2     # 3 - 1

    def test_two_point_try_is_kept_and_has_no_down(self, raw):
        """2-pt stays in the efficiency set; early + late come up one short (spec §4)."""
        two_pt = raw.play(two_point_attempt=1.0, down=float('nan'), yardline_100=2.0, complete_pass=0.0,
                          yards_gained=0.0, passing_yards=float('nan'), epa=-0.95, success=0.0)
        row = _one(raw, raw.play(down=1.0), raw.play(down=3.0), two_pt)
        assert row['plays'] == 3
        assert row['early_plays'] + row['late_plays'] == 2
        # ...but official counts exclude it
        assert row['attempts'] == 2
        assert row['completions'] == 2
        assert row['team_targets'] == 2
        assert row['total_plays'] == 2

    def test_penalty_wiped_pass_counts_for_epa_but_never_explodes(self, raw):
        """nflverse keeps pass = 1 on a wiped pass, with EPA from the flag and 0 yards."""
        wiped = raw.no_play(**{'pass': 1.0}, complete_pass=0.0, yards_gained=0.0, epa=-0.8, success=0.0)
        row = _one(raw, raw.play(yards_gained=25.0, passing_yards=25.0), wiped)
        assert row['plays'] == 2
        assert row['explosive_plays'] == 1
        assert row['attempts'] == 1
        assert row['penalties'] == 1

    def test_success_and_first_down_rates(self, raw):
        row = _one(raw, raw.play(epa=0.4, success=1.0, first_down=1.0, first_down_pass=1.0),
                   raw.play(epa=-0.4, success=0.0), raw.rush(2.0, epa=-0.1, success=0.0), raw.rush(12.0, epa=0.9, success=1.0, first_down=1.0, first_down_rush=1.0))
        assert row['success_rate'] == approx(0.5)
        assert row['first_down_rate'] == approx(0.5)
        assert row['pass_success_rate'] == approx(0.5)
        assert row['rush_first_down_rate'] == approx(0.5)
        assert row['epa_per_play'] == approx(0.2)

    def test_early_and_late_downs(self, raw):
        row = _one(raw, raw.play(down=1.0, epa=0.1), raw.play(down=2.0, epa=0.3), raw.play(down=3.0, epa=-0.5), raw.play(down=4.0, epa=0.9))
        assert (row['early_plays'], row['late_plays']) == (2, 2)
        assert row['early_epa_per_play'] == approx(0.2)
        assert row['late_epa_per_play'] == approx(0.2)


class TestExplosives:
    def test_thresholds(self, raw):
        row = _one(raw,
                   raw.play(yards_gained=20.0, passing_yards=20.0),   # explosive pass
                   raw.play(yards_gained=19.0, passing_yards=19.0),   # not
                   raw.play(yards_gained=30.0, passing_yards=30.0, complete_pass=0.0),  # incomplete: not
                   raw.rush(10.0),                                    # explosive rush
                   raw.rush(9.0))                                     # not
        assert (row['explosive_pass'], row['explosive_rush'], row['explosive_plays']) == (1, 1, 2)
        assert row['explosive_rate'] == approx(2 / 5)

    def test_scramble_is_an_explosive_run_but_a_pass_play(self, raw):
        """pass = 1, rush = 0 on scrambles: EPA sits in the pass split, the 10+ yards in explosive_rush."""
        row = _one(raw, raw.scramble(12.0, epa=1.1), raw.play(epa=0.3))
        assert (row['pass_plays'], row['rush_plays']) == (2, 0)
        assert row['pass_epa_per_play'] == approx(0.7)
        assert (row['explosive_rush'], row['explosive_pass']) == (1, 0)
        assert row['rushing_attempts'] == 1   # a scramble is a carry in the official count
        assert row['attempts'] == 1           # ...and not a pass attempt
        assert row['team_targets'] == 1


class TestTurnovers:
    def test_interception_and_own_lost_fumble(self, raw):
        pick = raw.play(interception=1.0, complete_pass=0.0, epa=-4.0, success=0.0, passing_yards=float('nan'), yards_gained=0.0)
        lost = raw.rush(2.0, fumble=1.0, fumble_lost=1.0, fumbled_1_team='KC', fumbled_1_player_id='RB1', epa=-3.0, success=0.0)
        row = _one(raw, pick, lost, raw.play())
        assert (row['turnovers'], row['interceptions'], row['fumbles_lost']) == (2, 1, 1)
        assert row['epa_lost_turnovers'] == approx(-7.0)

    def test_pick_the_defence_fumbles_back_is_one_turnover(self, raw):
        """interception AND fumble_lost on one row, but BUF (the defence) fumbled: 1, not 2 (spec §4)."""
        play = raw.play(interception=1.0, complete_pass=0.0, fumble=1.0, fumble_lost=1.0, fumbled_1_team='BUF',
                        epa=-2.5, success=0.0, passing_yards=float('nan'), yards_gained=0.0)
        row = _one(raw, play)
        assert (row['turnovers'], row['interceptions'], row['fumbles_lost']) == (1, 1, 0)
        assert row['epa_lost_turnovers'] == approx(-2.5)  # counted once

    def test_defensive_fumble_the_offence_recovers_is_not_a_giveaway(self, raw):
        """fumble_lost = 1 with fumbled_1_team = the defence: nothing for the offence (spec §4)."""
        play = raw.play(fumble=1.0, fumble_lost=1.0, fumbled_1_team='BUF', epa=0.9)
        row = _one(raw, play)
        assert (row['turnovers'], row['fumbles_lost']) == (0, 0)
        assert row['epa_lost_turnovers'] == 0.0

    def test_fumble_recovered_by_the_offence_itself_is_not_a_turnover(self, raw):
        play = raw.rush(3.0, fumble=1.0, fumble_lost=0.0, fumbled_1_team='KC', fumbled_1_player_id='RB1', epa=-0.7)
        row = _one(raw, play)
        assert (row['turnovers'], row['fumbles_lost']) == (0, 0)

    def test_strip_sack_counts_in_both_cost_rows(self, raw):
        """A strip-sack is a sack AND a turnover; the overlap is intended (spec §4)."""
        strip = raw.sack(9.0, fumble=1.0, fumble_lost=1.0, fumbled_1_team='KC', fumbled_1_player_id='QB1', epa=-5.0)
        row = _one(raw, strip, raw.play())
        assert (row['sacks'], row['sack_yards'], row['turnovers']) == (1, 9, 1)
        assert row['epa_lost_sacks'] == approx(-5.0)
        assert row['epa_lost_turnovers'] == approx(-5.0)
        assert row['net_passing_yards'] == 8 - 9
        assert row['total_yards'] == 8 - 9

    @pytest.mark.xfail(strict=True, reason='spec section 4 known limitation (2025_14_PHI_LAC): a pick plus '
                       'a separate lost fumble on the same snap lives only in fumbled_2_team, which is not '
                       'trusted, so the rule counts 1 where 2 is right')
    def test_pick_plus_separate_lost_fumble_on_one_snap(self, raw):
        play = raw.play(interception=1.0, complete_pass=0.0, fumble=1.0, fumble_lost=1.0, fumbled_1_team='BUF',
                        epa=-3.0, success=0.0, passing_yards=float('nan'), yards_gained=0.0)
        row = _one(raw, play)
        assert row['turnovers'] == 2

    @pytest.mark.xfail(strict=True, reason='spec section 4 keys turnovers by posteam, so a punt the '
                       'RECEIVING team muffs (2026_01_CHI_CAR) is credited to nobody; ESPN charges the receiver')
    def test_muffed_punt_charged_to_the_receiving_team(self, raw):
        from ingest import aggregate_team_game_stats
        muff = raw.kick('punt', posteam='KC', defteam='BUF', fumble=1.0, fumble_lost=1.0, fumbled_1_team='BUF', epa=2.0)
        out = aggregate_team_game_stats(raw.game(raw.play(), muff), 2026)
        assert team_game_row(out, '2026_01_KC_BUF', 'BUF')['turnovers'] == 1


class TestPenalties:
    def test_own_flags_only_with_the_sign_flip(self, raw):
        """Offence flag: its EPA counts as is. Defence flag: the EPA is the opponent's gain, so subtract.
        The opponent's flags are theirs (spec §4)."""
        own_offence = raw.no_play(penalty_team='KC', penalty_yards=10.0, epa=-1.2)
        own_defence = raw.no_play(posteam='BUF', defteam='KC', penalty_team='KC', penalty_yards=15.0, epa=0.8)
        theirs = raw.no_play(penalty_team='BUF', penalty_yards=5.0, epa=0.4)
        row = _one(raw, raw.play(), own_offence, own_defence, theirs)
        assert (row['penalties'], row['penalty_yards']) == (2, 25)
        assert row['epa_lost_penalties'] == approx(-1.2 - 0.8)

    def test_penalty_first_down_lives_on_the_no_play_row(self, raw):
        """A defensive flag that moves the chains is first_down_penalty on a no_play row."""
        dpi = raw.no_play(penalty_team='BUF', penalty_yards=22.0, epa=1.5, first_down=1.0, first_down_penalty=1.0)
        row = _one(raw, raw.play(first_down=1.0, first_down_pass=1.0), dpi)
        assert (row['first_downs'], row['first_downs_pass'], row['first_downs_penalty']) == (2, 1, 1)

    def test_first_downs_are_the_sum_of_parts(self, raw):
        """One play can be a rush AND a penalty first down; only the sum reaches ESPN (spec §4)."""
        both = raw.rush(6.0, first_down=1.0, first_down_rush=1.0, first_down_penalty=1.0, penalty=1.0,
                        penalty_team='BUF', penalty_yards=5.0)
        row = _one(raw, both)
        assert row['first_downs'] == 2


class TestTraditional:
    def test_passing_rushing_and_totals(self, raw):
        row = _one(raw,
                   raw.play(yards_gained=12.0, passing_yards=12.0),
                   raw.play(complete_pass=0.0, yards_gained=0.0, passing_yards=float('nan'), epa=-0.4, success=0.0),
                   raw.sack(6.0),
                   raw.rush(5.0), raw.rush(-2.0))
        assert (row['completions'], row['attempts'], row['sacks'], row['sack_yards']) == (1, 2, 1, 6)
        assert row['net_passing_yards'] == 12 - 6
        assert row['yards_per_pass'] == approx(6 / 3)   # net passing / (attempts + sacks)
        assert (row['rushing_attempts'], row['rushing_yards']) == (2, 3)
        assert row['yards_per_rush'] == approx(1.5)
        assert row['total_plays'] == 2 + 1 + 2
        assert row['total_yards'] == 12 - 6 + 3
        assert row['yards_per_play'] == approx(9 / 5)

    def test_lateral_play_counts_the_passing_yards_column(self, raw):
        """Allen's 1-yard pass with a 10-yard lateral is 11 passing yards for the team (spec §10.3)."""
        row = _one(raw, raw.play(yards_gained=11.0, passing_yards=11.0))
        assert (row['net_passing_yards'], row['total_yards'], row['team_targets']) == (11, 11, 1)

    def test_safety_is_just_a_bad_run(self, raw):
        row = _one(raw, raw.rush(-3.0, yardline_100=99.0, epa=-2.0, success=0.0))
        assert (row['rushing_attempts'], row['rushing_yards'], row['total_yards']) == (1, -3, -3)

    def test_third_and_fourth_down_exclude_no_play_rows(self, raw):
        """Attempts are snaps from scrimmage on that down; a wiped play is not one (spec §4)."""
        row = _one(raw,
                   raw.play(down=3.0, first_down=1.0, first_down_pass=1.0),
                   raw.play(down=3.0, complete_pass=0.0, yards_gained=0.0, epa=-0.6, success=0.0),
                   raw.no_play(down=3.0),
                   raw.kneel(down=3.0),
                   raw.rush(1.0, down=4.0, first_down=1.0, first_down_rush=1.0),
                   raw.kick('punt', down=4.0))
        assert (row['third_down_att'], row['third_down_conv']) == (3, 1)
        assert (row['fourth_down_att'], row['fourth_down_conv']) == (1, 1)

    def test_touchdown_is_a_conversion(self, raw):
        td = raw.play(down=3.0, yards_gained=15.0, passing_yards=15.0, pass_touchdown=1.0, td_team='KC', first_down=1.0, first_down_pass=1.0)
        row = _one(raw, td)
        assert (row['third_down_att'], row['third_down_conv']) == (1, 1)


class TestRedZone:
    def test_trip_and_touchdown_are_drive_level(self, raw):
        row = _one(raw,
                   raw.play(drive=1.0, yardline_100=40.0),
                   raw.play(drive=1.0, yardline_100=18.0),
                   raw.rush(2.0, drive=1.0, yardline_100=4.0, rush_touchdown=1.0, td_team='KC', first_down=1.0, first_down_rush=1.0),
                   raw.kick('extra_point', drive=1.0, yardline_100=15.0),
                   raw.play(drive=2.0, yardline_100=19.0),
                   raw.play(drive=2.0, yardline_100=12.0, complete_pass=0.0, yards_gained=0.0),
                   raw.kick('field_goal', drive=2.0, yardline_100=12.0),
                   raw.play(drive=3.0, yardline_100=60.0))
        assert (row['red_zone_trips'], row['red_zone_tds']) == (2, 1)

    def test_extra_point_from_the_15_is_not_a_trip(self, raw):
        """Play-level counting gives BUF 6 trips because XPs snap from the 15 (spec §4)."""
        row = _one(raw, raw.play(drive=1.0, yardline_100=45.0, yards_gained=45.0, passing_yards=45.0, pass_touchdown=1.0, td_team='KC'),
                   raw.kick('extra_point', drive=1.0, yardline_100=15.0))
        assert row['red_zone_trips'] == 0

    def test_red_zone_pick_six_is_not_credited_to_the_offence(self, raw):
        pick_six = raw.play(drive=1.0, yardline_100=10.0, interception=1.0, complete_pass=0.0, yards_gained=0.0,
                            passing_yards=float('nan'), epa=-9.0, success=0.0, td_team='BUF')
        row = _one(raw, raw.play(drive=1.0, yardline_100=30.0), pick_six)
        assert (row['red_zone_trips'], row['red_zone_tds']) == (1, 0)
        assert row['turnovers'] == 1

    def test_two_point_try_is_not_a_trip(self, raw):
        two_pt = raw.play(drive=1.0, two_point_attempt=1.0, down=float('nan'), yardline_100=2.0, complete_pass=0.0, yards_gained=0.0, passing_yards=float('nan'))
        row = _one(raw, raw.play(drive=1.0, yardline_100=35.0, yards_gained=35.0, passing_yards=35.0, pass_touchdown=1.0, td_team='KC'), two_pt)
        assert row['red_zone_trips'] == 0


class TestDrivesAndPossession:
    def test_drive_without_a_scrimmage_play_still_owns_its_clock(self, raw):
        """TEN drive 6 in week 1 is a kickoff then a turnover on the return (spec §4)."""
        row = _one(raw,
                   raw.kick('kickoff', drive=1.0, drive_time_of_possession='0:05'),
                   raw.kick('kickoff', drive=2.0, drive_time_of_possession='0:10'),
                   raw.play(drive=2.0, drive_time_of_possession='0:10'),
                   raw.play(drive=2.0, drive_time_of_possession='0:10'))
        assert row['total_drives'] == 2
        assert row['time_of_possession_seconds'] == 15

    def test_rows_with_a_null_drive_are_ignored(self, raw):
        """4 week-1 rows have a posteam but no drive (XPs after a defensive TD, END GAME)."""
        row = _one(raw, raw.play(drive=1.0, drive_time_of_possession='1:00'),
                   raw.kick('extra_point', drive=float('nan'), drive_time_of_possession=None))
        assert row['total_drives'] == 1
        assert row['time_of_possession_seconds'] == 60

    def test_possession_is_null_when_no_drive_has_a_clock(self, raw):
        row = _one(raw, raw.play(drive=1.0, drive_time_of_possession=None), raw.play(drive=2.0, drive_time_of_possession='junk'))
        assert row['total_drives'] == 2
        assert row['time_of_possession_seconds'] is None

    def test_overtime_clock_is_just_more_seconds(self, raw):
        row = _one(raw, raw.play(drive=1.0, drive_time_of_possession='36:51'), raw.play(drive=2.0, drive_time_of_possession='31:35'))
        assert row['time_of_possession_seconds'] == 68 * 60 + 26


class TestDefensiveAndSpecialTeamsTouchdowns:
    def test_pick_six_goes_to_the_defence(self, raw):
        from ingest import aggregate_team_game_stats
        pick_six = raw.play(interception=1.0, complete_pass=0.0, yards_gained=0.0, passing_yards=float('nan'), epa=-8.0, success=0.0, td_team='BUF')
        out = aggregate_team_game_stats(raw.game(pick_six), 2026)
        assert team_game_row(out, '2026_01_KC_BUF', 'BUF')['def_st_tds'] == 1
        assert team_game_row(out, '2026_01_KC_BUF', 'KC')['def_st_tds'] == 0

    def test_kickoff_return_touchdown_counts_even_though_posteam_is_the_returner(self, raw):
        """nflverse puts the RECEIVING team in posteam on kickoffs, so td_team == posteam there."""
        row = _one(raw, raw.kick('kickoff', posteam='KC', defteam='BUF', td_team='KC', epa=6.0, yards_gained=100.0))
        assert row['def_st_tds'] == 1

    def test_offensive_touchdown_is_not_counted(self, raw):
        row = _one(raw, raw.play(yards_gained=30.0, passing_yards=30.0, pass_touchdown=1.0, td_team='KC'))
        assert row['def_st_tds'] == 0


class TestTargets:
    def test_team_targets_match_the_receiver_aggregator_set(self, raw):
        """A receiver on a non-sack, non-scramble pass attempt, 2-pt excluded (spec §5)."""
        row = _one(raw,
                   raw.play(receiver_player_id='WR1'),
                   raw.play(receiver_player_id='TE1', complete_pass=0.0, yards_gained=0.0),
                   raw.play(receiver_player_id=None, complete_pass=0.0, yards_gained=0.0),   # throwaway
                   raw.sack(5.0, receiver_player_id=None),
                   raw.scramble(8.0),
                   raw.play(receiver_player_id='WR1', two_point_attempt=1.0, down=float('nan'), yardline_100=2.0, complete_pass=0.0, yards_gained=0.0))
        assert row['team_targets'] == 2


class TestNullsAndEmptyInputs:
    def test_zero_pass_attempts_leave_pass_rates_null(self, raw):
        row = _one(raw, raw.rush(4.0), raw.rush(6.0))
        assert row['pass_plays'] == 0
        for col in ('pass_epa_per_play', 'pass_success_rate', 'pass_first_down_rate', 'yards_per_pass'):
            assert row[col] is None, col
        assert (row['attempts'], row['completions'], row['team_targets'], row['net_passing_yards']) == (0, 0, 0, 0)
        assert row['rush_epa_per_play'] is not None

    def test_zero_rush_attempts_leave_rush_rates_null(self, raw):
        row = _one(raw, raw.play(), raw.play())
        assert row['rush_plays'] == 0
        for col in ('rush_epa_per_play', 'rush_success_rate', 'rush_first_down_rate', 'yards_per_rush'):
            assert row[col] is None, col
        assert (row['rushing_attempts'], row['rushing_yards']) == (0, 0)

    def test_team_that_never_had_the_ball_still_gets_a_row(self, raw):
        from ingest import aggregate_team_game_stats, TEAM_GAME_STATS_INT_COLS, TEAM_GAME_STATS_RATE_COLS
        out = aggregate_team_game_stats(raw.game(raw.play(), raw.rush(3.0)), 2026)
        buf = team_game_row(out, '2026_01_KC_BUF', 'BUF')
        assert (buf['opponent_id'], buf['home_away'], buf['week']) == ('KC', 'home', 1)
        for col in TEAM_GAME_STATS_INT_COLS:
            assert buf[col] == 0, col
        for col in TEAM_GAME_STATS_RATE_COLS:
            assert buf[col] is None, col
        assert buf['time_of_possession_seconds'] == 0
        assert buf['epa_lost_turnovers'] == 0.0

    def test_no_plays_yet_returns_an_empty_frame_with_the_columns(self, raw):
        from ingest import aggregate_team_game_stats, TEAM_GAME_STATS_COLS
        empty = raw.game(raw.play()).iloc[0:0]
        out = aggregate_team_game_stats(empty, 2026)
        assert len(out) == 0
        assert list(out.columns) == TEAM_GAME_STATS_COLS
        assert len(aggregate_team_game_stats(pd.DataFrame(), 2026)) == 0

    def test_playoff_rows_are_skipped(self, raw):
        from ingest import aggregate_team_game_stats
        post = raw.play(game_id='2026_19_KC_BUF', week=19, season_type='POST')
        out = aggregate_team_game_stats(raw.game(post, raw.play()), 2026)
        assert out['game_id'].tolist() == ['2026_01_KC_BUF', '2026_01_KC_BUF']

    def test_nulls_in_flag_columns_do_not_crash(self, raw):
        """Game-start rows have NaN in nearly every column."""
        blank = raw.play(play_type=None, posteam=None, defteam=None, down=float('nan'), drive=float('nan'),
                         **{'pass': 0.0}, pass_attempt=float('nan'), rush_attempt=float('nan'), sack=float('nan'),
                         complete_pass=float('nan'), two_point_attempt=float('nan'), kickoff_attempt=float('nan'),
                         first_down=float('nan'), epa=-0.0, yards_gained=float('nan'), yardline_100=float('nan'),
                         drive_time_of_possession=None, passer_player_id=None, receiver_player_id=None)
        row = _one(raw, blank, raw.play(), raw.rush(5.0))
        assert row['plays'] == 2
        assert row['total_drives'] == 1

    def test_season_agnostic(self, raw):
        """A 2025 game gives the same shape; season and week come from the call and the rows."""
        row = _one(raw, raw.play(game_id='2025_07_KC_BUF', season=2025, week=7), raw.rush(4.0, game_id='2025_07_KC_BUF', season=2025, week=7), season=2025)
        assert (row['season'], row['week'], row['game_id']) == (2025, 7, '2025_07_KC_BUF')
        assert row['plays'] == 2

    def test_rows_are_sorted_by_game_then_away_home(self, raw):
        from ingest import aggregate_team_game_stats
        second = raw.play(game_id='2026_01_SF_LA', home_team='LA', away_team='SF', posteam='SF', defteam='LA')
        out = aggregate_team_game_stats(raw.game(second, raw.play()), 2026)
        assert list(zip(out['game_id'], out['team_id'])) == [
            ('2026_01_KC_BUF', 'KC'), ('2026_01_KC_BUF', 'BUF'), ('2026_01_SF_LA', 'SF'), ('2026_01_SF_LA', 'LA')]
```

- [ ] **Step 2: Run the file**

```bash
PYTHONDONTWRITEBYTECODE=1 py -3 -m pytest "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass/tests/test_team_game_stats.py" -q -p no:cacheprovider -rxX
```

Expected: `164 passed, 2 xfailed` — the two XFAILs are `test_pick_plus_separate_lost_fumble_on_one_snap` and `test_muffed_punt_charged_to_the_receiving_team`. Any FAILED or XPASS means the code deviates from spec §4: fix `scripts/ingest.py`, re-run, and confirm Task 2's golden tests still pass.

- [ ] **Step 3: Run the whole suite**

```bash
PYTHONDONTWRITEBYTECODE=1 py -3 -m pytest "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass/tests" -q -p no:cacheprovider
```

Expected: `426 passed, 2 xfailed`.

- [ ] **Step 4: Commit**

```bash
git -C "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" add tests/test_team_game_stats.py
```

```bash
git -C "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" commit -m "test: synthetic games for every box score edge case in spec section 11" -m "2-pt tries, kneels, penalty-wiped plays, strip-sacks, the three fumble attributions, laterals, safeties, defensive and kickoff-return TDs, drive-level red zone, drives without a scrimmage play, zero pass/rush attempts, a team that never had the ball, no plays yet, playoff rows, a 2025 game. Two strict xfails document the known turnover limitations (2025_14_PHI_LAC, muffed punts)." -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: Table, upsert, stale-row cleanup and `process_season` wiring

**Files:**
- Modify: `scripts/ingest.py` — append two functions after `aggregate_team_game_stats`; `cleanup_stale_rows` (signature at line 3261 on main, body ends at line 3368); `process_season` (lines 3434–3549 on main)
- Test: `tests/test_team_game_stats_pipeline.py` (create)

**Interfaces:**
- Consumes: `aggregate_team_game_stats`, `TEAM_GAME_STATS_COLS`, `TEAM_GAME_STATS_INT_COLS` (Task 2); `team_game_rows`, `raw`, `pbp_fixture`, `FIXTURE_GAMES` (Task 1); the existing `retry`, `execute_values`, `log`.
- Produces: `ensure_team_game_stats_table(conn)` (DDL + RLS + `public_read` policy, commits, not retried), `upsert_team_game_stats(conn, df)` (`@retry`, `INSERT … ON CONFLICT (game_id, team_id) DO UPDATE`, plain-Python row values with `None` for NULL), `cleanup_stale_rows(…, game_ids: list = None)` (new trailing keyword; `DELETE FROM team_game_stats WHERE season = %s AND game_id != ALL(%s)` when the list is non-empty), and `process_season` calling all three with the **raw** `pbp`. Task 5 adds one more `ensure_*` call and one more assertion to the wiring test.

- [ ] **Step 1: Write the failing tests**

Create `tests/test_team_game_stats_pipeline.py`:

```python
"""team_game_stats DDL, upsert, stale-row cleanup and process_season wiring —
box score spec §5 ("How it runs", "Stale rows")."""
import math

import pandas as pd
import pytest

from conftest import FIXTURE_GAMES


class _FakeCursor:
    """Records every execute(sql, params); rowcount is always 0."""

    def __init__(self, calls):
        self.calls = calls
        self.rowcount = 0

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql, params=None):
        self.calls.append((' '.join(sql.split()), params))


class _FakeConn:
    def __init__(self):
        self.calls = []
        self.commits = 0
        self.rollbacks = 0

    def cursor(self):
        return _FakeCursor(self.calls)

    def commit(self):
        self.commits += 1

    def rollback(self):
        self.rollbacks += 1


class TestEnsureTable:
    def test_ddl_declares_every_stored_column(self):
        from ingest import ensure_team_game_stats_table, TEAM_GAME_STATS_COLS
        conn = _FakeConn()
        ensure_team_game_stats_table(conn)
        ddl = ' '.join(sql for sql, _ in conn.calls)
        assert 'CREATE TABLE IF NOT EXISTS team_game_stats' in ddl
        for col in TEAM_GAME_STATS_COLS:
            assert f' {col} ' in ddl, col
        assert 'UNIQUE (game_id, team_id)' in ddl
        assert 'team_id TEXT NOT NULL REFERENCES teams(id)' in ddl
        assert 'idx_team_game_stats_season_week' in ddl
        assert 'idx_team_game_stats_team_season' in ddl
        assert 'ALTER TABLE team_game_stats ENABLE ROW LEVEL SECURITY' in ddl
        assert 'CREATE POLICY "public_read" ON team_game_stats FOR SELECT USING (true)' in ddl
        assert conn.commits == 1
        assert conn.rollbacks == 0


class TestUpsert:
    def test_sql_columns_and_conflict_target(self, monkeypatch, team_game_rows):
        import ingest
        from ingest import upsert_team_game_stats, TEAM_GAME_STATS_COLS
        captured = {}

        def fake_execute_values(cur, sql, rows):
            captured['sql'] = ' '.join(sql.split())
            captured['rows'] = rows

        monkeypatch.setattr(ingest, 'execute_values', fake_execute_values)
        upsert_team_game_stats(_FakeConn(), team_game_rows)
        sql = captured['sql']
        assert sql.startswith(f"INSERT INTO team_game_stats ({', '.join(TEAM_GAME_STATS_COLS)}) VALUES %s")
        assert 'ON CONFLICT (game_id, team_id) DO UPDATE SET' in sql
        assert 'game_id = EXCLUDED.game_id' not in sql
        assert 'team_id = EXCLUDED.team_id' not in sql
        for col in TEAM_GAME_STATS_COLS[2:]:
            assert f'{col} = EXCLUDED.{col}' in sql, col
        assert len(captured['rows']) == 6

    def test_rows_are_plain_python_with_null_never_nan(self, monkeypatch, raw):
        """numpy scalars have no psycopg2 adapter; NaN would reach Postgres as 'NaN'::numeric."""
        import ingest
        from ingest import aggregate_team_game_stats, upsert_team_game_stats, TEAM_GAME_STATS_COLS
        captured = {}

        def fake_execute_values(cur, sql, rows):
            captured['rows'] = rows

        monkeypatch.setattr(ingest, 'execute_values', fake_execute_values)
        # KC only passes, so its rush rates are NULL; BUF never has the ball.
        df = aggregate_team_game_stats(raw.game(raw.play(), raw.play()), 2026)
        upsert_team_game_stats(_FakeConn(), df)
        rows = captured['rows']
        assert len(rows) == 2
        flat = [v for r in rows for v in r]
        assert not any(isinstance(v, float) and math.isnan(v) for v in flat)
        assert all(type(v) in (int, float, str, type(None)) for v in flat)
        kc = dict(zip(TEAM_GAME_STATS_COLS, [r for r in rows if r[1] == 'KC'][0]))
        assert type(kc['plays']) is int and kc['plays'] == 2
        assert type(kc['epa_per_play']) is float
        assert kc['rush_epa_per_play'] is None
        assert kc['yards_per_rush'] is None
        assert type(kc['week']) is int and type(kc['season']) is int
        buf = dict(zip(TEAM_GAME_STATS_COLS, [r for r in rows if r[1] == 'BUF'][0]))
        assert buf['epa_per_play'] is None
        assert buf['plays'] == 0

    def test_empty_frame_writes_nothing(self, monkeypatch):
        import ingest
        from ingest import upsert_team_game_stats, TEAM_GAME_STATS_COLS

        def boom(*args, **kwargs):
            raise AssertionError('empty frame must not reach execute_values')

        monkeypatch.setattr(ingest, 'execute_values', boom)
        upsert_team_game_stats(_FakeConn(), pd.DataFrame(columns=TEAM_GAME_STATS_COLS))


class TestCleanup:
    def _run(self, **kwargs):
        from ingest import cleanup_stale_rows
        conn = _FakeConn()
        cleanup_stale_rows(conn, 2026, team_ids=['KC'], player_ids=['QB1'], **kwargs)
        return [c for c in conn.calls if 'team_game_stats' in c[0]]

    def test_deletes_games_missing_from_the_file(self):
        calls = self._run(game_ids=['2026_01_KC_BUF', '2026_02_BUF_NYJ'])
        assert calls == [('DELETE FROM team_game_stats WHERE season = %s AND game_id != ALL(%s)',
                          (2026, ['2026_01_KC_BUF', '2026_02_BUF_NYJ']))]

    def test_empty_list_deletes_nothing(self):
        """Same guard as every other cleanup: an empty list would delete the whole season."""
        assert self._run(game_ids=[]) == []

    def test_omitted_parameter_deletes_nothing(self):
        assert self._run() == []


class TestProcessSeasonWiring:
    """The slug bug was a function defined but never called from process_season.
    Every other aggregator and DB call is stubbed; the new code runs for real."""

    ROSTER = pd.DataFrame([{'gsis_id': '00-0034857', 'position': 'QB'}])

    def _wire(self, monkeypatch, pbp_fixture):
        import ingest
        calls = []

        def record(name, result=None):
            def _f(*args, **kwargs):
                calls.append((name, args, kwargs))
                return result
            return _f

        monkeypatch.setattr(ingest, 'download_pbp', lambda season: pbp_fixture.copy())
        monkeypatch.setattr(ingest, 'download_roster', lambda season: self.ROSTER)
        monkeypatch.setattr(ingest, 'download_participation', lambda season: None)
        stubs = {
            'aggregate_team_stats': pd.DataFrame({'team_id': ['BUF'], 'off_epa_play': [0.1], 'def_epa_play': [-0.1]}),
            'aggregate_qb_stats': pd.DataFrame({'player_id': ['00-0034857'], 'dropbacks': [31]}),
            'aggregate_qb_pass_location_stats': pd.DataFrame(),
            'aggregate_rb_gap_stats': pd.DataFrame(),
            'aggregate_rb_gap_stats_weekly': pd.DataFrame(),
            'aggregate_def_gap_stats': pd.DataFrame(),
            'aggregate_receiver_stats': pd.DataFrame(),
            'aggregate_rb_season_stats': pd.DataFrame(),
            'aggregate_qb_weekly_stats': pd.DataFrame(),
            'aggregate_receiver_weekly_stats': pd.DataFrame(),
            'aggregate_rb_weekly_stats': pd.DataFrame(),
            'aggregate_team_down_distance_stats': pd.DataFrame(),
            'aggregate_team_situational_stats': pd.DataFrame(),
            'generate_player_slugs': pd.DataFrame(),
            'validate_data': None,
            'get_existing_through_week': None,
            'update_freshness': None,
            'cleanup_stale_rows': None,
        }
        for name, result in stubs.items():
            monkeypatch.setattr(ingest, name, record(name, result))
        for name in dir(ingest):
            if name.startswith('ensure_') or (name.startswith('upsert_') and name != 'upsert_team_game_stats'):
                monkeypatch.setattr(ingest, name, record(name))

        real_aggregate = ingest.aggregate_team_game_stats
        real_upsert = ingest.upsert_team_game_stats

        def spy_aggregate(pbp, season):
            calls.append(('aggregate_team_game_stats', (len(pbp), season), {}))
            return real_aggregate(pbp, season)

        def spy_upsert(conn, df):
            calls.append(('upsert_team_game_stats', (df,), {}))

        monkeypatch.setattr(ingest, 'aggregate_team_game_stats', spy_aggregate)
        monkeypatch.setattr(ingest, 'upsert_team_game_stats', spy_upsert)
        monkeypatch.setattr(ingest, 'execute_values', lambda *a, **k: None)
        return ingest, calls

    def test_full_run_aggregates_raw_pbp_ensures_upserts_and_cleans_up(self, monkeypatch, pbp_fixture):
        ingest, calls = self._wire(monkeypatch, pbp_fixture)
        conn = _FakeConn()
        ingest.process_season(2026, conn)
        names = [c[0] for c in calls]

        agg = [c for c in calls if c[0] == 'aggregate_team_game_stats']
        assert agg == [('aggregate_team_game_stats', (len(pbp_fixture), 2026), {})]  # RAW rows, not filter_plays' 375

        up = [c for c in calls if c[0] == 'upsert_team_game_stats']
        assert len(up) == 1
        df = up[0][1][0]
        assert len(df) == 6 and sorted(df['game_id'].unique()) == sorted(FIXTURE_GAMES)

        assert names.index('ensure_team_game_stats_table') < names.index('upsert_team_game_stats')

        cleanup = [c for c in calls if c[0] == 'cleanup_stale_rows'][0]
        assert sorted(cleanup[2]['game_ids']) == sorted(FIXTURE_GAMES)
        assert names.index('upsert_team_game_stats') < names.index('cleanup_stale_rows') < names.index('update_freshness')
        assert conn.commits == 1 and conn.rollbacks == 0

    def test_dry_run_reports_team_game_rows_and_writes_nothing(self, monkeypatch, pbp_fixture, caplog):
        ingest, calls = self._wire(monkeypatch, pbp_fixture)
        with caplog.at_level('INFO', logger='ingest'):
            ingest.process_season(2026, None, dry_run=True)
        assert 'Team game stats: 6 rows (3 games)' in caplog.text
        assert not any(c[0].startswith(('upsert_', 'ensure_', 'cleanup_')) for c in calls)
```

- [ ] **Step 2: Run the file to see it fail**

```bash
PYTHONDONTWRITEBYTECODE=1 py -3 -m pytest "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass/tests/test_team_game_stats_pipeline.py" -q -p no:cacheprovider
```

Expected: 9 failures/errors — `ImportError: cannot import name 'ensure_team_game_stats_table'` / `'upsert_team_game_stats'`, `TypeError: cleanup_stale_rows() got an unexpected keyword argument 'game_ids'`, and `AttributeError: … has no attribute 'upsert_team_game_stats'` from the wiring tests.

- [ ] **Step 3: Add the DDL and the upsert**

In `scripts/ingest.py`, directly after the last line of `aggregate_team_game_stats` (`    return frame[TEAM_GAME_STATS_COLS]`), add two blank lines and:

```python
def ensure_team_game_stats_table(conn):
    """Create team_game_stats (box score spec §5) if it doesn't exist. NOT @retry."""
    with conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS team_game_stats (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                game_id TEXT NOT NULL,
                team_id TEXT NOT NULL REFERENCES teams(id),
                season INT NOT NULL,
                week INT NOT NULL,
                opponent_id TEXT REFERENCES teams(id),
                home_away TEXT,
                plays INT,
                epa_per_play NUMERIC,
                success_rate NUMERIC,
                first_down_rate NUMERIC,
                pass_plays INT,
                pass_epa_per_play NUMERIC,
                pass_success_rate NUMERIC,
                pass_first_down_rate NUMERIC,
                rush_plays INT,
                rush_epa_per_play NUMERIC,
                rush_success_rate NUMERIC,
                rush_first_down_rate NUMERIC,
                early_plays INT,
                early_epa_per_play NUMERIC,
                early_success_rate NUMERIC,
                late_plays INT,
                late_epa_per_play NUMERIC,
                late_success_rate NUMERIC,
                explosive_plays INT,
                explosive_rate NUMERIC,
                explosive_pass INT,
                explosive_rush INT,
                epa_lost_turnovers NUMERIC,
                epa_lost_sacks NUMERIC,
                epa_lost_penalties NUMERIC,
                first_downs INT,
                first_downs_pass INT,
                first_downs_rush INT,
                first_downs_penalty INT,
                third_down_att INT,
                third_down_conv INT,
                fourth_down_att INT,
                fourth_down_conv INT,
                total_plays INT,
                total_yards INT,
                total_drives INT,
                yards_per_play NUMERIC,
                net_passing_yards INT,
                completions INT,
                attempts INT,
                yards_per_pass NUMERIC,
                interceptions INT,
                sacks INT,
                sack_yards INT,
                rushing_yards INT,
                rushing_attempts INT,
                yards_per_rush NUMERIC,
                red_zone_trips INT,
                red_zone_tds INT,
                penalties INT,
                penalty_yards INT,
                turnovers INT,
                fumbles_lost INT,
                def_st_tds INT,
                time_of_possession_seconds INT,
                team_targets INT,
                UNIQUE (game_id, team_id)
            );
            CREATE INDEX IF NOT EXISTS idx_team_game_stats_season_week ON team_game_stats(season, week);
            CREATE INDEX IF NOT EXISTS idx_team_game_stats_team_season ON team_game_stats(team_id, season);
        """)
        cur.execute("""
            DO $$ BEGIN
                ALTER TABLE team_game_stats ENABLE ROW LEVEL SECURITY;
            EXCEPTION WHEN others THEN NULL;
            END $$;
        """)
        cur.execute("""
            DO $$ BEGIN
                CREATE POLICY "public_read" ON team_game_stats FOR SELECT USING (true);
            EXCEPTION WHEN duplicate_object THEN NULL;
            END $$;
        """)
    conn.commit()
    log.info("Ensured team_game_stats table exists with RLS")


@retry(max_retries=2, delay=3)
def upsert_team_game_stats(conn, df: pd.DataFrame):
    """Upsert one row per team per game into team_game_stats."""
    if df.empty:
        log.info("No team game stats to upsert (empty DataFrame)")
        return
    cols = TEAM_GAME_STATS_COLS
    # Plain-Python rows, as in ingest_schedules: NaN/None -> None (SQL NULL, never
    # 'NaN'::numeric), numpy ints/floats -> int/float (no psycopg2 adapter).
    int_cols = set(TEAM_GAME_STATS_INT_COLS) | {'season', 'week'}
    text_cols = {'game_id', 'team_id', 'opponent_id', 'home_away'}
    rows = []
    for values in df[cols].astype(object).itertuples(index=False, name=None):
        row = []
        for c, v in zip(cols, values):
            if pd.isna(v):
                row.append(None)
            elif c in text_cols:
                row.append(str(v))
            elif c in int_cols:
                row.append(int(v))
            else:
                row.append(float(v))
        rows.append(tuple(row))
    col_names = ', '.join(cols)
    update_set = ', '.join(f"{c} = EXCLUDED.{c}" for c in cols if c not in ('game_id', 'team_id'))

    with conn.cursor() as cur:
        execute_values(
            cur,
            f"""INSERT INTO team_game_stats ({col_names})
                VALUES %s
                ON CONFLICT (game_id, team_id) DO UPDATE SET {update_set}""",
            rows,
        )
    log.info("Upserted %d team game rows", len(rows))
```

`game_id` deliberately has no foreign key to `games`: the schedules ingest is allowed to fail with a warning (`main()`), and an FK would then block every box score.

- [ ] **Step 4: Teach `cleanup_stale_rows` about game ids**

(a) The signature's last parameters are `…, dd_team_ids: list = None, sit_team_ids: list = None):` — change them to:

```python
dd_team_ids: list = None, sit_team_ids: list = None, game_ids: list = None):
```

(b) The function body ends with the `team_situational_stats` block:

```python
        if sit_team_ids is not None and len(sit_team_ids) > 0:
            cur.execute(
                "DELETE FROM team_situational_stats WHERE season = %s AND team_id != ALL(%s)",
                (season, sit_team_ids),
            )
            if cur.rowcount > 0:
                log.info("Cleaned up %d stale team_situational_stats rows", cur.rowcount)
```

Directly after it (still inside the `with conn.cursor() as cur:` block, same indentation) add:

```python

        # Game-keyed: a rescheduled game gets a new game_id, and the old id's rows
        # would otherwise survive every team-keyed cleanup (box score spec §5).
        if game_ids is not None and len(game_ids) > 0:
            cur.execute(
                "DELETE FROM team_game_stats WHERE season = %s AND game_id != ALL(%s)",
                (season, game_ids),
            )
            if cur.rowcount > 0:
                log.info("Cleaned up %d stale team_game_stats rows", cur.rowcount)
```

- [ ] **Step 5: Wire `process_season`**

Five edits, each anchored on a line that occurs exactly once in `process_season`:

(a) Change

```python
    sit_stats = aggregate_team_situational_stats(plays, season)
    through_week = int(plays['week'].max())
```

to

```python
    sit_stats = aggregate_team_situational_stats(plays, season)
    # RAW pbp, not plays: box scores need the kicking and no_play rows (spec §5)
    team_game_stats = aggregate_team_game_stats(pbp, season)
    through_week = int(plays['week'].max())
```

(b) In the dry-run block, after

```python
        log.info("[DRY RUN] Def gap: %d rows", len(def_gap_stats))
```

add

```python
        log.info("[DRY RUN] Team game stats: %d rows (%d games)",
                 len(team_game_stats), team_game_stats['game_id'].nunique() if not team_game_stats.empty else 0)
```

(c) In the `ensure_*` block, after

```python
    ensure_player_slugs_table(conn)
```

add

```python
    ensure_team_game_stats_table(conn)
```

(d) Inside the `try:` block, after

```python
        upsert_team_situational_stats(conn, sit_stats)
```

add

```python
        upsert_team_game_stats(conn, team_game_stats)
```

(e) In the `cleanup_stale_rows(` call, after

```python
            sit_team_ids=sit_stats['team_id'].unique().tolist() if not sit_stats.empty else [],
```

add

```python
            game_ids=team_game_stats['game_id'].unique().tolist() if not team_game_stats.empty else [],
```

- [ ] **Step 6: Run the file**

```bash
PYTHONDONTWRITEBYTECODE=1 py -3 -m pytest "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass/tests/test_team_game_stats_pipeline.py" -q -p no:cacheprovider
```

Expected: `9 passed`.

- [ ] **Step 7: Run the whole suite**

```bash
PYTHONDONTWRITEBYTECODE=1 py -3 -m pytest "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass/tests" -q -p no:cacheprovider
```

Expected: `435 passed, 2 xfailed`.

- [ ] **Step 8: Commit**

```bash
git -C "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" add scripts/ingest.py tests/test_team_game_stats_pipeline.py
```

```bash
git -C "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" commit -m "feat: team_game_stats table, upsert and stale-game cleanup wired into process_season" -m "ensure_team_game_stats_table joins the other ensure_* calls (own commit, before the transaction); upsert_team_game_stats sends plain-Python rows with NULL for undefined rates; cleanup_stale_rows(game_ids=) drops rows of game ids missing from the file (reschedules). process_season aggregates from the RAW pbp frame. Wiring test stubs everything else so a defined-but-never-called function cannot slip through again." -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: QB rushing EPA/carry and success rate on `qb_weekly_stats`

**Files:**
- Modify: `scripts/ingest.py` — `aggregate_qb_weekly_stats` (rush block, lines 2058–2087 on main; `cols` list, lines 2121–2129), new `ensure_qb_weekly_stats_columns` after `ensure_qb_weekly_stats_table` (ends line 2442), `upsert_qb_weekly_stats` `cols` (lines 2547–2555), one line in `process_season`'s `ensure_*` block
- Test: `tests/test_qb_rushing_epa.py` (create); `tests/test_team_game_stats_pipeline.py` (one added assertion)

**Interfaces:**
- Consumes: the `raw` fixture, `pbp_fixture` (Task 1); the existing `filter_plays`, `_derive_game_context`, `_get_game_week_map`, `passer_rating`, `execute_values`, `log`.
- Produces: `aggregate_qb_weekly_stats(plays, roster, season)` returns two more columns, `rush_epa_per_carry` and `rush_success_rate` (Python floats, or `None` for a game with no carries; `dtype=object`), placed after `rush_tds` in its `cols`; `ensure_qb_weekly_stats_columns(conn)` (idempotent `ALTER TABLE … ADD COLUMN IF NOT EXISTS`, commits, not retried); `upsert_qb_weekly_stats` writes both columns; `process_season` calls `ensure_qb_weekly_stats_columns(conn)` right after `ensure_qb_weekly_stats_table(conn)`.

- [ ] **Step 1: Write the failing tests**

Create `tests/test_qb_rushing_epa.py`:

```python
"""QB rushing EPA/carry and success rate on qb_weekly_stats — box score spec §10.1.

Both are computed over exactly the carries rush_attempts counts: designed runs
plus scrambles, kneels excluded.
"""
import math
import re

import pandas as pd
import pytest
from pytest import approx

ALLEN = '00-0034857'
STROUD = '00-0039163'


def _roster(*ids):
    return pd.DataFrame([{'gsis_id': pid, 'position': 'QB'} for pid in ids])


class _FakeCursor:
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql, *args):
        pass


class _FakeConn:
    def __init__(self):
        self.commits = 0

    def cursor(self):
        return _FakeCursor()

    def commit(self):
        self.commits += 1


class TestSyntheticQB:
    def test_one_designed_run_and_one_scramble(self, raw):
        """Designed run +0.4 (success) and scramble -0.6 (failure): 2 carries, -0.10 EPA/carry, 50%.
        Designed runs alone would give +0.40 and 100% over 1 carry — no longer the 2 carries shown."""
        from ingest import aggregate_qb_weekly_stats
        plays = raw.game(raw.play(), raw.rush(6.0, rusher_player_id='QB1', epa=0.4, success=1.0),
                         raw.scramble(7.0, epa=-0.6, success=0.0))
        row = aggregate_qb_weekly_stats(plays, _roster('QB1'), 2026).iloc[0]
        assert row['rush_attempts'] == 2
        assert row['rush_epa_per_carry'] == approx(-0.1)
        assert row['rush_success_rate'] == approx(0.5)

    def test_no_carries_is_null_not_nan(self, raw):
        from ingest import aggregate_qb_weekly_stats
        row = aggregate_qb_weekly_stats(raw.game(raw.play(), raw.play()), _roster('QB1'), 2026).iloc[0]
        assert row['rush_attempts'] == 0
        assert row['rush_epa_per_carry'] is None
        assert row['rush_success_rate'] is None

    def test_kneels_stay_out(self, raw):
        """A kneel is not a carry in the QB tables (MEMORY.md kneel fix), so it cannot drag EPA/carry down."""
        from ingest import aggregate_qb_weekly_stats
        plays = raw.game(raw.play(), raw.rush(6.0, rusher_player_id='QB1', epa=0.4, success=1.0),
                         raw.kneel(), raw.kneel())
        row = aggregate_qb_weekly_stats(plays, _roster('QB1'), 2026).iloc[0]
        assert row['rush_attempts'] == 1
        assert row['rush_epa_per_carry'] == approx(0.4)
        assert row['rush_success_rate'] == approx(1.0)

    def test_two_qbs_are_kept_apart(self, raw):
        from ingest import aggregate_qb_weekly_stats
        plays = raw.game(raw.play(passer_player_id='QB1'), raw.rush(3.0, rusher_player_id='QB1', epa=-0.5, success=0.0),
                         raw.play(passer_player_id='QB2', posteam='BUF', defteam='KC'),
                         raw.scramble(11.0, rusher_player_id='QB2', posteam='BUF', defteam='KC', epa=1.2, success=1.0))
        out = aggregate_qb_weekly_stats(plays, _roster('QB1', 'QB2'), 2026).set_index('player_id')
        assert out.loc['QB1', 'rush_epa_per_carry'] == approx(-0.5)
        assert out.loc['QB1', 'rush_success_rate'] == approx(0.0)
        assert out.loc['QB2', 'rush_epa_per_carry'] == approx(1.2)
        assert out.loc['QB2', 'rush_success_rate'] == approx(1.0)


class TestFixtureQBs:
    def test_allen_and_stroud_week_one(self, pbp_fixture):
        """Allen: 5 carries (4 designed + 1 scramble) -> -0.46, 40%. Stroud: 2 (1 + 1) -> +0.73, 50%."""
        from ingest import aggregate_qb_weekly_stats, filter_plays
        plays = filter_plays(pbp_fixture[pbp_fixture['game_id'] == '2026_01_BUF_HOU'])
        out = aggregate_qb_weekly_stats(plays, _roster(ALLEN, STROUD), 2026).set_index('player_id')
        assert out.loc[ALLEN, 'rush_attempts'] == 5
        assert out.loc[ALLEN, 'rush_epa_per_carry'] == approx(-0.4626, abs=5e-5)
        assert out.loc[ALLEN, 'rush_success_rate'] == approx(0.40, abs=0.005)
        assert out.loc[STROUD, 'rush_attempts'] == 2
        assert out.loc[STROUD, 'rush_epa_per_carry'] == approx(0.7312, abs=5e-5)
        assert out.loc[STROUD, 'rush_success_rate'] == approx(0.50, abs=0.005)
        # Designed runs alone would be Allen -1.17 / 25% over 4 plays (spec §10.1)
        assert out.loc[ALLEN, 'rush_epa_per_carry'] != approx(-1.17, abs=0.05)

    def test_existing_columns_unchanged(self, pbp_fixture):
        from ingest import aggregate_qb_weekly_stats, filter_plays
        plays = filter_plays(pbp_fixture[pbp_fixture['game_id'] == '2026_01_BUF_HOU'])
        out = aggregate_qb_weekly_stats(plays, _roster(ALLEN, STROUD), 2026).set_index('player_id')
        assert (out.loc[ALLEN, 'completions'], out.loc[ALLEN, 'attempts']) == (20, 29)
        assert (out.loc[STROUD, 'completions'], out.loc[STROUD, 'attempts']) == (26, 38)
        assert out.loc[ALLEN, 'rush_tds'] == 2


class TestSchemaAndUpsert:
    def test_ensure_columns_adds_both_and_commits(self):
        import ingest
        statements = []

        class Cur(_FakeCursor):
            def execute(self, sql, *args):
                statements.append(sql)

        class Conn(_FakeConn):
            def cursor(self):
                return Cur()

        conn = Conn()
        ingest.ensure_qb_weekly_stats_columns(conn)
        ddl = ' '.join(statements)
        assert 'ALTER TABLE qb_weekly_stats ADD COLUMN IF NOT EXISTS rush_epa_per_carry NUMERIC' in ddl
        assert 'ALTER TABLE qb_weekly_stats ADD COLUMN IF NOT EXISTS rush_success_rate NUMERIC' in ddl
        assert conn.commits == 1

    def test_upsert_writes_the_new_columns_and_null_for_no_carries(self, monkeypatch, raw):
        import ingest
        from ingest import aggregate_qb_weekly_stats, upsert_qb_weekly_stats
        captured = {}

        def fake_execute_values(cur, sql, rows):
            captured['sql'] = sql
            captured['rows'] = rows

        monkeypatch.setattr(ingest, 'execute_values', fake_execute_values)
        plays = raw.game(raw.play(passer_player_id='QB1'), raw.scramble(9.0, rusher_player_id='QB1', epa=0.8, success=1.0),
                         raw.play(passer_player_id='QB2', posteam='BUF', defteam='KC'))
        df = aggregate_qb_weekly_stats(plays, _roster('QB1', 'QB2'), 2026)
        upsert_qb_weekly_stats(_FakeConn(), df)

        cols = [c.strip() for c in
                re.search(r'INSERT INTO qb_weekly_stats \(([^)]*)\)', captured['sql']).group(1).split(',')]
        assert 'rush_epa_per_carry' in cols and 'rush_success_rate' in cols
        assert 'rush_epa_per_carry = EXCLUDED.rush_epa_per_carry' in captured['sql']
        assert 'rush_success_rate = EXCLUDED.rush_success_rate' in captured['sql']
        by_id = {r[cols.index('player_id')]: dict(zip(cols, r)) for r in captured['rows']}
        assert by_id['QB1']['rush_epa_per_carry'] == approx(0.8)
        assert by_id['QB1']['rush_success_rate'] == approx(1.0)
        assert by_id['QB2']['rush_epa_per_carry'] is None
        assert by_id['QB2']['rush_success_rate'] is None
        flat = [v for r in captured['rows'] for v in r]
        assert not any(isinstance(v, float) and math.isnan(v) for v in flat)
```

- [ ] **Step 2: Run the file to see it fail**

```bash
PYTHONDONTWRITEBYTECODE=1 py -3 -m pytest "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass/tests/test_qb_rushing_epa.py" -q -p no:cacheprovider
```

Expected: 8 failures — `KeyError: 'rush_epa_per_carry'` from the aggregation tests, `AttributeError: module 'ingest' has no attribute 'ensure_qb_weekly_stats_columns'`, and the upsert test failing on `'rush_epa_per_carry' in cols`.

- [ ] **Step 3: Compute the two columns in `aggregate_qb_weekly_stats`**

In `scripts/ingest.py`, inside `aggregate_qb_weekly_stats`, replace the whole block that starts with the line `    # --- Rush stats per game (designed runs + scrambles) ---` and ends with the line `    qb_game['rush_tds'] = qb_game['rush_tds'] + qb_game['scr_tds']` (the next non-blank line after it is `    # --- Fumbles per game ---`) with:

```python
    # --- Rush stats per game (designed runs + scrambles) ---
    # qb_plays, so victory-formation kneels do not land in the game log.
    designed_rushes = qb_plays[
        (qb_plays['rusher_player_id'].isin(qb_ids)) &
        (qb_plays['qb_dropback'] == 0)
    ].copy()
    # A success on a carry the count sees: rush_attempts counts non-null-EPA
    # rows, so the flag is restricted to those same rows (box score spec §10.1).
    designed_rushes['rush_succ'] = (
        (designed_rushes['success'] == 1) & designed_rushes['epa'].notna()
    ).astype(int)

    rush_game = designed_rushes.groupby(['rusher_player_id', 'game_id']).agg(
        rush_attempts=('epa', 'count'),
        rush_yards=('rushing_yards', lambda s: s.fillna(0).sum()),
        rush_tds=('rush_touchdown', 'sum'),
        rush_epa_sum=('epa', 'sum'),
        rush_succ=('rush_succ', 'sum'),
    ).reset_index().rename(columns={'rusher_player_id': 'passer_player_id'})

    # Scramble rush stats per game
    scramble_plays = dropbacks[dropbacks['qb_scramble'] == 1].copy()
    scramble_plays['rush_succ'] = (
        (scramble_plays['success'] == 1) & scramble_plays['epa'].notna()
    ).astype(int)
    scramble_game = scramble_plays.groupby(['passer_player_id', 'game_id']).agg(
        scr_count=('epa', 'count'),
        scr_yards=('rushing_yards', lambda s: s.fillna(0).sum()),
        scr_tds=('rush_touchdown', 'sum'),
        scr_epa_sum=('epa', 'sum'),
        scr_succ=('rush_succ', 'sum'),
    ).reset_index()

    qb_game = qb_game.merge(rush_game, on=['passer_player_id', 'game_id'], how='left')
    qb_game = qb_game.merge(scramble_game, on=['passer_player_id', 'game_id'], how='left')

    for col in ['rush_attempts', 'rush_yards', 'rush_tds', 'scr_count', 'scr_yards', 'scr_tds',
                'rush_succ', 'scr_succ']:
        qb_game[col] = qb_game[col].fillna(0).astype(int)
    for col in ['rush_epa_sum', 'scr_epa_sum']:
        qb_game[col] = qb_game[col].fillna(0.0)

    qb_game['rush_attempts'] = qb_game['rush_attempts'] + qb_game['scr_count']
    qb_game['rush_yards'] = qb_game['rush_yards'] + qb_game['scr_yards']
    qb_game['rush_tds'] = qb_game['rush_tds'] + qb_game['scr_tds']

    # Rush EPA/carry and success rate over exactly the carries rush_attempts
    # counts — designed runs plus scrambles (box score spec §10.1). None (SQL
    # NULL, never NaN) for a game with no carries.
    # dtype=object keeps the None: a plain list of floats and None becomes a
    # float64 column with NaN, which upsert_qb_weekly_stats' .where() cannot
    # turn back into NULL.
    rush_epa_total = qb_game['rush_epa_sum'] + qb_game['scr_epa_sum']
    rush_succ_total = qb_game['rush_succ'] + qb_game['scr_succ']
    qb_game['rush_epa_per_carry'] = pd.Series([
        float(e) / int(n) if n > 0 else None
        for e, n in zip(rush_epa_total, qb_game['rush_attempts'])
    ], index=qb_game.index, dtype=object)
    qb_game['rush_success_rate'] = pd.Series([
        float(s) / int(n) if n > 0 else None
        for s, n in zip(rush_succ_total, qb_game['rush_attempts'])
    ], index=qb_game.index, dtype=object)
```

- [ ] **Step 4: Add the columns to the aggregator's output**

Still in `aggregate_qb_weekly_stats`, the `cols` list ends:

```python
        'rush_attempts', 'rush_yards', 'rush_tds',
        'fumbles', 'fumbles_lost',
    ]
    result = qb_game[cols].copy()
```

Change it to:

```python
        'rush_attempts', 'rush_yards', 'rush_tds',
        'rush_epa_per_carry', 'rush_success_rate',
        'fumbles', 'fumbles_lost',
    ]
    result = qb_game[cols].copy()
```

- [ ] **Step 5: Add `ensure_qb_weekly_stats_columns`**

`ensure_qb_weekly_stats_table` ends with `    log.info("Ensured qb_weekly_stats table exists with RLS")`. Directly after that line add two blank lines and:

```python
def ensure_qb_weekly_stats_columns(conn):
    """Add QB rushing EPA/success columns to qb_weekly_stats (idempotent). NOT inside @retry.
    ensure_qb_weekly_stats_table is CREATE TABLE IF NOT EXISTS only, so it cannot
    add columns to the table that already exists in production (box score spec §10.1)."""
    with conn.cursor() as cur:
        for col, typ in [
            ('rush_epa_per_carry', 'NUMERIC'),
            ('rush_success_rate', 'NUMERIC'),
        ]:
            cur.execute(f"ALTER TABLE qb_weekly_stats ADD COLUMN IF NOT EXISTS {col} {typ};")
    conn.commit()
    log.info("Ensured qb_weekly_stats has rush_epa_per_carry/rush_success_rate columns")
```

- [ ] **Step 6: Write the columns in `upsert_qb_weekly_stats`**

Its `cols` list ends:

```python
        'rush_attempts', 'rush_yards', 'rush_tds',
        'fumbles', 'fumbles_lost',
    ]
    clean_df = df[cols].where(df[cols].notna(), None)
```

Change it to:

```python
        'rush_attempts', 'rush_yards', 'rush_tds',
        'rush_epa_per_carry', 'rush_success_rate',
        'fumbles', 'fumbles_lost',
    ]
    clean_df = df[cols].where(df[cols].notna(), None)
```

(`.where(notna, None)` keeps `None` in an object column — that is why Step 3 builds the columns with `dtype=object`.)

- [ ] **Step 7: Call it from `process_season`, and assert the order in the wiring test**

In `process_season`'s `ensure_*` block, after

```python
    ensure_qb_weekly_stats_table(conn)
```

add

```python
    ensure_qb_weekly_stats_columns(conn)
```

Then in `tests/test_team_game_stats_pipeline.py`, inside `test_full_run_aggregates_raw_pbp_ensures_upserts_and_cleans_up`, directly after the line

```python
        assert names.index('ensure_team_game_stats_table') < names.index('upsert_team_game_stats')
```

add

```python
        assert names.index('ensure_qb_weekly_stats_table') < names.index('ensure_qb_weekly_stats_columns') < names.index('upsert_qb_weekly_stats')
```

- [ ] **Step 8: Run the new file, the existing QB weekly tests and the wiring test**

```bash
PYTHONDONTWRITEBYTECODE=1 py -3 -m pytest "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass/tests/test_qb_rushing_epa.py" "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass/tests/test_weekly_stats.py" "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass/tests/test_team_game_stats_pipeline.py" -q -p no:cacheprovider
```

Expected: `46 passed` (8 new + 29 existing weekly + 9 pipeline).

- [ ] **Step 9: Run the whole suite**

```bash
PYTHONDONTWRITEBYTECODE=1 py -3 -m pytest "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass/tests" -q -p no:cacheprovider
```

Expected: `443 passed, 2 xfailed`.

- [ ] **Step 10: Commit**

```bash
git -C "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" add scripts/ingest.py tests/test_qb_rushing_epa.py tests/test_team_game_stats_pipeline.py
```

```bash
git -C "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" commit -m "feat: QB rushing EPA/carry and success rate on qb_weekly_stats" -m "Computed over exactly the carries rush_attempts counts (designed runs plus scrambles, kneels excluded), NULL for a game with no carries. Columns added with ALTER TABLE ... ADD COLUMN IF NOT EXISTS via ensure_qb_weekly_stats_columns and written by upsert_qb_weekly_stats. Week 1: Allen 5 carries -> -0.46 / 40%, Stroud 2 -> +0.73 / 50% (box score spec section 10.1)." -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 6: Whole-week smoke check over the full nflverse file

**Files:**
- Test: `tests/test_team_game_stats_smoke.py` (create)
- Scratch (not committed): `<your scratchpad>/play_by_play_2026.parquet`

**Interfaces:**
- Consumes: `aggregate_team_game_stats`, `TEAM_GAME_STATS_INT_COLS`, `TEAM_GAME_STATS_RATE_COLS` (Task 2).
- Produces: a test module gated on the `YPP_PBP_PARQUET` environment variable. Without it every test is SKIPPED (CI has no network and the file grows weekly); with it the week-1 facts in spec §4/§5 are checked and every game in the file must aggregate without exceptions or NaN.

- [ ] **Step 1: Create the test module**

```python
"""Whole-season smoke check of aggregate_team_game_stats over a full nflverse
play-by-play file (no database). Skipped unless YPP_PBP_PARQUET points at a
local copy of play_by_play_2026.parquet:

    https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_2026.parquet

CI never sets it (no network, and the file grows every week). The week-1
facts below come from the box score spec; nflverse can revise past weeks, so
if one fails on a fresh download, check the spec's numbers before the code.
"""
import os

import pandas as pd
import pytest

PATH = os.environ.get('YPP_PBP_PARQUET')

pytestmark = pytest.mark.skipif(not PATH, reason='set YPP_PBP_PARQUET to a full play_by_play_2026.parquet')

NO_DET = '2026_01_NO_DET'


@pytest.fixture(scope='module')
def full_pbp():
    return pd.read_parquet(PATH)


@pytest.fixture(scope='module')
def week_one(full_pbp):
    from ingest import aggregate_team_game_stats
    return aggregate_team_game_stats(full_pbp[full_pbp['week'] == 1], 2026)


class TestWeekOne:
    def test_one_row_per_team_per_game(self, week_one):
        assert len(week_one) == 32
        assert week_one['game_id'].nunique() == 16
        assert week_one['team_id'].nunique() == 32
        assert week_one.groupby('game_id').size().eq(2).all()

    def test_no_nulls_anywhere_in_a_full_week(self, week_one):
        from ingest import TEAM_GAME_STATS_INT_COLS
        assert not week_one.isna().any().any()
        for col in TEAM_GAME_STATS_INT_COLS + ['season', 'week']:
            assert str(week_one[col].dtype).startswith('int'), col

    def test_spec_week_one_facts(self, week_one):
        assert week_one['explosive_plays'].sum() == 182          # 163 without the scramble clause
        top = week_one.groupby('game_id')['time_of_possession_seconds'].sum()
        assert top.drop(NO_DET).eq(3600).all()
        assert top[NO_DET] == 68 * 60 + 26
        short = week_one[week_one['early_plays'] + week_one['late_plays'] < week_one['plays']]
        assert set(short['team_id']) == {'BUF', 'MIN', 'NO', 'WAS'}  # each had a 2-point try
        assert week_one['def_st_tds'].sum() == 3
        assert week_one['total_drives'].sum() == 354
        buf_hou = week_one[week_one['game_id'] == '2026_01_BUF_HOU'].set_index('team_id')
        assert buf_hou.loc['BUF', 'team_targets'] == 28 and buf_hou.loc['HOU', 'team_targets'] == 37


class TestWholeFile:
    def test_every_played_game_aggregates_cleanly(self, full_pbp):
        from ingest import aggregate_team_game_stats, TEAM_GAME_STATS_INT_COLS, TEAM_GAME_STATS_RATE_COLS
        out = aggregate_team_game_stats(full_pbp, 2026)
        reg_games = full_pbp.loc[full_pbp['season_type'] == 'REG', 'game_id'].nunique()
        assert len(out) == 2 * reg_games
        assert not out[TEAM_GAME_STATS_INT_COLS + ['season', 'week']].isna().any().any()
        # A rate is NULL only when its denominator is 0
        assert out.loc[out['epa_per_play'].isna(), 'plays'].eq(0).all()
        assert out.loc[out['rush_epa_per_play'].isna(), 'rush_plays'].eq(0).all()
        assert out.loc[out['pass_epa_per_play'].isna(), 'pass_plays'].eq(0).all()
        assert out.loc[out['yards_per_play'].isna(), 'total_plays'].eq(0).all()
        assert (out['time_of_possession_seconds'] > 0).all()
```

- [ ] **Step 2: Confirm it skips without the variable (what CI will see)**

```bash
PYTHONDONTWRITEBYTECODE=1 py -3 -m pytest "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass/tests/test_team_game_stats_smoke.py" -q -p no:cacheprovider -rs
```

Expected: `4 skipped`, each with the reason `set YPP_PBP_PARQUET to a full play_by_play_2026.parquet`.

- [ ] **Step 3: Download the current nflverse file into your scratchpad**

```bash
curl -L -o "<your scratchpad>/play_by_play_2026.parquet" https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_2026.parquet
```

(If you already downloaded it in Task 1 Step 2, reuse that file.) nflverse uploads with `--clobber`, so the URL can 404 for a few seconds; retry once if it does.

- [ ] **Step 4: Run the smoke check for real**

```bash
PYTHONDONTWRITEBYTECODE=1 YPP_PBP_PARQUET="<your scratchpad>/play_by_play_2026.parquet" py -3 -m pytest "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass/tests/test_team_game_stats_smoke.py" -q -p no:cacheprovider
```

Expected: `4 passed`. The file may by now hold week 2 as well; `TestWeekOne` filters to week 1 and `TestWholeFile` accepts any number of games. If `test_spec_week_one_facts` fails on a freshly downloaded file while the committed fixture's tests (Tasks 2–3) still pass, nflverse has revised week-1 rows: report the difference rather than editing the numbers (they are the spec's).

- [ ] **Step 5: Run the whole suite with and without the variable**

```bash
PYTHONDONTWRITEBYTECODE=1 YPP_PBP_PARQUET="<your scratchpad>/play_by_play_2026.parquet" py -3 -m pytest "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass/tests" -q -p no:cacheprovider
```

Expected: `447 passed, 2 xfailed`.

```bash
PYTHONDONTWRITEBYTECODE=1 py -3 -m pytest "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass/tests" -q -p no:cacheprovider
```

Expected: `443 passed, 4 skipped, 2 xfailed` — this is the CI outcome.

- [ ] **Step 6: Commit**

```bash
git -C "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" add tests/test_team_game_stats_smoke.py
```

```bash
git -C "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" commit -m "test: whole-file smoke check for team_game_stats (opt-in via YPP_PBP_PARQUET)" -m "32 week-1 rows, no NaN, 182 explosives with scrambles, possession sums to 60:00 (68:26 in NO-DET), 354 drives, 3 defensive TDs, and every game in the file aggregates cleanly. Skipped in CI." -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 7: Chaos test

**Files:** none committed by the chaos agent (it works in throwaway test files under `tests/chaos/` and deletes them). Fixes land in `scripts/ingest.py` with a regression test in the matching test file from Tasks 2–6.

**Interfaces:** Consumes the finished Tasks 1–6.

- [ ] **Step 1: Dispatch the chaos agent**

Use the Agent tool (`general-purpose`) with this prompt:

```text
You are a chaos tester for the Yards Per Pass repo at
C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass
(branch box-scores-pr2). Try to BREAK the new box-score pipeline code in
scripts/ingest.py. Do not modify source files. Write throwaway pytest files under
tests/chaos/ (delete them when done) and run them with:
PYTHONDONTWRITEBYTECODE=1 py -3 -m pytest "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass/tests/chaos" -q -p no:cacheprovider
Run every command separately (never chain with && or ||). Never set DATABASE_URL,
never connect to any database, never print the contents of .env.local.

What changed (read these first):
- scripts/ingest.py: aggregate_team_game_stats(pbp, season) and its helpers
  (_team_game_frame/_team_game_efficiency/_team_game_costs/_team_game_traditional/
  _team_game_targets, _ratio, _top_seconds), TEAM_GAME_STATS_* constants,
  ensure_team_game_stats_table, upsert_team_game_stats, cleanup_stale_rows(game_ids=),
  process_season wiring, aggregate_qb_weekly_stats (rush_epa_per_carry,
  rush_success_rate), ensure_qb_weekly_stats_columns, upsert_qb_weekly_stats cols.
- tests/conftest.py: the `raw` fixture (RawPlays builders for synthetic raw rows),
  pbp_fixture (567 real rows of 3 games), team_game_rows.
- tests/test_team_game_stats.py, tests/test_team_game_stats_pipeline.py,
  tests/test_qb_rushing_epa.py show how to build inputs and fake a psycopg2
  connection (monkeypatch ingest.execute_values; never call the real one).

Rules the code must keep: counts/yards are 0 when a team had none; the 17 rate
columns and time_of_possession_seconds are None (never NaN) when undefined;
every value handed to execute_values is int/float/str/None (no numpy scalars,
no NaN); one row per team per REG game, both teams even if one never had the
ball; nothing raises on a well-formed but empty or odd frame.

Cases (add any others you think of):
1. Empty inputs: pd.DataFrame(); a frame with the right columns and 0 rows; a
   frame with only the game-start row (all NaN); a game with no plays yet (only
   kickoff/END rows); a file with only POST rows.
2. Zero attempts: a team with 0 pass attempts, 0 rush attempts, 0 drives, only
   kneels, only 2-pt tries, only no_play rows; both teams with no plays.
3. Nulls/NaN/pd.NA in every column the code reads, one column at a time
   (posteam, defteam, home_team, away_team, week, drive, down, yardline_100, epa,
   success, yards_gained, complete_pass, pass/rush flags, fumbled_1_team,
   penalty_team, penalty_yards, td_team, kickoff_attempt, drive_time_of_possession,
   receiver_player_id, season_type); a whole column of None objects; week as a
   float; posteam that is neither home_team nor away_team; home_team == away_team.
4. drive_time_of_possession oddities: '', 'junk', '1:2:3', '12:60', '-1:00',
   '0:00', 90 (an int), NaN on some drives of a team and not others.
5. Overtime (rows with qtr 5 and TOP beyond 60:00), a tie game, negative yards,
   a 99-yard play, yards_gained as strings (report as ERROR if it crashes, that
   is bad data), duplicate rows, rows out of order, two games in one frame with
   the same teams (a reschedule), a team abbreviation not in TEAM_NAMES (e.g. 'LA'
   vs 'LAR' - both exist there; try 'XYZ').
6. Huge seasons: replicate the fixture's three games 100x with distinct game_ids
   (300 games, ~57k rows) and time aggregate_team_game_stats (report seconds);
   1,000 game ids into cleanup_stale_rows(game_ids=...) (assert the SQL params
   carry them all); upsert_team_game_stats with 0, 1 and 600 rows.
7. QB weekly: a QB with a designed run whose epa is NaN (rush_attempts must not
   count it and EPA/carry must not be NaN); scramble with rusher_player_id NaN;
   a kneel-only QB; a QB with 0 dropbacks but 1 designed run (no row today - is
   that a crash or a documented gap?); rush_success_rate when success is NaN.
8. process_season(2026, None, dry_run=True) with download_* monkeypatched to the
   fixture and a 1-QB roster, NOT stubbing the other aggregators: does the whole
   real pipeline run on the 51-column fixture, or does another aggregator need a
   column the fixture lacks? (Either way: PASS if it fails only because the
   fixture is intentionally narrow; report which column.)
9. pandas-2 hazards (you cannot run pandas 2.2.3 locally; inspect the code):
   any chained assignment, any groupby.apply, any dependence on the pandas 3
   `str` dtype, any `.where(cond, None)` on a float column expected to yield None.
   Report each as DEGRADED with file:line.

For each case report exactly one of CRASH (raises), ERROR (wrong value a page
would show, or NaN/numpy reaching execute_values), DEGRADED (acceptable but
worth noting), PASS - with the input, what happened, and file:line of the
cause. End with the list of CRASH and ERROR findings only. Delete tests/chaos/
before finishing and confirm `git status` shows no untracked chaos files.
```

- [ ] **Step 2: Fix every CRASH and ERROR**

For each finding: add a failing regression test to the matching file (`tests/test_team_game_stats.py` for aggregation, `tests/test_team_game_stats_pipeline.py` for DDL/upsert/cleanup/wiring, `tests/test_qb_rushing_epa.py` for QB rushing), run that file to see it fail, make the smallest fix in `scripts/ingest.py`, run it again. DEGRADED findings that match this plan's documented behaviour (the two xfails, the narrow fixture, NULL rates) need no change; note the rest in the PR description.

- [ ] **Step 3: Re-verify and commit the fixes (skip if there were none)**

Run the whole suite (Task 6 Step 5, both commands); all must pass with the same counts plus your regression tests. Stage only the files you changed, by name, for example:

```bash
git -C "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" add scripts/ingest.py tests/test_team_game_stats.py
```

```bash
git -C "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" commit -m "fix: harden team_game_stats against chaos-test findings" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 8: Code review

**Files:** whatever the accepted findings touch, with tests.

**Interfaces:** Consumes the branch after Task 7.

This is a pipeline feature with no page yet, so it follows the week-1 audit process in `memory/MEMORY.md` (one code review), not the 47-team `/review-feature` roster — that roster runs when PR 3 puts the numbers on a page.

- [ ] **Step 1: Request the review**

Use the superpowers:requesting-code-review skill with base `origin/main` and head `box-scores-pr2`. Give the reviewer spec §4, §5, §10.1 and §11 plus this plan's Global Constraints as the requirements, and ask it to check specifically:

- `process_season` passes the **raw** `pbp` frame (not `plays`) to `aggregate_team_game_stats`; `ensure_team_game_stats_table` and `ensure_qb_weekly_stats_columns` run before the `try:` and commit themselves; the upsert and cleanup run inside it; `cleanup_stale_rows` keeps the empty-list guard.
- No NaN and no numpy scalar can reach `execute_values` from `upsert_team_game_stats`; `rush_epa_per_carry`/`rush_success_rate` survive `upsert_qb_weekly_stats`' `.where(notna, None)` as `None`.
- Every rule matches spec §4 word for word (efficiency filter, 2-pt kept, scramble clause, `fumbled_1_team` attribution, own-penalties sign flip, sack yards positive, sum-of-parts first downs, drive-level red zone, `drive` not `fixed_drive`, `team_targets` = the receiver aggregator's set), and the three documented departures are the only ones (kickoff clause in `def_st_tds`, `qb_spike` as a scrimmage snap, muffed-punt xfail).
- pandas 2.2.3 compatibility: no pandas-3-only API, no chained assignment, no `str`-dtype assumption, no `groupby.apply`; the fixture has no pandas metadata.
- No committed file references a scratchpad path; `REQUIRED_PBP_COLS` lists every raw column the new code reads; nothing outside the listed functions was refactored.

- [ ] **Step 2: Address the findings**

Use superpowers:receiving-code-review. Fix Critical and Important findings with a failing test first; for anything you decline, record why in the PR description.

- [ ] **Step 3: Re-verify and commit (skip if nothing changed)**

Run the whole suite (Task 6 Step 5, both commands); all must pass. Stage only the files you changed, by name, then:

```bash
git -C "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" commit -m "fix: address code review on team_game_stats" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 9: Record it in memory and project docs

**Files:**
- Modify: `memory/MEMORY.md` (test count on line 49; new section after "Game Log scores (box scores Phase 0)", which ends at line 69)
- Modify: `.claude/CLAUDE.md` (line 50, the table count)

- [ ] **Step 1: Update the test count in `memory/MEMORY.md`**

Line 49 reads:

```markdown
- Frontend tests: `npx vitest run` (413 tests / 24 files after the 2026-09-14 homepage-resilience change). Python: `py -3 -m pytest tests/ -q` (262 tests).
```

Change the Python part so the line ends:

```markdown
Python: `py -3 -m pytest tests/ -q` (449 tests: 443 pass, 4 skip without `YPP_PBP_PARQUET`, 2 strict xfails).
```

- [ ] **Step 2: Add the new section**

Insert after line 69 (`- Tests: \`__tests__/data/games.test.ts\`, \`__tests__/components/GameLogTab.test.tsx\`, \`__tests__/app/player-route.test.ts\`.`) and before `## Known debt (2026-09-05)`:

```markdown

## team_game_stats + QB rushing EPA (box scores PR 2)

- **`team_game_stats`** (14th table): one row per team per played REG game, key `(game_id, team_id)` + `season, week, opponent_id, home_away`; the 62 columns are `TEAM_GAME_STATS_COLS` in `scripts/ingest.py`. Built by `aggregate_team_game_stats(pbp, season)` from the **RAW** pbp frame (never `filter_plays` output — possession, drives, penalties and red zone need kicking and `no_play` rows). Efficiency set = `pass == 1 | rush == 1` with EPA present (2-pt KEPT, kneels drop out, penalty-wiped passes stay in with 0 yards); traditional set = official ESPN conventions (spec §4). Every column is pinned against rbsdm/ESPN for `2026_01_BUF_HOU` in `tests/test_team_game_stats.py` — never edit a `GOLD` value to make a test pass.
- **Three play counts disagree on purpose**: efficiency plays (BUF 56) ≠ total plays (52 = rush att + pass att + sacks) ≠ rush plays (19) beside rushing attempts (21 = 19 + 1 kneel + 1 scramble). `first_downs` is the SUM of pass/rush/penalty parts (one play can be both), `sack_yards` is stored POSITIVE, `time_of_possession_seconds` sums `drive_time_of_possession` once per `drive` (never `fixed_drive`), `team_targets` is exactly the receiver aggregator's target set (the TGT% denominator).
- **NULL policy**: counts/yards 0, `epa_lost_*` 0.0, the 17 rate columns (`TEAM_GAME_STATS_RATE_COLS`) None when the denominator is 0, `time_of_possession_seconds` None only for a team with drives but no clock. Those columns are built as `dtype=object` Series so None survives (a list of floats + None becomes float64/NaN → `'NaN'::numeric`); `upsert_team_game_stats` converts NaN→None and numpy→Python itself (same reasoning as `ingest_schedules`).
- **Known limitations (strict xfails in `tests/test_team_game_stats.py`)**: turnovers are keyed by `posteam`, so a punt the RECEIVING team muffs (`2026_01_CHI_CAR`) is credited to nobody; a pick plus a separate lost fumble on one snap (`2025_14_PHI_LAC`) counts 1. `def_st_tds` adds a `kickoff_attempt == 1` clause to the spec's `td_team != posteam` rule because nflverse puts the receiving team in `posteam` on kickoffs; `qb_spike` counts as a scrimmage snap for 3rd/4th down and red zone.
- `cleanup_stale_rows(..., game_ids=)` deletes `team_game_stats` rows whose game id is missing from the file (reschedules). `ensure_team_game_stats_table` runs with the other `ensure_*` calls (own commit, before the transaction). `game_id` has no FK to `games` on purpose (the schedules ingest may fail with a warning).
- **QB rushing on `qb_weekly_stats`**: `rush_epa_per_carry` / `rush_success_rate` over exactly the carries `rush_attempts` counts (designed runs + scrambles, kneels out); NULL for a game with no carries. Columns added by `ensure_qb_weekly_stats_columns` (`ALTER TABLE … ADD COLUMN IF NOT EXISTS`). Week 1: Allen 5 carries → −0.46 / 40%, Stroud 2 → +0.73 / 50%. 2020–2025 rows stay NULL until the backfill.
- Fixture: `tests/fixtures/pbp_2026_week1_games.parquet` — 567 raw rows × 51 columns (BUF_HOU, NO_DET overtime with TOP 68:26, TB_CIN pick-six each way), no pandas metadata, loaded by `tests/conftest.py`; synthetic raw rows come from the `raw` fixture (`RawPlays.play/rush/scramble/kneel/sack/no_play/kick/game`). `tests/test_team_game_stats_smoke.py` runs the whole nflverse file only when `YPP_PBP_PARQUET` is set (skipped in CI).
```

- [ ] **Step 3: Update `.claude/CLAUDE.md`**

Line 50 reads:

```markdown
- 13 Supabase tables total (teams, team_season_stats, qb_season_stats, receiver_season_stats, rb_season_stats, rb_gap_stats, rb_gap_stats_weekly, def_gap_stats, data_freshness, player_slugs, qb_weekly_stats, receiver_weekly_stats, rb_weekly_stats)
```

Change it to:

```markdown
- 14 Supabase tables total (teams, team_season_stats, qb_season_stats, receiver_season_stats, rb_season_stats, rb_gap_stats, rb_gap_stats_weekly, def_gap_stats, data_freshness, player_slugs, qb_weekly_stats, receiver_weekly_stats, rb_weekly_stats, team_game_stats)
```

- [ ] **Step 4: Check MEMORY.md is still under 200 lines**

```bash
wc -l "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass/memory/MEMORY.md"
```

Expected: about 121 lines (it was 111).

- [ ] **Step 5: Commit**

```bash
git -C "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" add memory/MEMORY.md .claude/CLAUDE.md
```

```bash
git -C "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" commit -m "docs: record team_game_stats, its NULL policy and known limitations" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 10: Ship, fill production, verify

**Files:** none in the repo. Scratch (not committed): `<your scratchpad>/pr-body.md`, `<your scratchpad>/verify_production.py`.

**Interfaces:** Consumes the merged branch; the `data-refresh.yml` workflow (`workflow_dispatch`, concurrency group `data-refresh`); the site's public REST API with the anon key from `.env.local`.

- [ ] **Step 1: Pre-flight**

```bash
git -C "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" status --short --branch
```

Expected: `## box-scores-pr2` with no modified or untracked files (a leftover `tests/chaos/` means Task 7 was not cleaned up).

```bash
git -C "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" log --oneline origin/main..box-scores-pr2
```

Expected: the plan commit plus Tasks 1–6 and 9 (and 7/8 fix commits if any). Then run the suite one last time (Task 6 Step 5's second command, no `YPP_PBP_PARQUET`): `443 passed, 4 skipped, 2 xfailed` plus any regression tests you added.

Check that a scheduled refresh is not about to collide with the fill (an in-progress run is fine — the dispatched run queues behind it; a run that started **before** the merge simply runs the old code):

```bash
gh run list --workflow data-refresh.yml --repo jonramz876/yards-per-pass --limit 3 --json status,conclusion,createdAt,event
```

- [ ] **Step 2: Push and open the PR**

```bash
git -C "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" push -u origin box-scores-pr2
```

Write the PR description to `<your scratchpad>/pr-body.md`. It must contain: what the PR adds (`team_game_stats`, one row per team per REG game, 62 columns; QB rushing EPA/carry + success rate on `qb_weekly_stats`; no frontend change — PR 3 reads the table); how the numbers are verified (every column pinned against rbsdm/ESPN for BUF–HOU, NO–DET possession 68:26, TB–CIN defensive TDs, Allen −0.46/40%, whole-week smoke: 32 rows, 182 explosives, 354 drives); the local results (pytest counts with and without `YPP_PBP_PARQUET`); the three documented departures from spec §4's literal text (kickoff clause, `qb_spike`, muffed-punt xfail) and the `game_id`-without-FK decision; the chaos and review outcomes with anything declined; the deploy note (the first refresh creates the table and adds the two columns; nothing on the site reads them yet); and it must end with:

```text
🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

Then, with that file's absolute path:

```bash
gh pr create --repo jonramz876/yards-per-pass --base main --head box-scores-pr2 --title "feat: team_game_stats + QB rushing EPA (box scores PR 2)" --body-file "<absolute path to pr-body.md>"
```

Note the PR number `<n>` it prints.

- [ ] **Step 3: Wait for CI**

Never use `gh pr checks --watch` (it has exited early on this repo). Poll in the background — Bash with `run_in_background: true`, or the Monitor tool with the same until-loop:

```bash
until [ "$(gh pr checks <n> --repo jonramz876/yards-per-pass --json bucket --jq 'map(select(.bucket == "pending")) | length')" = "0" ]; do sleep 60; done; gh pr checks <n> --repo jonramz876/yards-per-pass --json name,bucket
```

Expected when it finishes: `lint-and-build` and `test-python` both `"bucket":"pass"`. `test-python` is the pandas 2.2.3 / pyarrow 18.1.0 run — the only place that line is exercised. On a failure: `gh run view <run id from the checks output> --repo jonramz876/yards-per-pass --log-failed`, fix it with a test (a pandas-2 difference is the likely cause), re-run the suite locally, push, poll again.

- [ ] **Step 4: Merge**

```bash
gh pr merge <n> --repo jonramz876/yards-per-pass --merge
```

- [ ] **Step 5: Fill production**

```bash
gh workflow run data-refresh.yml --repo jonramz876/yards-per-pass --ref main
```

Wait a few seconds, then find the run:

```bash
gh run list --workflow data-refresh.yml --repo jonramz876/yards-per-pass --limit 1 --json databaseId,status,conclusion,event,createdAt
```

Expected: `"event":"workflow_dispatch"` (if the newest run is a scheduled one that started first, the dispatched run is queued behind it in the `data-refresh` concurrency group — list with `--limit 3` and take the `workflow_dispatch` id). Poll it in the background:

```bash
until [ "$(gh run view <run id> --repo jonramz876/yards-per-pass --json status --jq '.status')" = "completed" ]; do sleep 60; done; gh run view <run id> --repo jonramz876/yards-per-pass --json status,conclusion
```

Expected: `"conclusion":"success"`. Then read the log for the new lines:

```bash
gh run view <run id> --repo jonramz876/yards-per-pass --log | grep -E "team_game_stats|team game|rush_epa_per_carry|Season 2026 complete|ERROR|Traceback"
```

Expected lines: `Ensured qb_weekly_stats has rush_epa_per_carry/rush_success_rate columns`, `Ensured team_game_stats table exists with RLS`, `Aggregated team game stats for 32 team-games (16 games)` (34/17 once week 2's Thursday game is in), `Upserted 32 team game rows`, `Season 2026 complete (through week N)`; no `ERROR`, no `Traceback`.

- [ ] **Step 6: Verify with read-only REST reads**

Save this as `<your scratchpad>/verify_production.py` (it reads `.env.local` and never prints the key):

```python
"""Read-only check that production holds the team_game_stats and QB rushing
columns PR 2 added. Uses the site's anon key from .env.local through the
public REST API (the same read the site does) and NEVER prints it.

Usage:  py -3 verify_production.py "<repo path>"
"""
import json
import math
import os
import sys
import urllib.parse
import urllib.request

repo = sys.argv[1]
sys.path.insert(0, os.path.join(repo, 'scripts'))
sys.path.insert(0, os.path.join(repo, 'tests'))

env = {}
with open(os.path.join(repo, '.env.local'), encoding='utf-8') as fh:
    for line in fh:
        line = line.strip()
        if '=' in line and not line.startswith('#'):
            key, _, value = line.partition('=')
            env[key.strip()] = value.strip().strip('"').strip("'")
URL = env['NEXT_PUBLIC_SUPABASE_URL'].rstrip('/')
KEY = env['NEXT_PUBLIC_SUPABASE_ANON_KEY']


def get(table: str, **params) -> list:
    query = urllib.parse.urlencode(params)
    req = urllib.request.Request(f'{URL}/rest/v1/{table}?{query}',
                                 headers={'apikey': KEY, 'Authorization': f'Bearer {KEY}'})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode('utf-8'))


def num(v):
    return None if v is None else float(v)   # PostgREST sends NUMERIC as strings


problems = []

# 1. One row per team for every played 2026 REG game (32 for week 1; 34 once
#    week 2's Thursday game is in), and the id set matches `games` with scores.
rows = get('team_game_stats', season='eq.2026', select='*', order='game_id.asc,team_id.asc', limit=1000)
played = get('games', season='eq.2026', game_type='eq.REG', home_score='not.is.null',
             select='game_id,home_team,away_team', limit=1000)
expected_pairs = sorted((g['game_id'], t) for g in played for t in (g['away_team'], g['home_team']))
actual_pairs = sorted((r['game_id'], r['team_id']) for r in rows)
print(f'team_game_stats 2026 rows: {len(rows)} (played REG games in `games`: {len(played)})')
if len(rows) < 32:
    problems.append(f'expected at least 32 rows, got {len(rows)}')
if actual_pairs != expected_pairs:
    problems.append(f'row keys differ from played games: missing {sorted(set(expected_pairs) - set(actual_pairs))[:5]}, '
                    f'extra {sorted(set(actual_pairs) - set(expected_pairs))[:5]}')

# 2. The BUF-HOU rows equal what the committed fixture computes locally.
import pandas as pd
from ingest import aggregate_team_game_stats, TEAM_GAME_STATS_COLS
from conftest import FIXTURE_PATH
local = aggregate_team_game_stats(pd.read_parquet(FIXTURE_PATH), 2026)
local = local[local['game_id'] == '2026_01_BUF_HOU'].set_index('team_id')
live = {r['team_id']: r for r in rows if r['game_id'] == '2026_01_BUF_HOU'}
for team in ('BUF', 'HOU'):
    if team not in live:
        problems.append(f'no live row for 2026_01_BUF_HOU {team}')
        continue
    for col in TEAM_GAME_STATS_COLS:
        want = local.loc[team, col]
        got = live[team].get(col, 'MISSING')
        if got == 'MISSING':
            problems.append(f'{team}.{col}: column missing in production')
        elif isinstance(want, str) or col in ('game_id', 'team_id', 'opponent_id', 'home_away'):
            if got != want:
                problems.append(f'{team}.{col}: live {got!r} != local {want!r}')
        elif want is None or (isinstance(want, float) and math.isnan(want)):
            if got is not None:
                problems.append(f'{team}.{col}: live {got!r} != local NULL')
        elif got is None or abs(num(got) - float(want)) > 1e-6:
            problems.append(f'{team}.{col}: live {got!r} != local {want!r}')
print('BUF-HOU golden rows compared column by column against the fixture computation')

# 3. Allen's week-1 QB rushing columns.
allen = get('qb_weekly_stats', player_id='eq.00-0034857', season='eq.2026', week='eq.1',
            select='rush_attempts,rush_epa_per_carry,rush_success_rate')
if len(allen) != 1:
    problems.append(f'expected 1 Allen week-1 row, got {len(allen)}')
else:
    a = allen[0]
    print(f"Allen week 1: rush_attempts={a['rush_attempts']} rush_epa_per_carry={a['rush_epa_per_carry']} "
          f"rush_success_rate={a['rush_success_rate']}")
    if a['rush_attempts'] != 5 or abs(num(a['rush_epa_per_carry']) - (-0.4626)) > 0.005 \
            or abs(num(a['rush_success_rate']) - 0.4) > 0.005:
        problems.append(f'Allen rushing columns wrong: {a}')

if problems:
    print('PROBLEMS:')
    for p in problems:
        print(' -', p)
    sys.exit(1)
print('OK: production matches')
```

Run it (the repo's `main` must be checked out and up to date first, so the script's `from ingest import …` is the merged code):

```bash
git -C "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" switch main
```

```bash
git -C "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" pull --ff-only
```

```bash
py -3 "<your scratchpad>/verify_production.py" "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass"
```

Expected output:

```text
team_game_stats 2026 rows: 32 (played REG games in `games`: 16)
BUF-HOU golden rows compared column by column against the fixture computation
Allen week 1: rush_attempts=5 rush_epa_per_carry=-0.4626… rush_success_rate=0.4
OK: production matches
```

(34 rows / 17 games if week 2's Thursday game has been played and ingested; if `games` shows more played games than `team_game_stats` has rows, nflverse has not published those plays yet — re-run after the next refresh.) Exit code 1 with a `PROBLEMS:` list means production disagrees with the local computation: treat every line as a bug to explain before PR 3 starts.

- [ ] **Step 7: If the refresh failed**

1. Diagnose: `gh run view <run id> --repo jonramz876/yards-per-pass --log-failed`. `process_season` rolls the whole transaction back on any error (`Season 2026 FAILED — rolled back all changes`), so no table is half-written; `data_freshness` is not bumped, so the site's "Updated" line goes stale until a run succeeds. Likely causes: a DDL error in `ensure_team_game_stats_table` (it runs and commits before the transaction — the table may exist but be empty, which is harmless); `can't adapt type` from `execute_values` (a numpy scalar or NaN got through — the row-building loop in `upsert_team_game_stats` or the object-dtype columns in `aggregate_qb_weekly_stats`); a missing column in the nflverse file (`Missing columns in PBP data` from `download_pbp`, because `REQUIRED_PBP_COLS` grew).
2. A quick, obvious fix: branch from `main`, add the failing case as a test, fix, PR, merge, re-dispatch the refresh (Step 5) and verify (Step 6).
3. Otherwise revert so the nightly refresh keeps working: `git -C "<repo>" switch -c revert-box-scores-pr2 main`, `git -C "<repo>" revert -m 1 <merge commit sha>`, push, `gh pr create … --title "revert: box scores PR 2 (refresh failing)"`, merge, re-dispatch the refresh and confirm `Season 2026 complete` in its log. The empty `team_game_stats` table and the two NULL columns on `qb_weekly_stats` can stay — nothing reads them. Report what failed so the fix can be planned.

- [ ] **Step 8: Hand off**

Report the PR number, the merge commit, the refresh run id and its key log lines, and the `verify_production.py` output. PR 3 (`/game/[game_id]`) may start once this shows `OK: production matches`; spec §11 also asks for three live box scores to be compared against rbsdm and ESPN after each merge — that comparison is only possible once PR 3 renders them, so it is PR 3's first verification step.
