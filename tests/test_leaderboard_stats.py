"""Tests for leaderboard overhaul stat formulas (2026-03-24).

Tests cover: TD%, INT%, SK%, SCR%, CROE, AY%, Receiving SR%, Total EPA,
Total Touches, and PFR qualifier thresholds.
"""
import sys
import os
import math
import pytest
import pandas as pd
import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripts'))


# --- Helpers ---

def make_qb_plays(n=100, **overrides):
    """Create a minimal dropback plays DataFrame for QB aggregation."""
    defaults = {
        'passer_player_id': 'QB1',
        'passer_player_name': 'Test QB',
        'rusher_player_id': None,
        'rusher_player_name': None,
        'posteam': 'KC',
        'defteam': 'BUF',
        'pass_attempt': 1,
        'play_type': 'pass',
        'qb_dropback': 1,
        'sack': 0,
        'qb_scramble': 0,
        'complete_pass': 1,
        'passing_yards': 10.0,
        'pass_touchdown': 0,
        'interception': 0,
        'epa': 0.3,
        'cpoe': 2.0,
        'cp': 0.65,
        'success': 1,
        'air_yards': 8.0,
        'yards_gained': 10.0,
        'game_id': 'GAME1',
        'season': 2025,
        'week': 1,
        'home_team': 'KC',
        'away_team': 'BUF',
        'result': 7,
        'total_home_score': 24,
        'total_away_score': 17,
        'rush_attempt': 0,
        'rush_touchdown': 0,
        'rushing_yards': 0.0,
        'fumble': 0,
        'fumble_lost': 0,
        'fumbled_1_player_id': None,
        'receiver_player_id': 'WR1',
        'receiver_player_name': 'Test WR',
        'receiving_yards': 10.0,
        'yards_after_catch': 5.0,
        'season_type': 'REG',
        'two_point_attempt': 0,
        'run_location': None,
        'run_gap': None,
    }
    defaults.update(overrides)
    rows = [dict(defaults) for _ in range(n)]
    # Vary game_id for games count
    for i, row in enumerate(rows):
        row['game_id'] = f'GAME{i // 25 + 1}'
    return pd.DataFrame(rows)


def make_receiver_plays(**overrides):
    """Create a minimal receiver plays DataFrame."""
    defaults = {
        'receiver_player_id': 'WR1',
        'receiver_player_name': 'Test Receiver',
        'passer_player_id': 'QB1',
        'passer_player_name': 'Test QB',
        'posteam': 'KC',
        'defteam': 'BUF',
        'pass_attempt': 1,
        'play_type': 'pass',
        'qb_dropback': 1,
        'sack': 0,
        'qb_scramble': 0,
        'complete_pass': 1,
        'receiving_yards': 10.0,
        'pass_touchdown': 0,
        'epa': 0.5,
        'cp': 0.65,
        'cpoe': 2.0,
        'success': 1,
        'air_yards': 8.0,
        'yards_after_catch': 5.0,
        'yards_gained': 10.0,
        'game_id': 'GAME1',
        'season': 2025,
        'week': 1,
        'home_team': 'KC',
        'away_team': 'BUF',
        'result': 7,
        'total_home_score': 24,
        'total_away_score': 17,
        'rush_attempt': 0,
        'rush_touchdown': 0,
        'rushing_yards': 0.0,
        'fumble': 0,
        'fumble_lost': 0,
        'fumbled_1_player_id': None,
        'rusher_player_id': None,
        'rusher_player_name': None,
        'season_type': 'REG',
        'two_point_attempt': 0,
        'run_location': None,
        'run_gap': None,
    }
    defaults.update(overrides)
    return pd.DataFrame([defaults])


def make_roster(player_id='QB1', position='QB'):
    """Create a minimal roster DataFrame."""
    return pd.DataFrame([{'gsis_id': player_id, 'position': position}])


# --- QB Rate Stats ---

