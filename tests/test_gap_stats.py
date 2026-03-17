import sys
import os
import math
import pytest
import pandas as pd

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripts'))


class TestGapMapping:
    """Test the GAP_MAP dictionary and map_run_gap() function."""

    def test_left_end(self):
        from ingest import map_run_gap
        assert map_run_gap('left', 'end') == 'LE'

    def test_left_tackle(self):
        from ingest import map_run_gap
        assert map_run_gap('left', 'tackle') == 'LT'

    def test_left_guard(self):
        from ingest import map_run_gap
        assert map_run_gap('left', 'guard') == 'LG'

    def test_middle_none(self):
        from ingest import map_run_gap
        assert map_run_gap('middle', None) == 'M'

    def test_middle_guard(self):
        from ingest import map_run_gap
        assert map_run_gap('middle', 'guard') == 'M'

    def test_middle_tackle(self):
        from ingest import map_run_gap
        assert map_run_gap('middle', 'tackle') == 'M'

    def test_right_guard(self):
        from ingest import map_run_gap
        assert map_run_gap('right', 'guard') == 'RG'

    def test_right_tackle(self):
        from ingest import map_run_gap
        assert map_run_gap('right', 'tackle') == 'RT'

    def test_right_end(self):
        from ingest import map_run_gap
        assert map_run_gap('right', 'end') == 'RE'

    def test_unknown_returns_none(self):
        from ingest import map_run_gap
        assert map_run_gap('left', 'unknown') is None

    def test_none_none_returns_none(self):
        from ingest import map_run_gap
        assert map_run_gap(None, None) is None


class TestAggregateRBGapStats:
    """Test aggregate_rb_gap_stats() — groups rushing plays by player x team x gap."""

    def _make_plays(self):
        return pd.DataFrame({
            'rush_attempt': [1, 1, 1, 1, 1, 0],
            'qb_scramble': [0, 0, 0, 0, 0, 0],
            'play_type': ['run', 'run', 'run', 'run', 'run', 'pass'],
            'run_location': ['left', 'left', 'left', 'middle', 'right', None],
            'run_gap': ['guard', 'guard', 'tackle', None, 'end', None],
            'rusher_player_id': ['RB1', 'RB1', 'RB1', 'RB2', 'RB1', 'QB1'],
            'rusher_player_name': ['J.Smith', 'J.Smith', 'J.Smith', 'K.Jones', 'J.Smith', 'L.Jackson'],
            'posteam': ['BAL', 'BAL', 'BAL', 'BAL', 'BAL', 'BAL'],
            'epa': [0.5, -0.2, 0.8, 0.1, -0.1, 1.0],
            'success': [1, 0, 1, 1, 0, 1],
            'yards_gained': [5, -1, 12, 3, 0, 15],
            'season': [2024, 2024, 2024, 2024, 2024, 2024],
        })

    def test_excludes_pass_plays(self):
        from ingest import aggregate_rb_gap_stats
        plays = self._make_plays()
        result = aggregate_rb_gap_stats(plays, 2024)
        player_ids = result['player_id'].unique()
        assert 'QB1' not in player_ids

    def test_correct_gap_assignment(self):
        from ingest import aggregate_rb_gap_stats
        plays = self._make_plays()
        result = aggregate_rb_gap_stats(plays, 2024)
        rb1_lg = result[(result['player_id'] == 'RB1') & (result['gap'] == 'LG')]
        assert len(rb1_lg) == 1
        assert rb1_lg.iloc[0]['carries'] == 2

    def test_epa_per_carry(self):
        from ingest import aggregate_rb_gap_stats
        plays = self._make_plays()
        result = aggregate_rb_gap_stats(plays, 2024)
        rb1_lg = result[(result['player_id'] == 'RB1') & (result['gap'] == 'LG')]
        assert rb1_lg.iloc[0]['epa_per_carry'] == pytest.approx(0.15, abs=0.01)

    def test_success_rate(self):
        from ingest import aggregate_rb_gap_stats
        plays = self._make_plays()
        result = aggregate_rb_gap_stats(plays, 2024)
        rb1_lg = result[(result['player_id'] == 'RB1') & (result['gap'] == 'LG')]
        assert rb1_lg.iloc[0]['success_rate'] == pytest.approx(0.5, abs=0.01)

    def test_stuff_rate(self):
        from ingest import aggregate_rb_gap_stats
        plays = self._make_plays()
        result = aggregate_rb_gap_stats(plays, 2024)
        rb1_lg = result[(result['player_id'] == 'RB1') & (result['gap'] == 'LG')]
        assert rb1_lg.iloc[0]['stuff_rate'] == pytest.approx(0.5, abs=0.01)

    def test_explosive_rate(self):
        from ingest import aggregate_rb_gap_stats
        plays = self._make_plays()
        result = aggregate_rb_gap_stats(plays, 2024)
        rb1_lt = result[(result['player_id'] == 'RB1') & (result['gap'] == 'LT')]
        assert rb1_lt.iloc[0]['explosive_rate'] == pytest.approx(1.0, abs=0.01)

    def test_middle_with_none_gap(self):
        from ingest import aggregate_rb_gap_stats
        plays = self._make_plays()
        result = aggregate_rb_gap_stats(plays, 2024)
        rb2_m = result[(result['player_id'] == 'RB2') & (result['gap'] == 'M')]
        assert len(rb2_m) == 1
        assert rb2_m.iloc[0]['carries'] == 1

    def test_unmappable_gaps_excluded(self):
        from ingest import aggregate_rb_gap_stats
        plays = pd.DataFrame({
            'rush_attempt': [1],
            'qb_scramble': [0],
            'play_type': ['run'],
            'run_location': [None],
            'run_gap': [None],
            'rusher_player_id': ['RB1'],
            'rusher_player_name': ['J.Smith'],
            'posteam': ['BAL'],
            'epa': [0.5],
            'success': [1],
            'yards_gained': [5],
            'season': [2024],
        })
        result = aggregate_rb_gap_stats(plays, 2024)
        assert len(result) == 0

    def test_output_columns(self):
        from ingest import aggregate_rb_gap_stats
        plays = self._make_plays()
        result = aggregate_rb_gap_stats(plays, 2024)
        expected_cols = {'player_id', 'player_name', 'team_id', 'season', 'gap',
                         'carries', 'epa_per_carry', 'yards_per_carry',
                         'success_rate', 'stuff_rate', 'explosive_rate'}
        assert set(result.columns) == expected_cols


