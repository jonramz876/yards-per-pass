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
        unknown = set(overrides) - set(RAW_PBP_COLUMNS)
        assert not unknown, f"unknown column(s): {sorted(unknown)}"
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
