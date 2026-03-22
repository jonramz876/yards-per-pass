# tests/test_pass_location_stats.py
"""Tests for QB pass location (field heat map) aggregation."""
import pandas as pd
import pytest
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripts'))
from ingest import aggregate_qb_pass_location_stats


def _make_roster(player_ids):
    """Minimal roster DataFrame with QB positions."""
    return pd.DataFrame({
        'gsis_id': player_ids,
        'position': ['QB'] * len(player_ids),
    })


def _make_play(passer_id='QB1', air_yards=10, pass_location='middle',
               complete=1, yards=10, td=0, interception=0, epa=0.5,
               sack=0, scramble=0, spike=0, week=1, team='KC'):
    """Build a single pass play dict with all required PBP columns."""
    return {
        'pass_attempt': 1,
        'sack': sack,
        'qb_scramble': scramble,
        'qb_spike': spike,
        'passer_player_id': passer_id,
        'passer_player_name': f'Player {passer_id}',
        'air_yards': air_yards,
        'pass_location': pass_location,
        'complete_pass': complete,
        'passing_yards': yards if complete else None,
        'pass_touchdown': td,
        'interception': interception,
        'epa': epa,
        'posteam': team,
        'week': week,
        'game_id': f'2024_0{week}_{team}_OPP',
    }


class TestDepthBinning:
    def test_short_zone(self):
        plays = pd.DataFrame([_make_play(air_yards=5, pass_location='left')])
        roster = _make_roster(['QB1'])
        result = aggregate_qb_pass_location_stats(plays, roster, 2024)
        assert len(result) == 1
        assert result.iloc[0]['depth_bin'] == 'short'

    def test_intermediate_zone(self):
        plays = pd.DataFrame([_make_play(air_yards=15, pass_location='middle')])
        roster = _make_roster(['QB1'])
        result = aggregate_qb_pass_location_stats(plays, roster, 2024)
        assert result.iloc[0]['depth_bin'] == 'intermediate'

    def test_deep_zone(self):
        plays = pd.DataFrame([_make_play(air_yards=25, pass_location='right')])
        roster = _make_roster(['QB1'])
        result = aggregate_qb_pass_location_stats(plays, roster, 2024)
        assert result.iloc[0]['depth_bin'] == 'deep'

    def test_negative_air_yards_binned_short(self):
        plays = pd.DataFrame([_make_play(air_yards=-3, pass_location='left')])
        roster = _make_roster(['QB1'])
        result = aggregate_qb_pass_location_stats(plays, roster, 2024)
        assert result.iloc[0]['depth_bin'] == 'short'

    def test_boundary_values(self):
        plays = pd.DataFrame([
            _make_play(air_yards=0, pass_location='left'),
            _make_play(air_yards=9, pass_location='left'),
            _make_play(air_yards=10, pass_location='middle'),
            _make_play(air_yards=19, pass_location='middle'),
            _make_play(air_yards=20, pass_location='right'),
        ])
        roster = _make_roster(['QB1'])
        result = aggregate_qb_pass_location_stats(plays, roster, 2024)
        bins = dict(zip(
            result['depth_bin'] + '-' + result['direction_bin'],
            result['pass_attempts']
        ))
        assert bins.get('short-left', 0) == 2
        assert bins.get('intermediate-middle', 0) == 2
        assert bins.get('deep-right', 0) == 1