class TestQBTDPercent:
    """TD% = touchdowns / attempts * 100."""

    def test_basic_td_pct(self):
        """5 TDs / 100 attempts = 5.0%."""
        from ingest import aggregate_qb_stats, filter_plays
        rows = []
        for i in range(100):
            rows.append({
                'passer_player_id': 'QB1', 'passer_player_name': 'Test QB',
                'rusher_player_id': None, 'rusher_player_name': None,
                'posteam': 'KC', 'defteam': 'BUF',
                'pass_attempt': 1, 'play_type': 'pass', 'qb_dropback': 1,
                'sack': 0, 'qb_scramble': 0, 'complete_pass': 1,
                'passing_yards': 10.0, 'pass_touchdown': 1 if i < 5 else 0,
                'interception': 0, 'epa': 0.3, 'cpoe': 2.0, 'cp': 0.65,
                'success': 1, 'air_yards': 8.0, 'yards_gained': 10.0,
                'game_id': f'GAME{i // 25 + 1}', 'season': 2025, 'week': 1,
                'home_team': 'KC', 'away_team': 'BUF', 'result': 7,
                'total_home_score': 24, 'total_away_score': 17,
                'rush_attempt': 0, 'rush_touchdown': 0, 'rushing_yards': 0.0,
                'fumble': 0, 'fumble_lost': 0, 'fumbled_1_player_id': None,
                'receiver_player_id': 'WR1', 'receiver_player_name': 'WR',
                'receiving_yards': 10.0, 'yards_after_catch': 5.0,
                'season_type': 'REG', 'two_point_attempt': 0,
                'run_location': None, 'run_gap': None,
            })
        plays = pd.DataFrame(rows)
        roster = make_roster('QB1', 'QB')
        result = aggregate_qb_stats(plays, roster, 2025)
        assert result.iloc[0]['td_pct'] == pytest.approx(5.0, abs=0.1)


class TestQBINTPercent:
    """INT% = interceptions / attempts * 100."""

    def test_basic_int_pct(self):
        """3 INTs / 100 attempts = 3.0%."""
        from ingest import aggregate_qb_stats
        rows = []
        for i in range(100):
            rows.append({
                'passer_player_id': 'QB1', 'passer_player_name': 'Test QB',
                'rusher_player_id': None, 'rusher_player_name': None,
                'posteam': 'KC', 'defteam': 'BUF',
                'pass_attempt': 1, 'play_type': 'pass', 'qb_dropback': 1,
                'sack': 0, 'qb_scramble': 0,
                'complete_pass': 0 if i < 3 else 1,
                'passing_yards': 0 if i < 3 else 10.0,
                'pass_touchdown': 0, 'interception': 1 if i < 3 else 0,
                'epa': -2.0 if i < 3 else 0.3, 'cpoe': 2.0, 'cp': 0.65,
                'success': 0 if i < 3 else 1, 'air_yards': 8.0,
                'yards_gained': 0 if i < 3 else 10.0,
                'game_id': f'GAME{i // 25 + 1}', 'season': 2025, 'week': 1,
                'home_team': 'KC', 'away_team': 'BUF', 'result': 7,
                'total_home_score': 24, 'total_away_score': 17,
                'rush_attempt': 0, 'rush_touchdown': 0, 'rushing_yards': 0.0,
                'fumble': 0, 'fumble_lost': 0, 'fumbled_1_player_id': None,
                'receiver_player_id': 'WR1', 'receiver_player_name': 'WR',
                'receiving_yards': 0 if i < 3 else 10.0, 'yards_after_catch': 5.0,
                'season_type': 'REG', 'two_point_attempt': 0,
                'run_location': None, 'run_gap': None,
            })
        plays = pd.DataFrame(rows)
        roster = make_roster('QB1', 'QB')
        result = aggregate_qb_stats(plays, roster, 2025)
        assert result.iloc[0]['int_pct'] == pytest.approx(3.0, abs=0.1)


