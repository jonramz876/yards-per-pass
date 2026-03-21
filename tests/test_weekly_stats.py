"""Tests for QB, Receiver, and RB weekly stats aggregation in ingest.py."""
import sys
import os
import math
import pytest
import pandas as pd
import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripts'))


# ---------------------------------------------------------------------------
# Factory helpers
# ---------------------------------------------------------------------------

def make_qb_play(**overrides):
    """Create a minimal dropback play for QB weekly stats."""
    defaults = {
        'passer_player_id': 'QB1',
        'passer_player_name': 'Test QB',
        'rusher_player_id': None,
        'rusher_player_name': None,
        'receiver_player_id': 'WR1',
        'receiver_player_name': 'Test WR',
        'posteam': 'KC',
        'defteam': 'LV',
        'home_team': 'KC',
        'away_team': 'LV',
        'total_home_score': 24.0,
        'total_away_score': 17.0,
        'pass_attempt': 1,
        'rush_attempt': 0,
        'qb_dropback': 1,
        'qb_scramble': 0,
        'sack': 0,
        'complete_pass': 1,
        'passing_yards': 12.0,
        'yards_gained': 12.0,
        'pass_touchdown': 0,
        'interception': 0,
        'rush_touchdown': 0,
        'rushing_yards': 0.0,
        'epa': 0.5,
        'cpoe': 3.0,
        'success': 1,
        'air_yards': 8.0,
        'receiving_yards': 12.0,
        'yards_after_catch': 4.0,
        'fumble': 0,
        'fumble_lost': 0,
        'fumbled_1_player_id': None,
        'game_id': '2025_01_LV_KC',
        'play_id': 1,
        'season': 2025,
        'week': 1,
        'play_type': 'pass',
        'season_type': 'REG',
        'two_point_attempt': 0,
        'result': 7,  # home margin
    }
    defaults.update(overrides)
    return pd.DataFrame([defaults])


def make_rush_play(**overrides):
    """Create a designed rush play (qb_dropback=0)."""
    defaults = {
        'passer_player_id': None,
        'passer_player_name': None,
        'rusher_player_id': 'RB1',
        'rusher_player_name': 'Test RB',
        'receiver_player_id': None,
        'receiver_player_name': None,
        'posteam': 'KC',
        'defteam': 'LV',
        'home_team': 'KC',
        'away_team': 'LV',
        'total_home_score': 24.0,
        'total_away_score': 17.0,
        'pass_attempt': 0,
        'rush_attempt': 1,
        'qb_dropback': 0,
        'qb_scramble': 0,
        'sack': 0,
        'complete_pass': 0,
        'passing_yards': 0.0,
        'yards_gained': 5.0,
        'pass_touchdown': 0,
        'interception': 0,
        'rush_touchdown': 0,
        'rushing_yards': 5.0,
        'epa': 0.2,
        'cpoe': None,
        'success': 1,
        'air_yards': None,
        'receiving_yards': 0.0,
        'yards_after_catch': None,
        'fumble': 0,
        'fumble_lost': 0,
        'fumbled_1_player_id': None,
        'game_id': '2025_01_LV_KC',
        'play_id': 100,
        'season': 2025,
        'week': 1,
        'play_type': 'run',
        'season_type': 'REG',
        'two_point_attempt': 0,
        'result': 7,
    }
    defaults.update(overrides)
    return pd.DataFrame([defaults])


def make_roster(player_id='QB1', position='QB'):
    """Create a minimal roster DataFrame."""
    return pd.DataFrame([{'gsis_id': player_id, 'position': position}])


def make_multi_roster(entries):
    """Create roster with multiple players. entries = list of (player_id, position)."""
    return pd.DataFrame([{'gsis_id': pid, 'position': pos} for pid, pos in entries])


# ---------------------------------------------------------------------------
# QB Weekly Stats
# ---------------------------------------------------------------------------

