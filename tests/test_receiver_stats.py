"""Tests for receiver season stats aggregation in ingest.py."""
import sys
import os
import math
import pytest
import pandas as pd

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripts'))


def make_plays(**overrides):
    """Create a minimal plays DataFrame with receiver-relevant columns."""
    defaults = {
        'receiver_player_id': 'WR1',
        'receiver_player_name': 'Test Receiver',
        'posteam': 'KC',
        'pass_attempt': 1,
        'sack': 0,
        'qb_scramble': 0,
        'complete_pass': 1,
        'receiving_yards': 10.0,
        'pass_touchdown': 0,
        'epa': 0.5,
        'yards_after_catch': 5.0,
        'air_yards': 5.0,
        'success': 1,
        'game_id': 'GAME1',
        'season': 2025,
        'week': 1,
        'fumble': 0,
        'fumble_lost': 0,
        'fumbled_1_player_id': None,
    }
    defaults.update(overrides)
    return pd.DataFrame([defaults])


def make_roster(player_id='WR1', position='WR'):
    """Create a minimal roster DataFrame."""
    return pd.DataFrame([{'gsis_id': player_id, 'position': position}])


class TestReceiverTargets:
    """Target counting: includes incompletes, excludes sacks."""

    def test_complete_pass_is_target(self):
        from ingest import aggregate_receiver_stats
        plays = make_plays(complete_pass=1)
        roster = make_roster()
        result = aggregate_receiver_stats(plays, roster, 2025)
        assert result.iloc[0]['targets'] == 1

    def test_incomplete_pass_is_target(self):
        from ingest import aggregate_receiver_stats
        plays = make_plays(complete_pass=0, receiving_yards=0)
        roster = make_roster()
        result = aggregate_receiver_stats(plays, roster, 2025)
        assert result.iloc[0]['targets'] == 1

    def test_sacks_excluded(self):
        from ingest import aggregate_receiver_stats
        plays = make_plays(sack=1, receiver_player_id=None)
        roster = make_roster()
        result = aggregate_receiver_stats(plays, roster, 2025)
        assert len(result) == 0  # No receivers on sack plays

    def test_null_receiver_excluded(self):
        from ingest import aggregate_receiver_stats
        plays = make_plays(receiver_player_id=None)
        roster = make_roster()
        result = aggregate_receiver_stats(plays, roster, 2025)
        assert len(result) == 0


class TestReceiverReceptions:
    """Receptions: only complete_pass == 1."""

    def test_receptions_count(self):
        from ingest import aggregate_receiver_stats
        plays = pd.concat([
            make_plays(complete_pass=1),
            make_plays(complete_pass=1),
            make_plays(complete_pass=0, receiving_yards=0),
        ], ignore_index=True)
        roster = make_roster()
        result = aggregate_receiver_stats(plays, roster, 2025)
        assert result.iloc[0]['receptions'] == 2
        assert result.iloc[0]['targets'] == 3


class TestReceiverYards:
    """Uses receiving_yards column, not yards_gained."""

    def test_receiving_yards_sum(self):
        from ingest import aggregate_receiver_stats
        plays = pd.concat([
            make_plays(receiving_yards=15.0),
            make_plays(receiving_yards=25.0),
        ], ignore_index=True)
        roster = make_roster()
        result = aggregate_receiver_stats(plays, roster, 2025)
        assert result.iloc[0]['receiving_yards'] == 40


class TestReceiverTDs:
    """TDs only on completed passes."""

    def test_td_on_completion(self):
        from ingest import aggregate_receiver_stats
        plays = make_plays(complete_pass=1, pass_touchdown=1)
        roster = make_roster()
        result = aggregate_receiver_stats(plays, roster, 2025)
        assert result.iloc[0]['receiving_tds'] == 1

    def test_td_not_counted_on_incomplete(self):
        from ingest import aggregate_receiver_stats
        # Edge case: pass_touchdown=1 but complete_pass=0 (shouldn't happen but guard it)
        plays = make_plays(complete_pass=0, pass_touchdown=1, receiving_yards=0)
        roster = make_roster()
        result = aggregate_receiver_stats(plays, roster, 2025)
        assert result.iloc[0]['receiving_tds'] == 0


