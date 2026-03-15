"""Golden-value tests for core NFL stat formulas in ingest.py.

Known-correct values sourced from Pro Football Reference and NFL.com.
These tests catch regression in the most critical code path — the formulas
that produce every number on the site.
"""

import sys
import os
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
