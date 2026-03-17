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
