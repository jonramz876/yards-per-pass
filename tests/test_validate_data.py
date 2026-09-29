"""Tests for validate_data: the pre-write sanity checks on season aggregates.

The epa_per_db range check only applies to QBs with enough dropbacks
(EPA_DB_CHECK_MIN_DROPBACKS); a one-play backup QB can legitimately post
|epa_per_db| > 5 (e.g. A.Dalton's red-zone INT in 2026, EPA -5.569).
"""
import math
import os
import sys

import pandas as pd
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripts'))

from ingest import validate_data  # noqa: E402


def _team():
    return pd.DataFrame({
        'team_id': ['PHI', 'CHI'],
        'off_epa_play': [0.12, -0.05],
        'def_epa_play': [-0.03, 0.08],
    })


def _qb(**cols):
    """Build a qb_stats frame. Starts from one normal starter row; extra rows via lists."""
    base = {
        'player_id': ['00-0036389'],
        'player_name': ['J.Hurts'],
        'dropbacks': [110],
        'completion_pct': [66.0],
        'passer_rating': [98.5],
        'epa_per_db': [0.15],
    }
    for k, extra in cols.items():
        base[k] = base[k] + extra
    return pd.DataFrame(base)


def _with_row(player_id, name, dropbacks, epa, comp=0.0, rating=0.0):
    return _qb(player_id=[player_id], player_name=[name], dropbacks=[dropbacks],
               completion_pct=[comp], passer_rating=[rating], epa_per_db=[epa])


class TestValidateDataBaseline:
    def test_normal_frame_passes(self, caplog):
        with caplog.at_level('WARNING', logger='ingest'):
            validate_data(_team(), _qb())
        assert caplog.text == ''

    def test_other_check_still_raises(self):
        qb = _qb()
        qb.loc[0, 'completion_pct'] = 101.0
        with pytest.raises(ValueError, match=r"QB completion_pct outside \[0, 100\]"):
            validate_data(_team(), qb)


class TestEpaPerDbVolumeGate:
    def test_one_dropback_outlier_warns_not_raises(self, caplog):
        # The A.Dalton case from 2026_03_PHI_CHI
        qb = _with_row('00-0027973', 'A.Dalton', 1, -5.569)
        with caplog.at_level('WARNING', logger='ingest'):
            validate_data(_team(), qb)
        assert '00-0027973' in caplog.text
        assert 'A.Dalton' in caplog.text

    def test_one_dropback_positive_outlier_warns(self, caplog):
        qb = _with_row('00-0099999', 'T.Trick', 1, 6.0)
        with caplog.at_level('WARNING', logger='ingest'):
            validate_data(_team(), qb)
        assert '00-0099999' in caplog.text

    def test_ten_dropbacks_outlier_raises(self):
        qb = _with_row('00-0011111', 'X.Bad', 10, 5.5)
        with pytest.raises(ValueError, match=r"QB epa_per_db outside \[-5\.0, 5\.0\]"):
            validate_data(_team(), qb)

    def test_nine_dropbacks_outlier_warns(self, caplog):
        qb = _with_row('00-0022222', 'Y.Low', 9, 6.0)
        with caplog.at_level('WARNING', logger='ingest'):
            validate_data(_team(), qb)
        assert '00-0022222' in caplog.text

    def test_nan_epa_zero_dropbacks_passes_silently(self, caplog):
        qb = _with_row('00-0033333', 'Z.None', 0, math.nan)
        with caplog.at_level('WARNING', logger='ingest'):
            validate_data(_team(), qb)
        assert caplog.text == ''

    def test_missing_dropbacks_column_checks_all_rows(self):
        qb = _with_row('00-0027973', 'A.Dalton', 1, -5.569).drop(columns=['dropbacks'])
        with pytest.raises(ValueError, match=r"QB epa_per_db outside \[-5\.0, 5\.0\]"):
            validate_data(_team(), qb)

    def test_error_and_warning_rows_together(self, caplog):
        # Non-default index to make sure masks align on the full frame
        qb = _qb(player_id=['00-0027973', '00-0011111'],
                 player_name=['A.Dalton', 'X.Bad'],
                 dropbacks=[1, 40],
                 completion_pct=[0.0, 50.0],
                 passer_rating=[0.0, 40.0],
                 epa_per_db=[-5.569, 7.0])
        qb.index = [10, 20, 30]
        with caplog.at_level('WARNING', logger='ingest'):
            with pytest.raises(ValueError, match=r"QB epa_per_db outside"):
                validate_data(_team(), qb)
        assert '00-0027973' in caplog.text