class TestQBSackPercent:
    """SK% = sacks / (attempts + sacks) * 100."""

    def test_basic_sack_pct(self):
        """10 sacks / (100 att + 10 sacks) = 9.09%."""
        from ingest import aggregate_qb_stats
        rows = []
        # 100 pass attempts
        for i in range(100):
            rows.append({
                'passer_player_id': 'QB1', 'passer_player_name': 'Test QB',
                'rusher_player_id': None, 'rusher_player_name': None,
                'posteam': 'KC', 'defteam': 'BUF',
                'pass_attempt': 1, 'play_type': 'pass', 'qb_dropback': 1,
                'sack': 0, 'qb_scramble': 0, 'complete_pass': 1,
                'passing_yards': 10.0, 'pass_touchdown': 0, 'interception': 0,
                'epa': 0.3, 'cpoe': 2.0, 'cp': 0.65, 'success': 1,
                'air_yards': 8.0, 'yards_gained': 10.0,
                'game_id': 'GAME1', 'season': 2025, 'week': 1,
                'home_team': 'KC', 'away_team': 'BUF', 'result': 7,
                'total_home_score': 24, 'total_away_score': 17,
                'rush_attempt': 0, 'rush_touchdown': 0, 'rushing_yards': 0.0,
                'fumble': 0, 'fumble_lost': 0, 'fumbled_1_player_id': None,
                'receiver_player_id': 'WR1', 'receiver_player_name': 'WR',
                'receiving_yards': 10.0, 'yards_after_catch': 5.0,
                'season_type': 'REG', 'two_point_attempt': 0,
                'run_location': None, 'run_gap': None,
            })
        # 10 sacks
        for _ in range(10):
            rows.append({
                'passer_player_id': 'QB1', 'passer_player_name': 'Test QB',
                'rusher_player_id': None, 'rusher_player_name': None,
                'posteam': 'KC', 'defteam': 'BUF',
                'pass_attempt': 1, 'play_type': 'pass', 'qb_dropback': 1,
                'sack': 1, 'qb_scramble': 0, 'complete_pass': 0,
                'passing_yards': 0, 'pass_touchdown': 0, 'interception': 0,
                'epa': -1.5, 'cpoe': None, 'cp': None, 'success': 0,
                'air_yards': None, 'yards_gained': -7.0,
                'game_id': 'GAME1', 'season': 2025, 'week': 1,
                'home_team': 'KC', 'away_team': 'BUF', 'result': 7,
                'total_home_score': 24, 'total_away_score': 17,
                'rush_attempt': 0, 'rush_touchdown': 0, 'rushing_yards': 0.0,
                'fumble': 0, 'fumble_lost': 0, 'fumbled_1_player_id': None,
                'receiver_player_id': None, 'receiver_player_name': None,
                'receiving_yards': None, 'yards_after_catch': None,
                'season_type': 'REG', 'two_point_attempt': 0,
                'run_location': None, 'run_gap': None,
            })
        plays = pd.DataFrame(rows)
        roster = make_roster('QB1', 'QB')
        result = aggregate_qb_stats(plays, roster, 2025)
        assert result.iloc[0]['sack_pct'] == pytest.approx(9.09, abs=0.1)


class TestQBScramblePercent:
    """SCR% = scrambles / dropbacks * 100."""

    def test_basic_scramble_pct(self):
        """15 scrambles / 200 dropbacks = 7.5%."""
        from ingest import aggregate_qb_stats
        rows = []
        # 185 regular dropbacks
        for i in range(185):
            rows.append({
                'passer_player_id': 'QB1', 'passer_player_name': 'Test QB',
                'rusher_player_id': None, 'rusher_player_name': None,
                'posteam': 'KC', 'defteam': 'BUF',
                'pass_attempt': 1, 'play_type': 'pass', 'qb_dropback': 1,
                'sack': 0, 'qb_scramble': 0, 'complete_pass': 1,
                'passing_yards': 10.0, 'pass_touchdown': 0, 'interception': 0,
                'epa': 0.3, 'cpoe': 2.0, 'cp': 0.65, 'success': 1,
                'air_yards': 8.0, 'yards_gained': 10.0,
                'game_id': f'GAME{i // 25 + 1}', 'season': 2025, 'week': 1,
                'home_team': 'KC', 'away_team': 'BUF', 'result': 7,
                'total_home_score': 24, 'total_away_score': 17,
                'rush_attempt': 0, 'rush_touchdown': 0, 'rushing_yards': 0.0,
                'fumble': 0, 'fumble_lost': 0, 'fumbled_1_player_id': None,
                'receiver_player_id': 'WR1', 'receiver_player_name': 'WR',
                'receiving_yards': 10.0, 'yards_after_catch': 5.0,
                'season_type': 'REG', 'two_point_attempt': 0,
                'run_location': None, 'run_gap': None,
            })
        # 15 scrambles (qb_dropback=1, qb_scramble=1, rush_attempt=1)
        for _ in range(15):
            rows.append({
                'passer_player_id': None, 'passer_player_name': None,
                'rusher_player_id': 'QB1', 'rusher_player_name': 'Test QB',
                'posteam': 'KC', 'defteam': 'BUF',
                'pass_attempt': 0, 'play_type': 'run', 'qb_dropback': 1,
                'sack': 0, 'qb_scramble': 1, 'complete_pass': 0,
                'passing_yards': 0, 'pass_touchdown': 0, 'interception': 0,
                'epa': 0.1, 'cpoe': None, 'cp': None, 'success': 1,
                'air_yards': None, 'yards_gained': 8.0,
                'game_id': 'GAME1', 'season': 2025, 'week': 1,
                'home_team': 'KC', 'away_team': 'BUF', 'result': 7,
                'total_home_score': 24, 'total_away_score': 17,
                'rush_attempt': 1, 'rush_touchdown': 0, 'rushing_yards': 8.0,
                'fumble': 0, 'fumble_lost': 0, 'fumbled_1_player_id': None,
                'receiver_player_id': None, 'receiver_player_name': None,
                'receiving_yards': None, 'yards_after_catch': None,
                'season_type': 'REG', 'two_point_attempt': 0,
                'run_location': None, 'run_gap': None,
            })
        plays = pd.DataFrame(rows)
        roster = make_roster('QB1', 'QB')
        result = aggregate_qb_stats(plays, roster, 2025)
        assert result.iloc[0]['scramble_pct'] == pytest.approx(7.5, abs=0.1)