class TestFiltering:
    def test_null_air_yards_excluded(self):
        plays = pd.DataFrame([
            _make_play(air_yards=10),
            _make_play(air_yards=None),
        ])
        roster = _make_roster(['QB1'])
        result = aggregate_qb_pass_location_stats(plays, roster, 2024)
        total = result['pass_attempts'].sum()
        assert total == 1

    def test_null_pass_location_excluded(self):
        plays = pd.DataFrame([
            _make_play(pass_location='left'),
            _make_play(pass_location=None),
        ])
        roster = _make_roster(['QB1'])
        result = aggregate_qb_pass_location_stats(plays, roster, 2024)
        assert result['pass_attempts'].sum() == 1

    def test_sacks_excluded(self):
        plays = pd.DataFrame([
            _make_play(),
            _make_play(sack=1),
        ])
        roster = _make_roster(['QB1'])
        result = aggregate_qb_pass_location_stats(plays, roster, 2024)
        assert result['pass_attempts'].sum() == 1

    def test_scrambles_excluded(self):
        plays = pd.DataFrame([
            _make_play(),
            _make_play(scramble=1),
        ])
        roster = _make_roster(['QB1'])
        result = aggregate_qb_pass_location_stats(plays, roster, 2024)
        assert result['pass_attempts'].sum() == 1

    def test_spikes_excluded(self):
        plays = pd.DataFrame([
            _make_play(),
            _make_play(spike=1, air_yards=0),
        ])
        roster = _make_roster(['QB1'])
        result = aggregate_qb_pass_location_stats(plays, roster, 2024)
        assert result['pass_attempts'].sum() == 1

    def test_non_qb_passer_excluded(self):
        plays = pd.DataFrame([
            _make_play(passer_id='QB1'),
            _make_play(passer_id='WR1'),
        ])
        roster = _make_roster(['QB1'])
        result = aggregate_qb_pass_location_stats(plays, roster, 2024)
        assert result['pass_attempts'].sum() == 1

    def test_missing_column_returns_empty(self):
        plays = pd.DataFrame([_make_play()])
        plays = plays.drop(columns=['pass_location'])
        roster = _make_roster(['QB1'])
        result = aggregate_qb_pass_location_stats(plays, roster, 2024)
        assert result.empty


