"""Tests for aggregate_team_game_stats — box score spec §4 (definitions), §5
(table), §11 (golden game + tricky cases)."""
import math

import pandas as pd
import pytest
from pytest import approx

from conftest import FIXTURE_GAMES, FIXTURE_PATH, RAW_PBP_COLUMNS, team_game_row

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

    def test_carries_no_pandas_metadata(self):
        """A pandas-written parquet embeds a metadata blob that only pandas
        reads back identically; without it, pandas 2.2.3 (CI) and pandas 3
        (local) parse the file the same way (module docstring)."""
        import pyarrow.parquet as pq
        assert pq.ParquetFile(FIXTURE_PATH).schema_arrow.metadata is None


# ---------------------------------------------------------------------------
# Golden: 2026_01_BUF_HOU (spec §4). Where each GOLD number comes from:
#   * efficiency (plays, EPA/play, success rate, first-down rate, and their
#     pass / rush / early / late splits) — verified against rbsdm.com;
#   * traditional (first downs, 3rd/4th down, total plays and yards, net
#     passing, comp/att, interceptions, sacks, rushing, red zone, penalties,
#     turnovers, fumbles lost, defensive TDs, possession) — verified against the
#     ESPN box score;
#   * epa_lost_turnovers / epa_lost_sacks / epa_lost_penalties, the explosive
#     counts (explosive_plays / _pass / _rush / _rate) and team_targets — no
#     public source publishes these, so they were recomputed independently from
#     the same play-by-play during the spec review.
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
        """A defensive TD each way — TB's is a pick-six (play 2805, Trotter 38 yards),
        CIN's a strip-sack fumble return (play 545, Knight 27 yards). TB turned it over
        4 times, CIN once (spec §8's +3 margin)."""
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


class TestPartialDriveClock:
    """time_of_possession_seconds is NULL only when EVERY drive is unreadable. When
    only some are, the sum is silently short — so the aggregator logs a warning
    naming the game and team (spec §4 time of possession)."""

    def test_warns_when_only_some_drives_have_a_readable_clock(self, raw, caplog):
        from ingest import aggregate_team_game_stats
        plays = raw.game(raw.play(drive=1.0, drive_time_of_possession='2:30'),
                         raw.play(drive=2.0, drive_time_of_possession='junk'))
        with caplog.at_level('WARNING', logger='ingest'):
            out = aggregate_team_game_stats(plays, 2026)
        kc = team_game_row(out, '2026_01_KC_BUF', 'KC')
        assert kc['total_drives'] == 2
        assert kc['time_of_possession_seconds'] == 150   # the readable drive only
        assert '2026_01_KC_BUF' in caplog.text
        assert 'KC' in caplog.text
        assert '1 of 2' in caplog.text

    def test_no_warning_when_every_drive_has_a_clock(self, raw, caplog):
        from ingest import aggregate_team_game_stats
        plays = raw.game(raw.play(drive=1.0, drive_time_of_possession='2:30'),
                         raw.play(drive=2.0, drive_time_of_possession='1:00'))
        with caplog.at_level('WARNING', logger='ingest'):
            aggregate_team_game_stats(plays, 2026)
        assert 'drive_time_of_possession' not in caplog.text

    def test_no_warning_when_no_drive_has_a_clock(self, raw, caplog):
        """Every drive unreadable is the NULL case, already visible in the stored row."""
        from ingest import aggregate_team_game_stats
        plays = raw.game(raw.play(drive=1.0, drive_time_of_possession=None),
                         raw.play(drive=2.0, drive_time_of_possession='junk'))
        with caplog.at_level('WARNING', logger='ingest'):
            out = aggregate_team_game_stats(plays, 2026)
        assert team_game_row(out, '2026_01_KC_BUF', 'KC')['time_of_possession_seconds'] is None
        assert 'drive_time_of_possession' not in caplog.text