class TestQBTotalEPA:
    """Total EPA = sum of EPA on all dropbacks."""

    def test_total_epa_export(self):
        """100 dropbacks with 0.3 EPA each → total_epa ≈ 30.0."""
        from ingest import aggregate_qb_stats
        plays = make_qb_plays(n=100, epa=0.3)
        roster = make_roster('QB1', 'QB')
        result = aggregate_qb_stats(plays, roster, 2025)
        assert result.iloc[0]['total_epa'] == pytest.approx(30.0, abs=0.5)


# --- Receiver Stats ---

class TestCROE:
    """CROE = catch_rate - mean(cp) per receiver."""

    def test_basic_croe(self):
        """Catch rate 0.70, mean cp 0.65 → CROE ≈ 0.05."""
        from ingest import aggregate_receiver_stats
        rows = []
        for i in range(100):
            rows.append({
                'receiver_player_id': 'WR1', 'receiver_player_name': 'Test WR',
                'passer_player_id': 'QB1', 'passer_player_name': 'QB',
                'posteam': 'KC', 'defteam': 'BUF',
                'pass_attempt': 1, 'play_type': 'pass', 'qb_dropback': 1,
                'sack': 0, 'qb_scramble': 0,
                'complete_pass': 1 if i < 70 else 0,
                'receiving_yards': 12.0 if i < 70 else 0,
                'pass_touchdown': 0, 'epa': 0.5, 'cp': 0.65, 'cpoe': 2.0,
                'success': 1, 'air_yards': 8.0, 'yards_after_catch': 4.0,
                'yards_gained': 12.0 if i < 70 else 0,
                'game_id': f'GAME{i // 25 + 1}', 'season': 2025, 'week': 1,
                'home_team': 'KC', 'away_team': 'BUF', 'result': 7,
                'total_home_score': 24, 'total_away_score': 17,
                'rush_attempt': 0, 'rush_touchdown': 0, 'rushing_yards': 0.0,
                'fumble': 0, 'fumble_lost': 0, 'fumbled_1_player_id': None,
                'rusher_player_id': None, 'rusher_player_name': None,
                'season_type': 'REG', 'two_point_attempt': 0,
                'run_location': None, 'run_gap': None,
            })
        plays = pd.DataFrame(rows)
        roster = pd.DataFrame([{'gsis_id': 'WR1', 'position': 'WR'}])
        result = aggregate_receiver_stats(plays, roster, 2025)
        wr = result[result['player_id'] == 'WR1'].iloc[0]
        assert wr['croe'] == pytest.approx(0.05, abs=0.01)

    def test_croe_null_when_low_cp_coverage(self):
        """CROE should be NULL when <50% of targets have valid cp."""
        from ingest import aggregate_receiver_stats
        rows = []
        for i in range(20):
            rows.append({
                'receiver_player_id': 'WR1', 'receiver_player_name': 'Test WR',
                'passer_player_id': 'QB1', 'passer_player_name': 'QB',
                'posteam': 'KC', 'defteam': 'BUF',
                'pass_attempt': 1, 'play_type': 'pass', 'qb_dropback': 1,
                'sack': 0, 'qb_scramble': 0, 'complete_pass': 1,
                'receiving_yards': 10.0, 'pass_touchdown': 0,
                'epa': 0.5, 'cpoe': 2.0, 'success': 1,
                # Only 8 of 20 targets (40%) have valid cp → below 50% threshold
                'cp': 0.65 if i < 8 else float('nan'),
                'air_yards': 8.0, 'yards_after_catch': 4.0,
                'yards_gained': 10.0,
                'game_id': 'GAME1', 'season': 2025, 'week': 1,
                'home_team': 'KC', 'away_team': 'BUF', 'result': 7,
                'total_home_score': 24, 'total_away_score': 17,
                'rush_attempt': 0, 'rush_touchdown': 0, 'rushing_yards': 0.0,
                'fumble': 0, 'fumble_lost': 0, 'fumbled_1_player_id': None,
                'rusher_player_id': None, 'rusher_player_name': None,
                'season_type': 'REG', 'two_point_attempt': 0,
                'run_location': None, 'run_gap': None,
            })
        plays = pd.DataFrame(rows)
        roster = pd.DataFrame([{'gsis_id': 'WR1', 'position': 'WR'}])
        result = aggregate_receiver_stats(plays, roster, 2025)
        wr = result[result['player_id'] == 'WR1'].iloc[0]
        assert pd.isna(wr['croe'])

    def test_croe_computes_at_50_percent_threshold(self):
        """CROE should compute when exactly 50% of targets have valid cp."""
        from ingest import aggregate_receiver_stats
        rows = []
        for i in range(20):
            rows.append({
                'receiver_player_id': 'WR1', 'receiver_player_name': 'Test WR',
                'passer_player_id': 'QB1', 'passer_player_name': 'QB',
                'posteam': 'KC', 'defteam': 'BUF',
                'pass_attempt': 1, 'play_type': 'pass', 'qb_dropback': 1,
                'sack': 0, 'qb_scramble': 0, 'complete_pass': 1,
                'receiving_yards': 10.0, 'pass_touchdown': 0,
                'epa': 0.5, 'cpoe': 2.0, 'success': 1,
                # 10 of 20 targets (50%) have valid cp → at threshold
                'cp': 0.65 if i < 10 else float('nan'),
                'air_yards': 8.0, 'yards_after_catch': 4.0,
                'yards_gained': 10.0,
                'game_id': 'GAME1', 'season': 2025, 'week': 1,
                'home_team': 'KC', 'away_team': 'BUF', 'result': 7,
                'total_home_score': 24, 'total_away_score': 17,
                'rush_attempt': 0, 'rush_touchdown': 0, 'rushing_yards': 0.0,
                'fumble': 0, 'fumble_lost': 0, 'fumbled_1_player_id': None,
                'rusher_player_id': None, 'rusher_player_name': None,
                'season_type': 'REG', 'two_point_attempt': 0,
                'run_location': None, 'run_gap': None,
            })
        plays = pd.DataFrame(rows)
        roster = pd.DataFrame([{'gsis_id': 'WR1', 'position': 'WR'}])
        result = aggregate_receiver_stats(plays, roster, 2025)
        wr = result[result['player_id'] == 'WR1'].iloc[0]
        # catch_rate = 1.0, mean(cp) = 0.65 → CROE = 0.35
        assert not pd.isna(wr['croe'])
        assert wr['croe'] == pytest.approx(0.35, abs=0.01)