class TestCatchRate:
    """catch_rate = receptions / targets."""

    def test_catch_rate(self):
        from ingest import aggregate_receiver_stats
        plays = pd.concat([
            make_plays(complete_pass=1),
            make_plays(complete_pass=0, receiving_yards=0),
        ], ignore_index=True)
        roster = make_roster()
        result = aggregate_receiver_stats(plays, roster, 2025)
        assert abs(result.iloc[0]['catch_rate'] - 0.5) < 0.001


class TestYardsPerReception:
    """NaN when zero receptions."""

    def test_ypr_normal(self):
        from ingest import aggregate_receiver_stats
        plays = pd.concat([
            make_plays(complete_pass=1, receiving_yards=20),
            make_plays(complete_pass=1, receiving_yards=10),
        ], ignore_index=True)
        roster = make_roster()
        result = aggregate_receiver_stats(plays, roster, 2025)
        assert abs(result.iloc[0]['yards_per_reception'] - 15.0) < 0.001

    def test_ypr_zero_receptions(self):
        from ingest import aggregate_receiver_stats
        plays = make_plays(complete_pass=0, receiving_yards=0)
        roster = make_roster()
        result = aggregate_receiver_stats(plays, roster, 2025)
        assert math.isnan(result.iloc[0]['yards_per_reception'])


class TestEPAPerTarget:
    """EPA per target handles NaN gracefully."""

    def test_epa_per_target(self):
        from ingest import aggregate_receiver_stats
        plays = pd.concat([
            make_plays(epa=0.5),
            make_plays(epa=-0.3),
        ], ignore_index=True)
        roster = make_roster()
        result = aggregate_receiver_stats(plays, roster, 2025)
        assert abs(result.iloc[0]['epa_per_target'] - 0.1) < 0.001

    def test_epa_with_nan(self):
        from ingest import aggregate_receiver_stats
        plays = pd.concat([
            make_plays(epa=0.5),
            make_plays(epa=float('nan')),
        ], ignore_index=True)
        roster = make_roster()
        result = aggregate_receiver_stats(plays, roster, 2025)
        # mean() skips NaN: 0.5 / 1 = 0.5
        assert abs(result.iloc[0]['epa_per_target'] - 0.5) < 0.001


class TestYACAndAirYards:
    """YAC and air yards aggregation."""

    def test_yac_sum(self):
        from ingest import aggregate_receiver_stats
        plays = pd.concat([
            make_plays(yards_after_catch=8.0),
            make_plays(yards_after_catch=3.0),
        ], ignore_index=True)
        roster = make_roster()
        result = aggregate_receiver_stats(plays, roster, 2025)
        assert result.iloc[0]['yac'] == 11.0

    def test_air_yards_includes_incompletes(self):
        from ingest import aggregate_receiver_stats
        plays = pd.concat([
            make_plays(complete_pass=1, air_yards=12.0),
            make_plays(complete_pass=0, air_yards=20.0, receiving_yards=0),
        ], ignore_index=True)
        roster = make_roster()
        result = aggregate_receiver_stats(plays, roster, 2025)
        assert result.iloc[0]['air_yards'] == 32.0

    def test_negative_air_yards_screens(self):
        from ingest import aggregate_receiver_stats
        plays = make_plays(air_yards=-3.0)
        roster = make_roster()
        result = aggregate_receiver_stats(plays, roster, 2025)
        assert result.iloc[0]['air_yards'] == -3.0


