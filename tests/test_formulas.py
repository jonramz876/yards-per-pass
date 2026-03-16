"""Golden-value tests for core NFL stat formulas in ingest.py.

Known-correct values sourced from Pro Football Reference and NFL.com.
These tests catch regression in the most critical code path — the formulas
that produce every number on the site.
"""

import sys
import os
import math
import pytest

# Add project root so we can import from scripts/
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripts'))

from ingest import passer_rating


# --- Passer Rating (NFL formula, 0-158.3 scale) ---

class TestPasserRating:
    """Passer rating formula: 4 components, each clamped 0-2.375, averaged, ×100/6."""

    def test_perfect_game(self):
        """Perfect passer rating = 158.3 (e.g., 10/10, 400 yds, 4 TD, 0 INT)."""
        assert passer_rating(10, 10, 400, 4, 0) == 158.3

    def test_zero_attempts(self):
        """Zero attempts should return 0.0, not divide-by-zero."""
        assert passer_rating(0, 0, 0, 0, 0) == 0.0

    def test_worst_possible(self):
        """Worst possible rating = 0.0 (all 4 components clamp to 0)."""
        # 0 completions, 10 attempts, 0 yards, 0 TD, 10 INT
        assert passer_rating(0, 10, 0, 0, 10) == 0.0

    def test_dalton_line(self):
        """Andy Dalton 2014: 309/481, 3398 yds, 19 TD, 17 INT → 83.5 rating.
        The 'Dalton Line' — average QB benchmark."""
        result = passer_rating(309, 481, 3398, 19, 17)
        assert result == pytest.approx(83.5, abs=0.5)

    def test_peyton_manning_2013(self):
        """Peyton Manning 2013 (record season): 450/659, 5477 yds, 55 TD, 10 INT → 115.1."""
        result = passer_rating(450, 659, 5477, 55, 10)
        assert result == pytest.approx(115.1, abs=0.5)

    def test_single_attempt_td(self):
        """1 completion on 1 attempt, 50 yards, 1 TD, 0 INT → 158.3 (perfect)."""
        assert passer_rating(1, 1, 50, 1, 0) == 158.3

    def test_single_attempt_int(self):
        """0 completions, 1 attempt, 0 yards, 0 TD, 1 INT → 0.0 (worst)."""
        assert passer_rating(0, 1, 0, 0, 1) == 0.0

    def test_clamping_components(self):
        """Verify each component clamps at 2.375 (not higher).
        With extreme stats, result should still be exactly 158.3."""
        # 100% comp, 99 yds/att, TD every attempt, 0 INT
        assert passer_rating(10, 10, 990, 10, 0) == 158.3

    def test_patrick_mahomes_2022(self):
        """Mahomes 2022 MVP: 435/648, 5250 yds, 41 TD, 12 INT → 105.2."""
        result = passer_rating(435, 648, 5250, 41, 12)
        assert result == pytest.approx(105.2, abs=0.5)

    def test_jalen_hurts_2022(self):
        """Jalen Hurts 2022: 306/460, 3701 yds, 22 TD, 6 INT → 101.5."""
        result = passer_rating(306, 460, 3701, 22, 6)
        assert result == pytest.approx(101.5, abs=0.5)


# --- Filter and aggregation sanity checks ---

class TestFilterPlays:
    """Verify filter_plays() logic with a minimal DataFrame."""

    def test_filters_two_point_attempts(self):
        """Two-point attempts must be excluded."""
        import pandas as pd
        from ingest import filter_plays

        df = pd.DataFrame({
            'play_type': ['pass', 'pass', 'pass'],
            'season_type': ['REG', 'REG', 'REG'],
            'two_point_attempt': [0, 1, float('nan')],
        })
        result = filter_plays(df)
        # Row 1 (two_point_attempt=1) excluded; rows 0 and 2 kept
        assert len(result) == 2

    def test_filters_non_regular_season(self):
        """Only REG season plays should pass the filter."""
        import pandas as pd
        from ingest import filter_plays

        df = pd.DataFrame({
            'play_type': ['pass', 'pass', 'run'],
            'season_type': ['REG', 'POST', 'REG'],
            'two_point_attempt': [0, 0, 0],
        })
        result = filter_plays(df)
        assert len(result) == 2

    def test_filters_non_pass_run(self):
        """Only pass and run play types should pass."""
        import pandas as pd
        from ingest import filter_plays

        df = pd.DataFrame({
            'play_type': ['pass', 'run', 'kickoff', 'punt'],
            'season_type': ['REG', 'REG', 'REG', 'REG'],
            'two_point_attempt': [0, 0, 0, 0],
        })
        result = filter_plays(df)
        assert len(result) == 2