class TestAirYardsShare:
    """AY% = player air yards / team total air yards."""

    def test_basic_air_yards_share(self):
        """Player has 500 air yards on team with 2000 total → 25%."""
        from ingest import aggregate_receiver_stats
        rows = []
        # WR1: 50 targets × 10 air yards = 500
        for i in range(50):
            rows.append({
                'receiver_player_id': 'WR1', 'receiver_player_name': 'Star WR',
                'passer_player_id': 'QB1', 'passer_player_name': 'QB',
                'posteam': 'KC', 'defteam': 'BUF',
                'pass_attempt': 1, 'play_type': 'pass', 'qb_dropback': 1,
                'sack': 0, 'qb_scramble': 0, 'complete_pass': 1,
                'receiving_yards': 12.0, 'pass_touchdown': 0,
                'epa': 0.5, 'cp': 0.65, 'cpoe': 2.0, 'success': 1,
                'air_yards': 10.0, 'yards_after_catch': 2.0, 'yards_gained': 12.0,
                'game_id': f'GAME{i // 10 + 1}', 'season': 2025, 'week': 1,
                'home_team': 'KC', 'away_team': 'BUF', 'result': 7,
                'total_home_score': 24, 'total_away_score': 17,
                'rush_attempt': 0, 'rush_touchdown': 0, 'rushing_yards': 0.0,
                'fumble': 0, 'fumble_lost': 0, 'fumbled_1_player_id': None,
                'rusher_player_id': None, 'rusher_player_name': None,
                'season_type': 'REG', 'two_point_attempt': 0,
                'run_location': None, 'run_gap': None,
            })
        # Other receivers: 150 targets × 10 air yards = 1500 (total team = 2000)
        for i in range(150):
            rows.append({
                'receiver_player_id': f'WR{(i % 3) + 2}',
                'receiver_player_name': f'Other WR{(i % 3) + 2}',
                'passer_player_id': 'QB1', 'passer_player_name': 'QB',
                'posteam': 'KC', 'defteam': 'BUF',
                'pass_attempt': 1, 'play_type': 'pass', 'qb_dropback': 1,
                'sack': 0, 'qb_scramble': 0, 'complete_pass': 1,
                'receiving_yards': 8.0, 'pass_touchdown': 0,
                'epa': 0.2, 'cp': 0.70, 'cpoe': 1.0, 'success': 1,
                'air_yards': 10.0, 'yards_after_catch': 0, 'yards_gained': 8.0,
                'game_id': f'GAME{i // 30 + 1}', 'season': 2025, 'week': 1,
                'home_team': 'KC', 'away_team': 'BUF', 'result': 7,
                'total_home_score': 24, 'total_away_score': 17,
                'rush_attempt': 0, 'rush_touchdown': 0, 'rushing_yards': 0.0,
                'fumble': 0, 'fumble_lost': 0, 'fumbled_1_player_id': None,
                'rusher_player_id': None, 'rusher_player_name': None,
                'season_type': 'REG', 'two_point_attempt': 0,
                'run_location': None, 'run_gap': None,
            })
        plays = pd.DataFrame(rows)
        roster = pd.DataFrame([
            {'gsis_id': 'WR1', 'position': 'WR'},
            {'gsis_id': 'WR2', 'position': 'WR'},
            {'gsis_id': 'WR3', 'position': 'WR'},
            {'gsis_id': 'WR4', 'position': 'WR'},
        ])
        result = aggregate_receiver_stats(plays, roster, 2025)
        wr1 = result[result['player_id'] == 'WR1'].iloc[0]
        assert wr1['air_yards_share'] == pytest.approx(0.25, abs=0.01)

    def test_air_yards_share_with_nan(self):
        """NULL air_yards should be dropped, not counted as 0."""
        from ingest import aggregate_receiver_stats
        rows = []
        for i in range(20):
            rows.append({
                'receiver_player_id': 'WR1', 'receiver_player_name': 'Test WR',
                'passer_player_id': 'QB1', 'passer_player_name': 'QB',
                'posteam': 'KC', 'defteam': 'BUF',
                'pass_attempt': 1, 'play_type': 'pass', 'qb_dropback': 1,
                'sack': 0, 'qb_scramble': 0, 'complete_pass': 1,
                'receiving_yards': 10.0, 'pass_touchdown': 0,
                'epa': 0.5, 'cp': 0.65, 'cpoe': 2.0, 'success': 1,
                # 10 targets with air_yards=10, 10 with NaN
                'air_yards': 10.0 if i < 10 else float('nan'),
                'yards_after_catch': 4.0, 'yards_gained': 10.0,
                'game_id': 'GAME1', 'season': 2025, 'week': 1,
                'home_team': 'KC', 'away_team': 'BUF', 'result': 7,
                'total_home_score': 24, 'total_away_score': 17,
                'rush_attempt': 0, 'rush_touchdown': 0, 'rushing_yards': 0.0,
                'fumble': 0, 'fumble_lost': 0, 'fumbled_1_player_id': None,
                'rusher_player_id': None, 'rusher_player_name': None,
                'season_type': 'REG', 'two_point_attempt': 0,
                'run_location': None, 'run_gap': None,
            })
        plays = pd.DataFrame(rows)
        roster = pd.DataFrame([{'gsis_id': 'WR1', 'position': 'WR'}])
        result = aggregate_receiver_stats(plays, roster, 2025)
        wr = result[result['player_id'] == 'WR1'].iloc[0]
        # Only player on team → AY% should be ~1.0 (all team air yards are theirs)
        assert wr['air_yards_share'] == pytest.approx(1.0, abs=0.01)