class TestQBWeeklyStats:
    """Tests for aggregate_qb_weekly_stats."""

    def test_basic_aggregation(self):
        """2 pass plays in week 1 -> 1 row with correct comp/att/yards."""
        from ingest import aggregate_qb_weekly_stats
        plays = pd.concat([
            make_qb_play(passing_yards=15.0, complete_pass=1),
            make_qb_play(passing_yards=10.0, complete_pass=1, play_id=2),
        ], ignore_index=True)
        roster = make_roster('QB1', 'QB')
        result = aggregate_qb_weekly_stats(plays, roster, 2025)
        assert len(result) == 1
        row = result.iloc[0]
        assert row['completions'] == 2
        assert row['attempts'] == 2
        assert row['passing_yards'] == 25

    def test_game_context(self):
        """Verify opponent_id, home_away, team_score, opponent_score, result."""
        from ingest import aggregate_qb_weekly_stats
        plays = make_qb_play(
            posteam='KC', defteam='LV', home_team='KC', away_team='LV',
            total_home_score=28.0, total_away_score=21.0,
        )
        roster = make_roster('QB1', 'QB')
        result = aggregate_qb_weekly_stats(plays, roster, 2025)
        row = result.iloc[0]
        assert row['opponent_id'] == 'LV'
        assert row['home_away'] == 'home'
        assert row['team_score'] == 28
        assert row['opponent_score'] == 21
        assert row['result'] == 'W'

    def test_away_game_context(self):
        """Away QB should get correct score orientation."""
        from ingest import aggregate_qb_weekly_stats
        plays = make_qb_play(
            posteam='LV', defteam='KC', home_team='KC', away_team='LV',
            total_home_score=28.0, total_away_score=21.0,
            passer_player_id='QB1',
        )
        roster = make_roster('QB1', 'QB')
        result = aggregate_qb_weekly_stats(plays, roster, 2025)
        row = result.iloc[0]
        assert row['home_away'] == 'away'
        assert row['team_score'] == 21
        assert row['opponent_score'] == 28
        assert row['result'] == 'L'

    def test_passer_rating_computed(self):
        """Verify passer_rating > 0 for a completion."""
        from ingest import aggregate_qb_weekly_stats
        plays = make_qb_play(complete_pass=1, passing_yards=20.0, pass_touchdown=0,
                             interception=0)
        roster = make_roster('QB1', 'QB')
        result = aggregate_qb_weekly_stats(plays, roster, 2025)
        assert result.iloc[0]['passer_rating'] > 0

    def test_multiple_weeks(self):
        """2 plays in different weeks -> 2 rows."""
        from ingest import aggregate_qb_weekly_stats
        plays = pd.concat([
            make_qb_play(week=1, game_id='2025_01_LV_KC'),
            make_qb_play(week=2, game_id='2025_02_BUF_KC', defteam='BUF', away_team='BUF'),
        ], ignore_index=True)
        roster = make_roster('QB1', 'QB')
        result = aggregate_qb_weekly_stats(plays, roster, 2025)
        assert len(result) == 2
        assert set(result['week'].tolist()) == {1, 2}

    def test_sack_not_counted_as_attempt(self):
        """Sack plays should count as sacks but not pass attempts."""
        from ingest import aggregate_qb_weekly_stats
        plays = pd.concat([
            make_qb_play(complete_pass=1, passing_yards=10.0),
            make_qb_play(sack=1, complete_pass=0, passing_yards=0.0,
                         yards_gained=-7, receiver_player_id=None, play_id=2),
        ], ignore_index=True)
        roster = make_roster('QB1', 'QB')
        result = aggregate_qb_weekly_stats(plays, roster, 2025)
        row = result.iloc[0]
        assert row['attempts'] == 1  # Only non-sack pass
        assert row['sacks'] == 1

    def test_rush_stats_included(self):
        """QB designed runs + scrambles aggregate into rush stats."""
        from ingest import aggregate_qb_weekly_stats
        pass_play = make_qb_play()
        rush_play = make_rush_play(
            rusher_player_id='QB1', rusher_player_name='Test QB',
            rushing_yards=15.0, rush_touchdown=1,
        )
        plays = pd.concat([pass_play, rush_play], ignore_index=True)
        roster = make_roster('QB1', 'QB')
        result = aggregate_qb_weekly_stats(plays, roster, 2025)
        row = result.iloc[0]
        assert row['rush_attempts'] >= 1
        assert row['rush_yards'] >= 15
        assert row['rush_tds'] >= 1

    def test_non_qb_filtered_out(self):
        """Passers not in roster as QB should be excluded."""
        from ingest import aggregate_qb_weekly_stats
        plays = make_qb_play(passer_player_id='WR1')
        roster = make_roster('QB1', 'QB')  # WR1 not in QB roster
        result = aggregate_qb_weekly_stats(plays, roster, 2025)
        assert len(result) == 0


# ---------------------------------------------------------------------------
# Receiver Weekly Stats
# ---------------------------------------------------------------------------