class TestTargetShare:
    """Target share: player targets / team total targets."""

    def test_target_share(self):
        from ingest import aggregate_receiver_stats
        plays = pd.concat([
            make_plays(receiver_player_id='WR1', receiver_player_name='WR One', posteam='KC'),
            make_plays(receiver_player_id='WR1', receiver_player_name='WR One', posteam='KC'),
            make_plays(receiver_player_id='WR2', receiver_player_name='WR Two', posteam='KC'),
        ], ignore_index=True)
        roster = pd.DataFrame([
            {'gsis_id': 'WR1', 'position': 'WR'},
            {'gsis_id': 'WR2', 'position': 'WR'},
        ])
        result = aggregate_receiver_stats(plays, roster, 2025)
        wr1 = result[result['player_id'] == 'WR1'].iloc[0]
        assert abs(wr1['target_share'] - (2/3)) < 0.001


class TestMultiTeamPlayer:
    """Player traded mid-season: picks team with most targets."""

    def test_picks_team_with_most_targets(self):
        from ingest import aggregate_receiver_stats
        plays = pd.concat([
            make_plays(receiver_player_id='WR1', posteam='KC'),
            make_plays(receiver_player_id='WR1', posteam='KC'),
            make_plays(receiver_player_id='WR1', posteam='SF'),
        ], ignore_index=True)
        roster = make_roster()
        result = aggregate_receiver_stats(plays, roster, 2025)
        assert result.iloc[0]['team_id'] == 'KC'


class TestPositionLookup:
    """Position from roster, fallback to WR."""

    def test_position_from_roster(self):
        from ingest import aggregate_receiver_stats
        plays = make_plays(receiver_player_id='TE1', receiver_player_name='Test TE')
        roster = make_roster(player_id='TE1', position='TE')
        result = aggregate_receiver_stats(plays, roster, 2025)
        assert result.iloc[0]['position'] == 'TE'

    def test_position_fallback_wr(self):
        from ingest import aggregate_receiver_stats
        plays = make_plays(receiver_player_id='UNKNOWN')
        roster = pd.DataFrame(columns=['gsis_id', 'position'])  # empty roster
        result = aggregate_receiver_stats(plays, roster, 2025)
        assert result.iloc[0]['position'] == 'WR'


class TestFumblesAttribution:
    """Fumbles searched across full plays, not just passes."""

    def test_fumble_attributed(self):
        from ingest import aggregate_receiver_stats
        plays = pd.concat([
            make_plays(receiver_player_id='WR1'),
            make_plays(receiver_player_id=None, pass_attempt=0, sack=0,
                       fumble=1, fumble_lost=1, fumbled_1_player_id='WR1'),
        ], ignore_index=True)
        roster = make_roster()
        result = aggregate_receiver_stats(plays, roster, 2025)
        assert result.iloc[0]['fumbles'] >= 1
        assert result.iloc[0]['fumbles_lost'] >= 1


class TestOutputColumns:
    """All expected columns present."""

    def test_output_has_required_columns(self):
        from ingest import aggregate_receiver_stats
        plays = make_plays()
        roster = make_roster()
        result = aggregate_receiver_stats(plays, roster, 2025)
        expected = [
            'player_id', 'player_name', 'position', 'team_id', 'season', 'games',
            'targets', 'receptions', 'receiving_yards', 'receiving_tds',
            'catch_rate', 'yards_per_target', 'yards_per_reception',
            'epa_per_target', 'yac', 'yac_per_reception',
            'air_yards', 'air_yards_per_target', 'target_share',
            'fumbles', 'fumbles_lost',
        ]
        for col in expected:
            assert col in result.columns, f"Missing column: {col}"


class TestEmptyInput:
    """Empty plays produce empty output."""

    def test_no_targets(self):
        from ingest import aggregate_receiver_stats
        plays = pd.DataFrame(columns=[
            'receiver_player_id', 'receiver_player_name', 'posteam',
            'pass_attempt', 'sack', 'qb_scramble', 'complete_pass', 'receiving_yards',
            'pass_touchdown', 'epa', 'yards_after_catch', 'air_yards',
            'success', 'game_id', 'season', 'week',
            'fumble', 'fumble_lost', 'fumbled_1_player_id',
        ])
        roster = make_roster()
        result = aggregate_receiver_stats(plays, roster, 2025)
        assert len(result) == 0