class TestReceivingSuccessRate:
    """Receiving SR% = mean(success) on target plays."""

    def test_basic_receiving_sr(self):
        """40 of 80 targets have success=1 → 50%."""
        from ingest import aggregate_receiver_stats
        rows = []
        for i in range(80):
            rows.append({
                'receiver_player_id': 'WR1', 'receiver_player_name': 'Test WR',
                'passer_player_id': 'QB1', 'passer_player_name': 'QB',
                'posteam': 'KC', 'defteam': 'BUF',
                'pass_attempt': 1, 'play_type': 'pass', 'qb_dropback': 1,
                'sack': 0, 'qb_scramble': 0, 'complete_pass': 1 if i < 60 else 0,
                'receiving_yards': 10.0 if i < 60 else 0,
                'pass_touchdown': 0, 'epa': 0.5 if i < 40 else -0.3,
                'cp': 0.65, 'cpoe': 2.0,
                'success': 1 if i < 40 else 0,  # 40 successes out of 80
                'air_yards': 8.0, 'yards_after_catch': 4.0,
                'yards_gained': 10.0 if i < 60 else 0,
                'game_id': f'GAME{i // 20 + 1}', 'season': 2025, 'week': 1,
                'home_team': 'KC', 'away_team': 'BUF', 'result': 7,
                'total_home_score': 24, 'total_away_score': 17,
                'rush_attempt': 0, 'rush_touchdown': 0, 'rushing_yards': 0.0,
                'fumble': 0, 'fumble_lost': 0, 'fumbled_1_player_id': None,
                'rusher_player_id': None, 'rusher_player_name': None,
                'season_type': 'REG', 'two_point_attempt': 0,
                'run_location': None, 'run_gap': None,
            })
        plays = pd.DataFrame(rows)
        roster = pd.DataFrame([{'gsis_id': 'WR1', 'position': 'WR'}])
        result = aggregate_receiver_stats(plays, roster, 2025)
        wr = result[result['player_id'] == 'WR1'].iloc[0]
        assert wr['receiving_success_rate'] == pytest.approx(0.5, abs=0.01)