class TestAggregation:
    def test_pass_attempts_count(self):
        plays = pd.DataFrame([
            _make_play(air_yards=5, pass_location='left', complete=1),
            _make_play(air_yards=7, pass_location='left', complete=0),
            _make_play(air_yards=8, pass_location='left', complete=1),
        ])
        roster = _make_roster(['QB1'])
        result = aggregate_qb_pass_location_stats(plays, roster, 2024)
        row = result[(result['depth_bin'] == 'short') & (result['direction_bin'] == 'left')]
        assert row.iloc[0]['pass_attempts'] == 3

    def test_completions_sum(self):
        plays = pd.DataFrame([
            _make_play(air_yards=5, pass_location='left', complete=1),
            _make_play(air_yards=7, pass_location='left', complete=0),
            _make_play(air_yards=8, pass_location='left', complete=1),
        ])
        roster = _make_roster(['QB1'])
        result = aggregate_qb_pass_location_stats(plays, roster, 2024)
        row = result[(result['depth_bin'] == 'short') & (result['direction_bin'] == 'left')]
        assert row.iloc[0]['completions'] == 2

    def test_completion_pct(self):
        plays = pd.DataFrame([
            _make_play(air_yards=5, pass_location='left', complete=1),
            _make_play(air_yards=7, pass_location='left', complete=0),
        ])
        roster = _make_roster(['QB1'])
        result = aggregate_qb_pass_location_stats(plays, roster, 2024)
        row = result[(result['depth_bin'] == 'short') & (result['direction_bin'] == 'left')]
        assert row.iloc[0]['completion_pct'] == pytest.approx(0.5)

    def test_epa_per_attempt(self):
        plays = pd.DataFrame([
            _make_play(air_yards=5, pass_location='left', epa=0.5),
            _make_play(air_yards=7, pass_location='left', epa=-0.3),
        ])
        roster = _make_roster(['QB1'])
        result = aggregate_qb_pass_location_stats(plays, roster, 2024)
        row = result[(result['depth_bin'] == 'short') & (result['direction_bin'] == 'left')]
        assert row.iloc[0]['epa_per_attempt'] == pytest.approx(0.1)

    def test_passing_yards_fillna(self):
        plays = pd.DataFrame([
            _make_play(air_yards=5, pass_location='left', complete=1, yards=15),
            _make_play(air_yards=7, pass_location='left', complete=0, yards=None),
        ])
        roster = _make_roster(['QB1'])
        result = aggregate_qb_pass_location_stats(plays, roster, 2024)
        row = result[(result['depth_bin'] == 'short') & (result['direction_bin'] == 'left')]
        assert row.iloc[0]['passing_yards'] == 15

    def test_passer_rating_null_under_5_attempts(self):
        plays = pd.DataFrame([
            _make_play(air_yards=25, pass_location='right', complete=1, yards=40, td=1),
        ])
        roster = _make_roster(['QB1'])
        result = aggregate_qb_pass_location_stats(plays, roster, 2024)
        row = result[(result['depth_bin'] == 'deep') & (result['direction_bin'] == 'right')]
        assert pd.isna(row.iloc[0]['passer_rating'])

    def test_passer_rating_computed_with_5_plus(self):
        plays = pd.DataFrame([
            _make_play(air_yards=5, pass_location='left', complete=1, yards=10, td=0, interception=0),
            _make_play(air_yards=6, pass_location='left', complete=1, yards=8, td=0, interception=0),
            _make_play(air_yards=7, pass_location='left', complete=1, yards=12, td=1, interception=0),
            _make_play(air_yards=8, pass_location='left', complete=0, yards=None, td=0, interception=0),
            _make_play(air_yards=9, pass_location='left', complete=0, yards=None, td=0, interception=1),
        ])
        roster = _make_roster(['QB1'])
        result = aggregate_qb_pass_location_stats(plays, roster, 2024)
        row = result[(result['depth_bin'] == 'short') & (result['direction_bin'] == 'left')]
        assert not pd.isna(row.iloc[0]['passer_rating'])
        # Hand-calculated: 3/5 comp, 30 yds, 1 TD, 1 INT
        # a=1.5, b=0.75, c=2.375(clamped), d=0.0(clamped) → (4.625/6)*100 = 77.1
        assert row.iloc[0]['passer_rating'] == pytest.approx(77.1, abs=0.1)

    def test_multi_team_qb_primary_team(self):
        plays = pd.DataFrame([
            _make_play(air_yards=5, pass_location='left', team='KC'),
            _make_play(air_yards=6, pass_location='left', team='KC'),
            _make_play(air_yards=7, pass_location='left', team='KC'),
            _make_play(air_yards=8, pass_location='left', team='NYJ'),
        ])
        roster = _make_roster(['QB1'])
        result = aggregate_qb_pass_location_stats(plays, roster, 2024)
        assert result.iloc[0]['team_id'] == 'KC'

    def test_zero_attempt_zone_absent(self):
        plays = pd.DataFrame([_make_play(air_yards=5, pass_location='left')])
        roster = _make_roster(['QB1'])
        result = aggregate_qb_pass_location_stats(plays, roster, 2024)
        assert len(result) == 1

    def test_all_nine_zones_populated(self):
        plays_list = []
        for ay, loc in [(5, 'left'), (5, 'middle'), (5, 'right'),
                        (15, 'left'), (15, 'middle'), (15, 'right'),
                        (25, 'left'), (25, 'middle'), (25, 'right')]:
            plays_list.append(_make_play(air_yards=ay, pass_location=loc))
        plays = pd.DataFrame(plays_list)
        roster = _make_roster(['QB1'])
        result = aggregate_qb_pass_location_stats(plays, roster, 2024)
        assert len(result) == 9

    def test_direction_bin_preserved(self):
        plays = pd.DataFrame([
            _make_play(air_yards=5, pass_location='left'),
            _make_play(air_yards=5, pass_location='middle'),
            _make_play(air_yards=5, pass_location='right'),
        ])
        roster = _make_roster(['QB1'])
        result = aggregate_qb_pass_location_stats(plays, roster, 2024)
        directions = set(result['direction_bin'])
        assert directions == {'left', 'middle', 'right'}

    def test_adot_stored(self):
        plays = pd.DataFrame([
            _make_play(air_yards=22, pass_location='right'),
            _make_play(air_yards=38, pass_location='right'),
        ])
        roster = _make_roster(['QB1'])
        result = aggregate_qb_pass_location_stats(plays, roster, 2024)
        row = result[(result['depth_bin'] == 'deep') & (result['direction_bin'] == 'right')]
        assert row.iloc[0]['adot'] == pytest.approx(30.0)