# --- aDOT filter tests ---

class TestADOT:
    """aDOT must only use true pass attempts: (pass_attempt==1) & (sack!=1) & (qb_scramble!=1)."""

    def _compute_adot(self, plays_data: list[dict]) -> float:
        """Helper: apply the aDOT filter and compute mean air_yards."""
        import pandas as pd
        df = pd.DataFrame(plays_data)
        adot_plays = df[
            (df['pass_attempt'] == 1) &
            (df['sack'] != 1) &
            (df['qb_scramble'] != 1)
        ]
        return adot_plays['air_yards'].dropna().mean()

    def test_adot_excludes_sacks(self):
        """Sack plays (pass_attempt=1, sack=1) must not contribute to aDOT."""
        plays = [
            {'pass_attempt': 1, 'sack': 0, 'qb_scramble': 0, 'air_yards': 10.0},
            {'pass_attempt': 1, 'sack': 1, 'qb_scramble': 0, 'air_yards': float('nan')},
            {'pass_attempt': 1, 'sack': 0, 'qb_scramble': 0, 'air_yards': 5.0},
        ]
        assert self._compute_adot(plays) == pytest.approx(7.5)

    def test_adot_excludes_scrambles(self):
        """Scramble plays must be excluded even when pass_attempt=1."""
        plays = [
            {'pass_attempt': 1, 'sack': 0, 'qb_scramble': 0, 'air_yards': 12.0},
            {'pass_attempt': 1, 'sack': 0, 'qb_scramble': 0, 'air_yards': 8.0},
            {'pass_attempt': 1, 'sack': 0, 'qb_scramble': 1, 'air_yards': 0.0},
        ]
        assert self._compute_adot(plays) == pytest.approx(10.0)

    def test_adot_all_nan_returns_nan(self):
        """QB with only sacks/scrambles should get NaN aDOT, not 0 or crash."""
        plays = [
            {'pass_attempt': 1, 'sack': 1, 'qb_scramble': 0, 'air_yards': float('nan')},
            {'pass_attempt': 1, 'sack': 0, 'qb_scramble': 1, 'air_yards': 0.0},
        ]
        result = self._compute_adot(plays)
        assert math.isnan(result)


# --- Fumble attribution tests ---

