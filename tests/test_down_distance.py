import sys
import os
import math
import pytest
import pandas as pd

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripts'))


class TestMapDistanceBin:
    """Test the map_distance_bin() function for yards-to-go bucketing."""

    def test_ydstogo_1(self):
        from ingest import map_distance_bin
        assert map_distance_bin(1) == '1-2'

    def test_ydstogo_2(self):
        from ingest import map_distance_bin
        assert map_distance_bin(2) == '1-2'

    def test_ydstogo_3(self):
        from ingest import map_distance_bin
        assert map_distance_bin(3) == '3-4'

    def test_ydstogo_4(self):
        from ingest import map_distance_bin
        assert map_distance_bin(4) == '3-4'

    def test_ydstogo_5(self):
        from ingest import map_distance_bin
        assert map_distance_bin(5) == '5-7'

    def test_ydstogo_7(self):
        from ingest import map_distance_bin
        assert map_distance_bin(7) == '5-7'

    def test_ydstogo_8(self):
        from ingest import map_distance_bin
        assert map_distance_bin(8) == '8-10'

    def test_ydstogo_10(self):
        from ingest import map_distance_bin
        assert map_distance_bin(10) == '8-10'

    def test_ydstogo_11(self):
        from ingest import map_distance_bin
        assert map_distance_bin(11) == '11+'

    def test_ydstogo_15(self):
        from ingest import map_distance_bin
        assert map_distance_bin(15) == '11+'

    def test_nan_returns_none(self):
        from ingest import map_distance_bin
        assert map_distance_bin(float('nan')) is None

    def test_none_returns_none(self):
        from ingest import map_distance_bin
        assert map_distance_bin(None) is None

    def test_ydstogo_zero_returns_none(self):
        from ingest import map_distance_bin
        assert map_distance_bin(0) is None

    def test_ydstogo_float_10(self):
        from ingest import map_distance_bin
        assert map_distance_bin(10.0) == '8-10'