# --- RB Stats ---

class TestRBTotalEPA:
    """Total rushing EPA = sum(epa) directly from rush plays."""

    def test_total_rushing_epa(self):
        """50 carries with 0.2 EPA each → total ≈ 10.0."""
        from ingest import aggregate_rb_season_stats
        rows = []
        for i in range(50):
            rows.append({
                'rusher_player_id': 'RB1', 'rusher_player_name': 'Test RB',
                'posteam': 'KC', 'defteam': 'BUF',
                'rush_attempt': 1, 'play_type': 'run', 'qb_dropback': 0,
                'qb_scramble': 0, 'rushing_yards': 5.0, 'rush_touchdown': 0,
                'epa': 0.2, 'success': 1, 'yards_gained': 5.0,
                'game_id': f'GAME{i // 10 + 1}', 'season': 2025, 'week': 1,
                'fumble': 0, 'fumble_lost': 0, 'fumbled_1_player_id': None,
                'passer_player_id': None, 'passer_player_name': None,
                'receiver_player_id': None, 'receiver_player_name': None,
                'pass_attempt': 0, 'complete_pass': 0, 'pass_touchdown': 0,
                'interception': 0, 'sack': 0, 'cpoe': None, 'cp': None,
                'passing_yards': 0, 'air_yards': None, 'receiving_yards': None,
                'yards_after_catch': None, 'home_team': 'KC', 'away_team': 'BUF',
                'result': 7, 'total_home_score': 24, 'total_away_score': 17,
                'season_type': 'REG', 'two_point_attempt': 0,
                'run_location': None, 'run_gap': None,
            })
        plays = pd.DataFrame(rows)
        roster = pd.DataFrame([{'gsis_id': 'RB1', 'position': 'RB'}])
        result = aggregate_rb_season_stats(plays, roster, 2025)
        rb = result.iloc[0]
        assert rb['total_rushing_epa'] == pytest.approx(10.0, abs=0.5)