class TestAggregateRBGapStatsWeekly:
    """Test weekly gap stats aggregation with situation/field_zone splits."""

    def _make_plays(self):
        return pd.DataFrame({
            'rush_attempt': [1, 1, 1, 1],
            'qb_scramble': [0, 0, 0, 0],
            'play_type': ['run', 'run', 'run', 'run'],
            'run_location': ['left', 'left', 'left', 'right'],
            'run_gap': ['guard', 'guard', 'guard', 'end'],
            'rusher_player_id': ['RB1', 'RB1', 'RB1', 'RB1'],
            'rusher_player_name': ['J.Smith', 'J.Smith', 'J.Smith', 'J.Smith'],
            'posteam': ['BAL', 'BAL', 'BAL', 'BAL'],
            'epa': [0.5, -0.2, 0.3, 0.1],
            'success': [1, 0, 1, 1],
            'yards_gained': [5, -1, 8, 3],
            'season': [2024, 2024, 2024, 2024],
            'week': [1, 1, 2, 2],
            'down': [1, 2, 1, 3],
            'ydstogo': [10, 7, 10, 1],
            'yardline_100': [45, 38, 15, 3],
        })

    def test_weekly_rows(self):
        from ingest import aggregate_rb_gap_stats_weekly
        plays = self._make_plays()
        result = aggregate_rb_gap_stats_weekly(plays, 2024)
        all_rows = result[(result['situation'] == 'all') & (result['field_zone'] == 'all')]
        # RB1 has LG in week 1 (2 carries) and week 2 (1 carry), RE in week 2 (1 carry)
        assert len(all_rows) == 3

    def test_situation_early_downs(self):
        from ingest import aggregate_rb_gap_stats_weekly
        plays = self._make_plays()
        result = aggregate_rb_gap_stats_weekly(plays, 2024)
        early = result[result['situation'] == 'early']
        assert len(early) > 0

    def test_field_zone_redzone(self):
        from ingest import aggregate_rb_gap_stats_weekly
        plays = self._make_plays()
        result = aggregate_rb_gap_stats_weekly(plays, 2024)
        rz = result[result['field_zone'] == 'redzone']
        # yardline_100 <= 20: rows with yardline 15 and 3
        assert len(rz) > 0

    def test_output_has_week_column(self):
        from ingest import aggregate_rb_gap_stats_weekly
        plays = self._make_plays()
        result = aggregate_rb_gap_stats_weekly(plays, 2024)
        assert 'week' in result.columns
        assert 'situation' in result.columns
        assert 'field_zone' in result.columns
