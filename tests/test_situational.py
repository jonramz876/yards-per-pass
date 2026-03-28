import sys
import os
import math
import pytest
import pandas as pd

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripts'))


class TestAggregateTeamSituationalStats:
    """Test aggregate_team_situational_stats() — team offensive EPA by game situation."""

    def _make_plays(self):
        """Create a PBP DataFrame covering all situation filters.

        Rows designed so specific plays land in specific situations:
          0: 1st & 10, yardline 75, wp 0.5, 3000 sec — early_down, all
          1: 2nd & 5,  yardline 15, wp 0.5, 3000 sec — early_down, redzone, all
          2: 3rd & 2,  yardline 4,  wp 0.5, 3000 sec — short_yardage, redzone, goalline, all
          3: 2nd & 8,  yardline 50, wp 0.5, 3000 sec — passing_down, early_down, all
          4: 3rd & 6,  yardline 50, wp 0.4, 800 sec  — passing_down, late_close, all
          5: 1st & 10, yardline 3,  wp 0.5, 3000 sec — early_down, redzone, goalline, all
          6: 4th & 1,  yardline 30, wp 0.5, 3000 sec — short_yardage, all
        """
        return pd.DataFrame({
            'play_type':    ['run', 'pass', 'run', 'pass', 'pass', 'run', 'run'],
            'epa':          [0.5,   -0.3,   0.8,   0.1,   -0.5,    1.2,   0.3],
            'posteam':      ['KC',  'KC',   'KC',  'KC',   'KC',   'KC',  'KC'],
            'down':         [1,      2,      3,     2,      3,      1,     4],
            'ydstogo':      [10,     5,      2,     8,      6,      10,    1],
            'yardline_100': [75,     15,     4,     50,     50,     3,     30],
            'wp':           [0.50,   0.50,   0.50,  0.50,   0.40,   0.50,  0.50],
            'game_seconds_remaining': [3000, 3000, 3000, 3000, 800, 3000, 3000],
        })

    def test_all_situation_includes_everything(self):
        from ingest import aggregate_team_situational_stats
        plays = self._make_plays()
        result = aggregate_team_situational_stats(plays, 2024)
        kc_all = result[(result['team_id'] == 'KC') & (result['situation'] == 'all')]
        assert len(kc_all) == 1
        assert kc_all.iloc[0]['plays'] == 7

    def test_early_down_filters_down_1_and_2(self):
        from ingest import aggregate_team_situational_stats
        plays = self._make_plays()
        result = aggregate_team_situational_stats(plays, 2024)
        kc_early = result[(result['team_id'] == 'KC') & (result['situation'] == 'early_down')]
        assert len(kc_early) == 1
        # Rows 0 (down=1), 1 (down=2), 3 (down=2), 5 (down=1) = 4 plays
        assert kc_early.iloc[0]['plays'] == 4

    def test_short_yardage_filters_down_3_4_ydstogo_le_2(self):
        from ingest import aggregate_team_situational_stats
        plays = self._make_plays()
        result = aggregate_team_situational_stats(plays, 2024)
        kc_short = result[(result['team_id'] == 'KC') & (result['situation'] == 'short_yardage')]
        assert len(kc_short) == 1
        # Row 2 (3rd & 2) and row 6 (4th & 1) = 2 plays
        assert kc_short.iloc[0]['plays'] == 2

    def test_passing_down_filter(self):
        from ingest import aggregate_team_situational_stats
        plays = self._make_plays()
        result = aggregate_team_situational_stats(plays, 2024)
        kc_pass_down = result[(result['team_id'] == 'KC') & (result['situation'] == 'passing_down')]
        assert len(kc_pass_down) == 1
        # Row 3 (2nd & 8, ydstogo>=7) and row 4 (3rd & 6, ydstogo>=5) = 2 plays
        assert kc_pass_down.iloc[0]['plays'] == 2

    def test_redzone_filters_yardline_le_20(self):
        from ingest import aggregate_team_situational_stats
        plays = self._make_plays()
        result = aggregate_team_situational_stats(plays, 2024)
        kc_rz = result[(result['team_id'] == 'KC') & (result['situation'] == 'redzone')]
        assert len(kc_rz) == 1
        # Row 1 (yardline=15), row 2 (yardline=4), row 5 (yardline=3) = 3 plays
        assert kc_rz.iloc[0]['plays'] == 3

    def test_goalline_filters_yardline_le_5(self):
        from ingest import aggregate_team_situational_stats
        plays = self._make_plays()
        result = aggregate_team_situational_stats(plays, 2024)
        kc_gl = result[(result['team_id'] == 'KC') & (result['situation'] == 'goalline')]
        assert len(kc_gl) == 1
        # Row 2 (yardline=4) and row 5 (yardline=3) = 2 plays
        assert kc_gl.iloc[0]['plays'] == 2

    def test_late_close_filter(self):
        from ingest import aggregate_team_situational_stats
        plays = self._make_plays()
        result = aggregate_team_situational_stats(plays, 2024)
        kc_lc = result[(result['team_id'] == 'KC') & (result['situation'] == 'late_close')]
        assert len(kc_lc) == 1
        # Row 4: wp=0.4 (0.25-0.75), game_seconds_remaining=800 (<=900) = 1 play
        assert kc_lc.iloc[0]['plays'] == 1

    def test_pass_rate_computation(self):
        from ingest import aggregate_team_situational_stats
        plays = self._make_plays()
        result = aggregate_team_situational_stats(plays, 2024)
        kc_all = result[(result['team_id'] == 'KC') & (result['situation'] == 'all')]
        # 3 passes out of 7 plays
        assert kc_all.iloc[0]['pass_rate'] == pytest.approx(3 / 7, abs=0.01)

    def test_rush_and_pass_epa_split(self):
        from ingest import aggregate_team_situational_stats
        plays = self._make_plays()
        result = aggregate_team_situational_stats(plays, 2024)
        kc_all = result[(result['team_id'] == 'KC') & (result['situation'] == 'all')]
        row = kc_all.iloc[0]
        # Rush plays: rows 0 (0.5), 2 (0.8), 5 (1.2), 6 (0.3) → mean = 0.7
        assert row['rush_epa_per_play'] == pytest.approx(0.7, abs=0.01)
        # Pass plays: rows 1 (-0.3), 3 (0.1), 4 (-0.5) → mean = -0.2333
        assert row['pass_epa_per_play'] == pytest.approx(-0.2333, abs=0.01)

    def test_success_rate_uses_epa(self):
        from ingest import aggregate_team_situational_stats
        plays = self._make_plays()
        result = aggregate_team_situational_stats(plays, 2024)
        kc_all = result[(result['team_id'] == 'KC') & (result['situation'] == 'all')]
        # EPA > 0: rows 0 (0.5), 2 (0.8), 3 (0.1), 5 (1.2), 6 (0.3) = 5 out of 7
        assert kc_all.iloc[0]['success_rate'] == pytest.approx(5 / 7, abs=0.01)

    def test_nfl_average_rows_generated(self):
        from ingest import aggregate_team_situational_stats
        plays = self._make_plays()
        result = aggregate_team_situational_stats(plays, 2024)
        nfl_rows = result[result['team_id'] == 'NFL']
        # Should have one NFL row per situation in TEAM_SITUATIONS
        assert len(nfl_rows) == 7

    def test_nfl_average_matches_single_team(self):
        from ingest import aggregate_team_situational_stats
        plays = self._make_plays()
        result = aggregate_team_situational_stats(plays, 2024)
        # With only one team, NFL averages should equal KC's numbers
        for sit in ['all', 'early_down', 'short_yardage', 'passing_down',
                     'redzone', 'goalline', 'late_close']:
            nfl = result[(result['team_id'] == 'NFL') & (result['situation'] == sit)]
            kc = result[(result['team_id'] == 'KC') & (result['situation'] == sit)]
            assert len(nfl) == len(kc)
            if len(nfl) > 0:
                assert nfl.iloc[0]['plays'] == kc.iloc[0]['plays']
                assert nfl.iloc[0]['epa_per_play'] == pytest.approx(
                    kc.iloc[0]['epa_per_play'], abs=0.001
                )

    def test_empty_dataframe_returns_empty(self):
        from ingest import aggregate_team_situational_stats
        plays = pd.DataFrame(columns=[
            'play_type', 'epa', 'posteam', 'down', 'ydstogo',
            'yardline_100', 'wp', 'game_seconds_remaining',
        ])
        result = aggregate_team_situational_stats(plays, 2024)
        assert len(result) == 0
        expected_cols = {'team_id', 'season', 'situation', 'plays', 'epa_per_play',
                         'success_rate', 'pass_rate', 'rush_epa_per_play',
                         'pass_epa_per_play', 'rush_success_rate', 'pass_success_rate'}
        assert set(result.columns) == expected_cols

    def test_missing_column_returns_empty(self):
        from ingest import aggregate_team_situational_stats
        plays = pd.DataFrame({'play_type': ['run'], 'epa': [0.5]})
        result = aggregate_team_situational_stats(plays, 2024)
        assert len(result) == 0

    def test_output_columns(self):
        from ingest import aggregate_team_situational_stats
        plays = self._make_plays()
        result = aggregate_team_situational_stats(plays, 2024)
        expected_cols = {'team_id', 'season', 'situation', 'plays', 'epa_per_play',
                         'success_rate', 'pass_rate', 'rush_epa_per_play',
                         'pass_epa_per_play', 'rush_success_rate', 'pass_success_rate'}
        assert set(result.columns) == expected_cols

    def test_season_column_value(self):
        from ingest import aggregate_team_situational_stats
        plays = self._make_plays()
        result = aggregate_team_situational_stats(plays, 2024)
        assert (result['season'] == 2024).all()

    def test_only_pass_plays_no_rush_epa(self):
        from ingest import aggregate_team_situational_stats
        plays = pd.DataFrame({
            'play_type':    ['pass', 'pass'],
            'epa':          [0.5, -0.2],
            'posteam':      ['SF', 'SF'],
            'down':         [1, 2],
            'ydstogo':      [10, 5],
            'yardline_100': [50, 50],
            'wp':           [0.5, 0.5],
            'game_seconds_remaining': [3000, 3000],
        })
        result = aggregate_team_situational_stats(plays, 2024)
        sf_all = result[(result['team_id'] == 'SF') & (result['situation'] == 'all')]
        assert sf_all.iloc[0]['pass_rate'] == pytest.approx(1.0, abs=0.01)
        assert sf_all.iloc[0]['rush_epa_per_play'] is None or pd.isna(sf_all.iloc[0]['rush_epa_per_play'])

    def test_late_close_boundary_wp_exactly_025(self):
        """wp=0.25 is on the boundary — should be included."""
        from ingest import aggregate_team_situational_stats
        plays = pd.DataFrame({
            'play_type': ['run'],
            'epa': [0.3],
            'posteam': ['BUF'],
            'down': [1], 'ydstogo': [10],
            'yardline_100': [50],
            'wp': [0.25],
            'game_seconds_remaining': [800],
        })
        result = aggregate_team_situational_stats(plays, 2024)
        buf_lc = result[(result['team_id'] == 'BUF') & (result['situation'] == 'late_close')]
        assert len(buf_lc) == 1
        assert buf_lc.iloc[0]['plays'] == 1

    def test_late_close_boundary_wp_below_025(self):
        """wp=0.24 is outside the window — should NOT be late_close."""
        from ingest import aggregate_team_situational_stats
        plays = pd.DataFrame({
            'play_type': ['run'],
            'epa': [0.3],
            'posteam': ['BUF'],
            'down': [1], 'ydstogo': [10],
            'yardline_100': [50],
            'wp': [0.24],
            'game_seconds_remaining': [800],
        })
        result = aggregate_team_situational_stats(plays, 2024)
        buf_lc = result[(result['team_id'] == 'BUF') & (result['situation'] == 'late_close')]
        assert len(buf_lc) == 0

    def test_multi_team_nfl_average_pools_correctly(self):
        """NFL average should pool across teams, not average team averages."""
        from ingest import aggregate_team_situational_stats
        plays = pd.DataFrame({
            'play_type': ['run', 'run', 'run'],
            'epa': [0.6, -0.2, 0.3],
            'posteam': ['KC', 'KC', 'BUF'],
            'down': [1, 1, 1], 'ydstogo': [10, 10, 10],
            'yardline_100': [50, 50, 50],
            'wp': [0.5, 0.5, 0.5],
            'game_seconds_remaining': [3000, 3000, 3000],
        })
        result = aggregate_team_situational_stats(plays, 2024)
        nfl_ed = result[(result['team_id'] == 'NFL') & (result['situation'] == 'early_down')]
        # Play-weighted: mean(0.6, -0.2, 0.3) = 0.7/3 ≈ 0.233
        assert nfl_ed.iloc[0]['epa_per_play'] == pytest.approx((0.6 + -0.2 + 0.3) / 3, abs=0.01)

    def test_only_rush_plays_no_pass_epa(self):
        """Rush-only team should have pass_epa_per_play as None."""
        from ingest import aggregate_team_situational_stats
        plays = pd.DataFrame({
            'play_type': ['run', 'run'],
            'epa': [0.5, -0.1],
            'posteam': ['DEN', 'DEN'],
            'down': [1, 2], 'ydstogo': [10, 5],
            'yardline_100': [50, 50],
            'wp': [0.5, 0.5],
            'game_seconds_remaining': [3000, 3000],
        })
        result = aggregate_team_situational_stats(plays, 2024)
        den_all = result[(result['team_id'] == 'DEN') & (result['situation'] == 'all')]
        assert den_all.iloc[0]['pass_rate'] == pytest.approx(0.0, abs=0.01)
        assert den_all.iloc[0]['pass_epa_per_play'] is None or pd.isna(den_all.iloc[0]['pass_epa_per_play'])