class TestAggregateTeamDownDistanceStats:
    """Test aggregate_team_down_distance_stats() — team rushing EPA by down x distance."""

    def _make_plays(self):
        """Create a minimal PBP DataFrame with rush and pass plays."""
        return pd.DataFrame({
            'rush_attempt': [1, 1, 1, 1, 1, 1, 0, 1, 0],
            'qb_scramble':  [0, 0, 0, 0, 0, 0, 0, 1, 0],
            'play_type':    ['run', 'run', 'run', 'run', 'run', 'qb_kneel', 'pass', 'run', 'pass'],
            'down':         [1,     1,     2,     3,     3,     4,          1,       1,     2],
            'ydstogo':      [10,    10,    5,     3,     3,     1,          10,      10,    7],
            'epa':          [0.5,  -0.3,   0.8,   0.1,  -0.5,  -0.1,       1.2,     0.4,  -0.2],
            'yards_gained': [8,    -1,     12,    4,     0,     1,          15,      6,     3],
            'posteam':      ['KC', 'KC',  'KC',  'KC',  'KC',  'KC',      'KC',    'KC',  'KC'],
            'success':      [1,     0,     1,     1,     0,     0,          1,       1,     0],
            'yardline_100': [75,    60,    45,    30,    30,    1,          70,      65,    50],
            'wp':           [0.5,   0.5,   0.5,   0.5,   0.5,  0.5,        0.5,     0.5,   0.5],
            'game_seconds_remaining': [3000] * 9,
        })

    def test_excludes_qb_kneel(self):
        from ingest import aggregate_team_down_distance_stats
        plays = self._make_plays()
        result = aggregate_team_down_distance_stats(plays, 2024)
        # The qb_kneel play is on 4th & 1. If it were included, there'd be
        # a row for down=4. It should be excluded entirely.
        team_rows = result[result['team_id'] == 'KC']
        assert 4 not in team_rows['down'].values

    def test_excludes_qb_scramble(self):
        from ingest import aggregate_team_down_distance_stats
        plays = self._make_plays()
        result = aggregate_team_down_distance_stats(plays, 2024)
        # Row index 7 is a scramble on 1st & 10. Without it, 1st-&-10 should
        # have carries=2 (rows 0 and 1). With it, carries would be 3.
        kc_1_810 = result[
            (result['team_id'] == 'KC') &
            (result['down'] == 1) &
            (result['distance_bin'] == '8-10')
        ]
        assert len(kc_1_810) == 1
        assert kc_1_810.iloc[0]['carries'] == 2

    def test_excludes_pass_plays(self):
        from ingest import aggregate_team_down_distance_stats
        plays = self._make_plays()
        result = aggregate_team_down_distance_stats(plays, 2024)
        # Total carries across all KC rows should be 4 (rows 0,1,2,3,4 minus kneel and scramble = 5-1=4... wait)
        # Rows: 0=rush, 1=rush, 2=rush, 3=rush, 4=rush, 5=kneel(excluded), 6=pass(excluded), 7=scramble(excluded), 8=pass(excluded)
        # So 5 qualifying rushes
        kc_rows = result[result['team_id'] == 'KC']
        total_carries = kc_rows['carries'].sum()
        assert total_carries == 5

    def test_nfl_average_rows_generated(self):
        from ingest import aggregate_team_down_distance_stats
        plays = self._make_plays()
        result = aggregate_team_down_distance_stats(plays, 2024)
        nfl_rows = result[result['team_id'] == 'NFL']
        assert len(nfl_rows) > 0

    def test_nfl_average_matches_team_totals(self):
        from ingest import aggregate_team_down_distance_stats
        plays = self._make_plays()
        result = aggregate_team_down_distance_stats(plays, 2024)
        # With only one team, NFL averages should equal KC's numbers
        nfl_rows = result[result['team_id'] == 'NFL'].sort_values(['down', 'distance_bin']).reset_index(drop=True)
        kc_rows = result[result['team_id'] == 'KC'].sort_values(['down', 'distance_bin']).reset_index(drop=True)
        assert len(nfl_rows) == len(kc_rows)
        for i in range(len(nfl_rows)):
            assert nfl_rows.iloc[i]['carries'] == kc_rows.iloc[i]['carries']
            assert nfl_rows.iloc[i]['epa_per_carry'] == pytest.approx(
                kc_rows.iloc[i]['epa_per_carry'], abs=0.001
            )

    def test_empty_dataframe_returns_empty(self):
        from ingest import aggregate_team_down_distance_stats
        plays = pd.DataFrame(columns=[
            'rush_attempt', 'qb_scramble', 'play_type', 'down', 'ydstogo',
            'epa', 'yards_gained', 'posteam', 'success', 'yardline_100',
            'wp', 'game_seconds_remaining',
        ])
        result = aggregate_team_down_distance_stats(plays, 2024)
        assert len(result) == 0
        expected_cols = {'team_id', 'season', 'down', 'distance_bin', 'carries',
                         'epa_per_carry', 'success_rate', 'yards_per_carry',
                         'stuff_rate', 'explosive_rate'}
        assert set(result.columns) == expected_cols

    def test_missing_column_returns_empty(self):
        from ingest import aggregate_team_down_distance_stats
        plays = pd.DataFrame({'rush_attempt': [1], 'play_type': ['run']})
        result = aggregate_team_down_distance_stats(plays, 2024)
        assert len(result) == 0

    def test_output_columns(self):
        from ingest import aggregate_team_down_distance_stats
        plays = self._make_plays()
        result = aggregate_team_down_distance_stats(plays, 2024)
        expected_cols = {'team_id', 'season', 'down', 'distance_bin', 'carries',
                         'epa_per_carry', 'success_rate', 'yards_per_carry',
                         'stuff_rate', 'explosive_rate'}
        assert set(result.columns) == expected_cols

    def test_season_column_value(self):
        from ingest import aggregate_team_down_distance_stats
        plays = self._make_plays()
        result = aggregate_team_down_distance_stats(plays, 2024)
        assert (result['season'] == 2024).all()

    def test_epa_per_carry_calculation(self):
        from ingest import aggregate_team_down_distance_stats
        plays = self._make_plays()
        result = aggregate_team_down_distance_stats(plays, 2024)
        # 1st & 8-10: rows 0 (epa=0.5) and 1 (epa=-0.3) → mean = 0.1
        kc_1_810 = result[
            (result['team_id'] == 'KC') &
            (result['down'] == 1) &
            (result['distance_bin'] == '8-10')
        ]
        assert kc_1_810.iloc[0]['epa_per_carry'] == pytest.approx(0.1, abs=0.01)

    def test_stuff_rate_calculation(self):
        from ingest import aggregate_team_down_distance_stats
        plays = self._make_plays()
        result = aggregate_team_down_distance_stats(plays, 2024)
        # 1st & 8-10: row 0 (yards=8, not stuffed), row 1 (yards=-1, stuffed) → 0.5
        kc_1_810 = result[
            (result['team_id'] == 'KC') &
            (result['down'] == 1) &
            (result['distance_bin'] == '8-10')
        ]
        assert kc_1_810.iloc[0]['stuff_rate'] == pytest.approx(0.5, abs=0.01)

    def test_explosive_rate_calculation(self):
        from ingest import aggregate_team_down_distance_stats
        plays = self._make_plays()
        result = aggregate_team_down_distance_stats(plays, 2024)
        # 2nd & 5-7: row 2 (yards=12 → explosive) → 1.0
        kc_2_57 = result[
            (result['team_id'] == 'KC') &
            (result['down'] == 2) &
            (result['distance_bin'] == '5-7')
        ]
        assert kc_2_57.iloc[0]['explosive_rate'] == pytest.approx(1.0, abs=0.01)

    def test_fourth_down_zero_carries_no_crash(self):
        from ingest import aggregate_team_down_distance_stats
        # All plays are pass or kneel on 4th down — zero qualifying rushes on 4th
        plays = pd.DataFrame({
            'rush_attempt': [0, 1],
            'qb_scramble':  [0, 0],
            'play_type':    ['pass', 'qb_kneel'],
            'down':         [4, 4],
            'ydstogo':      [1, 1],
            'epa':          [0.5, -0.1],
            'yards_gained': [5, 0],
            'posteam':      ['BUF', 'BUF'],
            'success':      [1, 0],
            'yardline_100': [50, 50],
            'wp':           [0.5, 0.5],
            'game_seconds_remaining': [3000, 3000],
        })
        result = aggregate_team_down_distance_stats(plays, 2024)
        # Should return empty since no qualifying rushes exist
        assert len(result) == 0

    def test_multi_team_aggregation(self):
        from ingest import aggregate_team_down_distance_stats
        plays = pd.DataFrame({
            'rush_attempt': [1, 1],
            'qb_scramble':  [0, 0],
            'play_type':    ['run', 'run'],
            'down':         [1, 1],
            'ydstogo':      [10, 10],
            'epa':          [0.5, -0.2],
            'yards_gained': [8, 3],
            'posteam':      ['KC', 'BUF'],
            'success':      [1, 0],
            'yardline_100': [70, 60],
            'wp':           [0.5, 0.5],
            'game_seconds_remaining': [3000, 3000],
        })
        result = aggregate_team_down_distance_stats(plays, 2024)
        team_ids = set(result['team_id'].unique())
        assert 'KC' in team_ids
        assert 'BUF' in team_ids
        assert 'NFL' in team_ids
        # NFL average should be mean of both plays
        nfl_row = result[result['team_id'] == 'NFL']
        assert nfl_row.iloc[0]['epa_per_carry'] == pytest.approx(0.15, abs=0.01)