class TestReceiverWeeklyStats:
    """Tests for aggregate_receiver_weekly_stats."""

    def test_basic_aggregation(self):
        """Targets, receptions, yards from pass plays."""
        from ingest import aggregate_receiver_weekly_stats
        plays = pd.concat([
            make_qb_play(receiver_player_id='WR1', complete_pass=1, receiving_yards=15.0),
            make_qb_play(receiver_player_id='WR1', complete_pass=0, receiving_yards=0.0, play_id=2),
        ], ignore_index=True)
        roster = make_multi_roster([('WR1', 'WR'), ('QB1', 'QB')])
        result = aggregate_receiver_weekly_stats(plays, roster, 2025)
        assert len(result) == 1
        row = result.iloc[0]
        assert row['targets'] == 2
        assert row['receptions'] == 1
        assert row['receiving_yards'] == 15

    def test_game_context(self):
        """Opponent and result derived correctly."""
        from ingest import aggregate_receiver_weekly_stats
        plays = make_qb_play(
            receiver_player_id='WR1',
            posteam='KC', defteam='LV', home_team='KC', away_team='LV',
            total_home_score=31.0, total_away_score=17.0,
        )
        roster = make_multi_roster([('WR1', 'WR'), ('QB1', 'QB')])
        result = aggregate_receiver_weekly_stats(plays, roster, 2025)
        row = result.iloc[0]
        assert row['opponent_id'] == 'LV'
        assert row['result'] == 'W'
        assert row['team_score'] == 31

    def test_catch_rate(self):
        """Catch rate = receptions / targets."""
        from ingest import aggregate_receiver_weekly_stats
        plays = pd.concat([
            make_qb_play(receiver_player_id='WR1', complete_pass=1, receiving_yards=10.0),
            make_qb_play(receiver_player_id='WR1', complete_pass=1, receiving_yards=8.0, play_id=2),
            make_qb_play(receiver_player_id='WR1', complete_pass=0, receiving_yards=0.0, play_id=3),
            make_qb_play(receiver_player_id='WR1', complete_pass=0, receiving_yards=0.0, play_id=4),
        ], ignore_index=True)
        roster = make_multi_roster([('WR1', 'WR'), ('QB1', 'QB')])
        result = aggregate_receiver_weekly_stats(plays, roster, 2025)
        assert abs(result.iloc[0]['catch_rate'] - 0.5) < 0.01

    def test_receiving_tds(self):
        """TD only counted on completions."""
        from ingest import aggregate_receiver_weekly_stats
        plays = pd.concat([
            make_qb_play(receiver_player_id='WR1', complete_pass=1, pass_touchdown=1,
                         receiving_yards=25.0),
            make_qb_play(receiver_player_id='WR1', complete_pass=0, pass_touchdown=0,
                         receiving_yards=0.0, play_id=2),
        ], ignore_index=True)
        roster = make_multi_roster([('WR1', 'WR'), ('QB1', 'QB')])
        result = aggregate_receiver_weekly_stats(plays, roster, 2025)
        assert result.iloc[0]['receiving_tds'] == 1

    def test_multiple_weeks(self):
        """Different weeks produce separate rows."""
        from ingest import aggregate_receiver_weekly_stats
        plays = pd.concat([
            make_qb_play(receiver_player_id='WR1', week=1, game_id='2025_01_LV_KC'),
            make_qb_play(receiver_player_id='WR1', week=3, game_id='2025_03_BUF_KC',
                         defteam='BUF', away_team='BUF', play_id=2),
        ], ignore_index=True)
        roster = make_multi_roster([('WR1', 'WR'), ('QB1', 'QB')])
        result = aggregate_receiver_weekly_stats(plays, roster, 2025)
        assert len(result) == 2

    def test_qb_excluded_from_receivers(self):
        """QBs should not appear in receiver weekly stats."""
        from ingest import aggregate_receiver_weekly_stats
        plays = make_qb_play(receiver_player_id='QB2')
        roster = make_multi_roster([('QB2', 'QB'), ('QB1', 'QB')])
        result = aggregate_receiver_weekly_stats(plays, roster, 2025)
        assert len(result) == 0  # QB2 filtered out by position check


# ---------------------------------------------------------------------------
# RB Weekly Stats
# ---------------------------------------------------------------------------