class TestFumbleAttribution:
    """Fumbles must be attributed via fumbled_1_player_id, not passer/rusher grouping.
    This prevents WR/RB fumbles after a catch from being charged to the QB."""

    def _compute_qb_fumbles(self, plays_data: list[dict], qb_ids: set) -> dict:
        """Helper: apply the fumble attribution logic and return {player_id: (fumbles, fumbles_lost)}."""
        import pandas as pd
        df = pd.DataFrame(plays_data)
        qb_fumbles = df[
            df['fumbled_1_player_id'].isin(qb_ids)
        ].groupby('fumbled_1_player_id').agg(
            fumbles=('fumble', 'sum'),
            fumbles_lost=('fumble_lost', 'sum'),
        ).reset_index().rename(columns={'fumbled_1_player_id': 'player_id'})
        return {
            row['player_id']: (int(row['fumbles']), int(row['fumbles_lost']))
            for _, row in qb_fumbles.iterrows()
        }

    def test_qb_sack_fumble(self):
        """QB fumble on a sack play -- fumbled_1_player_id is the QB."""
        plays = [
            {'passer_player_id': 'QB1', 'fumble': 1, 'fumble_lost': 1,
             'fumbled_1_player_id': 'QB1', 'sack': 1, 'qb_dropback': 1},
        ]
        result = self._compute_qb_fumbles(plays, {'QB1'})
        assert result['QB1'] == (1, 1)

    def test_qb_rush_fumble(self):
        """QB fumble on a designed run -- fumbled_1_player_id is the QB."""
        plays = [
            {'passer_player_id': None, 'fumble': 1, 'fumble_lost': 0,
             'fumbled_1_player_id': 'QB1', 'sack': 0, 'qb_dropback': 0},
        ]
        result = self._compute_qb_fumbles(plays, {'QB1'})
        assert result['QB1'] == (1, 0)

    def test_wr_fumble_not_charged_to_qb(self):
        """WR fumble after a catch -- QB must NOT be charged.
        This is the critical test. The naive approach of grouping by
        passer_player_id would wrongly charge the QB here."""
        plays = [
            {'passer_player_id': 'QB1', 'fumble': 1, 'fumble_lost': 1,
             'fumbled_1_player_id': 'WR1', 'sack': 0, 'qb_dropback': 1},
        ]
        result = self._compute_qb_fumbles(plays, {'QB1'})
        assert 'QB1' not in result  # QB should have 0 fumbles

    def test_qb_scramble_fumble(self):
        """QB fumble on a scramble -- fumbled_1_player_id is the QB."""
        plays = [
            {'passer_player_id': 'QB1', 'fumble': 1, 'fumble_lost': 1,
             'fumbled_1_player_id': 'QB1', 'sack': 0, 'qb_dropback': 1,
             'qb_scramble': 1},
        ]
        result = self._compute_qb_fumbles(plays, {'QB1'})
        assert result['QB1'] == (1, 1)


# --- Frontend computed stats tests ---

def get_val(games: int, passing_yards: int, touchdowns: int, rush_tds: int, interceptions: int, key: str):
    """Python mirror of the frontend getVal() helper for computed stats.
    Tests this function to ensure the logic is correct before implementing in TypeScript."""
    if key == "yards_per_game":
        return passing_yards / games if games else float('nan')
    if key == "tds_per_game":
        return touchdowns / games if games else float('nan')
    if key == "total_tds":
        return touchdowns + rush_tds
    if key == "td_int_ratio":
        return touchdowns / interceptions if interceptions > 0 else float('inf')
    raise ValueError(f"Unknown key: {key}")


class TestComputedStats:
    """Frontend-computed stats via getVal helper: TD:INT ratio, per-game stats, total TDs.
    Tests a Python mirror of the TypeScript getVal() function."""

    def test_td_int_ratio_normal(self):
        """20 TD / 8 INT = 2.5."""
        assert get_val(16, 3400, 20, 5, 8, "td_int_ratio") == pytest.approx(2.5)

    def test_td_int_ratio_zero_int(self):
        """0 INTs -> Infinity (displayed as 'X:0')."""
        result = get_val(16, 3400, 5, 2, 0, "td_int_ratio")
        assert math.isinf(result)

    def test_yards_per_game(self):
        """3400 yards / 16 games = 212.5."""
        assert get_val(16, 3400, 20, 5, 8, "yards_per_game") == pytest.approx(212.5)

    def test_tds_per_game(self):
        """24 TDs / 16 games = 1.5."""
        assert get_val(16, 3400, 24, 5, 8, "tds_per_game") == pytest.approx(1.5)

    def test_per_game_zero_games(self):
        """0 games -> NaN (not crash or Infinity)."""
        assert math.isnan(get_val(0, 3400, 20, 5, 8, "yards_per_game"))
        assert math.isnan(get_val(0, 3400, 20, 5, 8, "tds_per_game"))

    def test_total_tds(self):
        """Total TDs = passing TDs + rushing TDs."""
        assert get_val(16, 3400, 25, 5, 8, "total_tds") == 30

    def test_total_tds_zero(self):
        """Both 0 -> 0."""
        assert get_val(16, 0, 0, 0, 0, "total_tds") == 0
