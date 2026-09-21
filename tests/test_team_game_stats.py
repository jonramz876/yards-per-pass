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