class TestRBWeeklyStats:
    """Tests for aggregate_rb_weekly_stats."""

    def test_basic_aggregation(self):
        """Carries and yards from rush plays."""
        from ingest import aggregate_rb_weekly_stats
        plays = pd.concat([
            make_rush_play(rusher_player_id='RB1', rushing_yards=8.0, yards_gained=8.0),
            make_rush_play(rusher_player_id='RB1', rushing_yards=3.0, yards_gained=3.0, play_id=101),
        ], ignore_index=True)
        roster = make_multi_roster([('RB1', 'RB')])
        result = aggregate_rb_weekly_stats(plays, roster, 2025)
        assert len(result) == 1
        row = result.iloc[0]
        assert row['carries'] == 2
        assert row['rushing_yards'] == 11

    def test_stuff_rate(self):
        """Play with 0 yards -> stuff_rate = 1.0."""
        from ingest import aggregate_rb_weekly_stats
        plays = make_rush_play(
            rusher_player_id='RB1', rushing_yards=0.0, yards_gained=0.0,
        )
        roster = make_multi_roster([('RB1', 'RB')])
        result = aggregate_rb_weekly_stats(plays, roster, 2025)
        assert abs(result.iloc[0]['stuff_rate'] - 1.0) < 0.01

    def test_explosive_rate(self):
        """Play with 12 yards -> explosive_rate = 1.0."""
        from ingest import aggregate_rb_weekly_stats
        plays = make_rush_play(
            rusher_player_id='RB1', rushing_yards=12.0, yards_gained=12.0,
        )
        roster = make_multi_roster([('RB1', 'RB')])
        result = aggregate_rb_weekly_stats(plays, roster, 2025)
        assert abs(result.iloc[0]['explosive_rate'] - 1.0) < 0.01

    def test_game_context(self):
        """Opponent and result derived correctly for RB."""
        from ingest import aggregate_rb_weekly_stats
        plays = make_rush_play(
            rusher_player_id='RB1',
            posteam='KC', defteam='LV', home_team='KC', away_team='LV',
            total_home_score=35.0, total_away_score=10.0,
        )
        roster = make_multi_roster([('RB1', 'RB')])
        result = aggregate_rb_weekly_stats(plays, roster, 2025)
        row = result.iloc[0]
        assert row['opponent_id'] == 'LV'
        assert row['result'] == 'W'
        assert row['team_score'] == 35
        assert row['opponent_score'] == 10

    def test_receiving_stats_included(self):
        """RB receiving stats (targets/receptions) merged in."""
        from ingest import aggregate_rb_weekly_stats
        rush = make_rush_play(rusher_player_id='RB1', rushing_yards=5.0, yards_gained=5.0)
        recv = make_qb_play(
            receiver_player_id='RB1', receiver_player_name='Test RB',
            complete_pass=1, receiving_yards=8.0, play_id=200,
        )
        plays = pd.concat([rush, recv], ignore_index=True)
        roster = make_multi_roster([('RB1', 'RB'), ('QB1', 'QB')])
        result = aggregate_rb_weekly_stats(plays, roster, 2025)
        row = result.iloc[0]
        assert row['carries'] == 1
        assert row['targets'] == 1
        assert row['receptions'] == 1
        assert row['receiving_yards'] == 8

    def test_qb_excluded_from_rb_rushing(self):
        """QB designed runs should NOT appear in RB weekly stats."""
        from ingest import aggregate_rb_weekly_stats
        plays = make_rush_play(rusher_player_id='QB1', rusher_player_name='Test QB')
        roster = make_multi_roster([('QB1', 'QB'), ('RB1', 'RB')])
        result = aggregate_rb_weekly_stats(plays, roster, 2025)
        assert len(result) == 0  # QB1 not in RB roster

    def test_multiple_weeks(self):
        """Different weeks produce separate rows."""
        from ingest import aggregate_rb_weekly_stats
        plays = pd.concat([
            make_rush_play(rusher_player_id='RB1', week=1, game_id='2025_01_LV_KC'),
            make_rush_play(rusher_player_id='RB1', week=5, game_id='2025_05_BUF_KC',
                           defteam='BUF', away_team='BUF', play_id=101),
        ], ignore_index=True)
        roster = make_multi_roster([('RB1', 'RB')])
        result = aggregate_rb_weekly_stats(plays, roster, 2025)
        assert len(result) == 2
        assert set(result['week'].tolist()) == {1, 5}

    def test_fumbles(self):
        """Fumbles attributed via fumbled_1_player_id."""
        from ingest import aggregate_rb_weekly_stats
        plays = make_rush_play(
            rusher_player_id='RB1', rushing_yards=2.0, yards_gained=2.0,
            fumble=1, fumble_lost=1, fumbled_1_player_id='RB1',
        )
        roster = make_multi_roster([('RB1', 'RB')])
        result = aggregate_rb_weekly_stats(plays, roster, 2025)
        row = result.iloc[0]
        assert row['fumbles'] == 1
        assert row['fumbles_lost'] == 1

    def test_negative_yards_stuff(self):
        """Negative yardage play is a stuff."""
        from ingest import aggregate_rb_weekly_stats
        plays = make_rush_play(
            rusher_player_id='RB1', rushing_yards=-3.0, yards_gained=-3.0,
        )
        roster = make_multi_roster([('RB1', 'RB')])
        result = aggregate_rb_weekly_stats(plays, roster, 2025)
        assert abs(result.iloc[0]['stuff_rate'] - 1.0) < 0.01