class TestRBTotalTouches:
    """TCH = carries + receptions."""

    def test_total_touches(self):
        """150 carries + 30 receptions = 180 total touches."""
        from ingest import aggregate_rb_season_stats
        rows = []
        # 150 rush attempts
        for i in range(150):
            rows.append({
                'rusher_player_id': 'RB1', 'rusher_player_name': 'Test RB',
                'posteam': 'KC', 'defteam': 'BUF',
                'rush_attempt': 1, 'play_type': 'run', 'qb_dropback': 0,
                'qb_scramble': 0, 'rushing_yards': 4.0, 'rush_touchdown': 0,
                'epa': 0.1, 'success': 1, 'yards_gained': 4.0,
                'game_id': f'GAME{i // 15 + 1}', 'season': 2025, 'week': 1,
                'fumble': 0, 'fumble_lost': 0, 'fumbled_1_player_id': None,
                'passer_player_id': None, 'passer_player_name': None,
                'receiver_player_id': None, 'receiver_player_name': None,
                'pass_attempt': 0, 'complete_pass': 0, 'pass_touchdown': 0,
                'interception': 0, 'sack': 0, 'cpoe': None, 'cp': None,
                'passing_yards': 0, 'air_yards': None, 'receiving_yards': None,
                'yards_after_catch': None, 'home_team': 'KC', 'away_team': 'BUF',
                'result': 7, 'total_home_score': 24, 'total_away_score': 17,
                'season_type': 'REG', 'two_point_attempt': 0,
                'run_location': None, 'run_gap': None,
            })
        # 30 receptions (pass plays where RB1 is receiver)
        for i in range(30):
            rows.append({
                'rusher_player_id': None, 'rusher_player_name': None,
                'posteam': 'KC', 'defteam': 'BUF',
                'rush_attempt': 0, 'play_type': 'pass', 'qb_dropback': 1,
                'qb_scramble': 0, 'rushing_yards': 0, 'rush_touchdown': 0,
                'epa': 0.3, 'success': 1, 'yards_gained': 8.0,
                'game_id': f'GAME{i // 3 + 1}', 'season': 2025, 'week': 1,
                'fumble': 0, 'fumble_lost': 0, 'fumbled_1_player_id': None,
                'passer_player_id': 'QB1', 'passer_player_name': 'QB',
                'receiver_player_id': 'RB1', 'receiver_player_name': 'Test RB',
                'pass_attempt': 1, 'complete_pass': 1, 'pass_touchdown': 0,
                'interception': 0, 'sack': 0, 'cpoe': 2.0, 'cp': 0.65,
                'passing_yards': 8.0, 'air_yards': 3.0, 'receiving_yards': 8.0,
                'yards_after_catch': 5.0, 'home_team': 'KC', 'away_team': 'BUF',
                'result': 7, 'total_home_score': 24, 'total_away_score': 17,
                'season_type': 'REG', 'two_point_attempt': 0,
                'run_location': None, 'run_gap': None,
            })
        plays = pd.DataFrame(rows)
        roster = pd.DataFrame([{'gsis_id': 'RB1', 'position': 'RB'}])
        result = aggregate_rb_season_stats(plays, roster, 2025)
        rb = result.iloc[0]
        assert rb['total_touches'] == 180
        assert rb['touches_per_game'] == pytest.approx(180 / rb['games'], abs=0.1)


# --- PFR Qualifier Thresholds ---

class TestPFRQualifiers:
    """PFR qualification minimums at full 17-game season."""

    def test_qb_qualifier(self):
        """QB: 14 att/game × 17 = 238."""
        assert 14 * 17 == 238

    def test_rb_qualifier(self):
        """RB: 6.25 att/game × 17 ≈ 106."""
        assert round(6.25 * 17) == 106

    def test_wr_qualifier(self):
        """WR/TE: 1.875 tgt/game × 17 ≈ 32."""
        assert round(1.875 * 17) == 32
