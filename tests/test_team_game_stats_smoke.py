"""Whole-season smoke check of aggregate_team_game_stats over a full nflverse
play-by-play file (no database). Skipped unless YPP_PBP_PARQUET points at a
local copy of play_by_play_2026.parquet:

    https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_2026.parquet

CI never sets it (no network, and the file grows every week). The season moves
on, so the split below is deliberate: TestWeekOne quotes the box score spec's
WEEK-1 numbers and therefore filters the file to week 1, while TestWholeFile
asserts only per-game properties that hold however many weeks have been played.
nflverse can revise past weeks, so if a week-1 fact fails on a fresh download,
check the spec's numbers before the code.
"""
import math
import os

import pandas as pd
import pytest

PATH = os.environ.get('YPP_PBP_PARQUET')

pytestmark = pytest.mark.skipif(not PATH, reason='set YPP_PBP_PARQUET to a full play_by_play_2026.parquet')

NO_DET = '2026_01_NO_DET'


@pytest.fixture(scope='module')
def full_pbp():
    return pd.read_parquet(PATH)


@pytest.fixture(scope='module')
def week_one(full_pbp):
    """Week 1 only — every number in TestWeekOne is a week-1 fact from the spec."""
    from ingest import aggregate_team_game_stats
    return aggregate_team_game_stats(full_pbp[full_pbp['week'] == 1], 2026)


class TestWeekOne:
    """Scoped to week 1: these are the spec's verified week-1 totals, not season totals."""

    def test_one_row_per_team_per_game(self, week_one):
        assert len(week_one) == 32          # 16 week-1 games x 2
        assert week_one['game_id'].nunique() == 16
        assert week_one['team_id'].nunique() == 32
        assert week_one.groupby('game_id').size().eq(2).all()

    def test_no_nulls_anywhere_in_a_full_week(self, week_one):
        from ingest import TEAM_GAME_STATS_INT_COLS
        assert not week_one.isna().any().any()
        for col in TEAM_GAME_STATS_INT_COLS + ['season', 'week']:
            assert str(week_one[col].dtype).startswith('int'), col

    def test_spec_week_one_facts(self, week_one):
        assert week_one['explosive_plays'].sum() == 182          # week 1; 163 without the scramble clause
        top = week_one.groupby('game_id')['time_of_possession_seconds'].sum()
        assert top.drop(NO_DET).eq(3600).all()
        assert top[NO_DET] == 68 * 60 + 26
        short = week_one[week_one['early_plays'] + week_one['late_plays'] < week_one['plays']]
        assert set(short['team_id']) == {'BUF', 'MIN', 'NO', 'WAS'}  # each had a 2-point try
        assert week_one['def_st_tds'].sum() == 3                 # week 1
        assert week_one['total_drives'].sum() == 354             # week 1
        buf_hou = week_one[week_one['game_id'] == '2026_01_BUF_HOU'].set_index('team_id')
        assert buf_hou.loc['BUF', 'team_targets'] == 28 and buf_hou.loc['HOU', 'team_targets'] == 37


class TestWholeFile:
    """Per-game properties only. The file gains a week every Sunday, so nothing here
    may be a season total or a fixed row count."""

    def test_every_played_game_aggregates_cleanly(self, full_pbp):
        from ingest import aggregate_team_game_stats, TEAM_GAME_STATS_INT_COLS, TEAM_GAME_STATS_RATE_COLS
        out = aggregate_team_game_stats(full_pbp, 2026)
        reg_games = full_pbp.loc[full_pbp['season_type'] == 'REG', 'game_id'].nunique()
        assert out.groupby('game_id').size().eq(2).all()   # exactly 2 rows per game
        assert out['game_id'].nunique() == reg_games       # every played REG game
        assert len(out) == 2 * reg_games
        assert not out[TEAM_GAME_STATS_INT_COLS + ['season', 'week']].isna().any().any()
        # No rate column may leak a bare NaN/inf (a real "no data" is a None, never
        # a float NaN) — checked across every rate column, not just the 4 whose
        # denominator can plausibly be 0; a None-only column is untouched by
        # math.isfinite, so this only ever flags a genuine non-finite float.
        for col in TEAM_GAME_STATS_RATE_COLS:
            bad = [v for v in out[col] if v is not None and not math.isfinite(v)]
            assert not bad, (col, bad)
        # Every team-game that actually ran a play has an epa_per_play — not just
        # "NULL implies 0 plays" (true by _ratio's own construction regardless of
        # whether the data is right), but the real-world converse: a team with
        # plays > 0 must never come out NULL.
        assert not out.loc[out['plays'] > 0, 'epa_per_play'].isna().any()
        assert (out['time_of_possession_seconds'] > 0).all()

    def test_possession_sums_to_each_game_s_own_clock(self, full_pbp):
        """Per game, never a season total: 60:00 in regulation, more only where the
        file actually has overtime rows."""
        from ingest import aggregate_team_game_stats
        out = aggregate_team_game_stats(full_pbp, 2026)
        top = out.groupby('game_id')['time_of_possession_seconds'].sum()
        reg = full_pbp[full_pbp['season_type'] == 'REG']
        overtime = set(reg.loc[reg['qtr'] >= 5, 'game_id'])
        for game_id, seconds in top.items():
            if game_id in overtime:
                assert 3600 < seconds <= 3600 + 15 * 60, (game_id, seconds)
            else:
                assert seconds == 3600, (game_id, seconds)


@pytest.fixture(scope='module')
def whole_file(full_pbp):
    from ingest import aggregate_team_game_stats
    return aggregate_team_game_stats(full_pbp, 2026)


_THIRD = ('third_down_conv', 'third_down_att')
_RZ = ('red_zone_tds', 'red_zone_trips')


class TestEspnCountingRows:
    """ESPN's week 1-2 2026 values for the 14 team-game cells the old 3rd-down and
    red-zone rules got wrong (penalty-only first downs; snaps from the 20; FG-only
    trips). If one fails on a fresh download, check whether nflverse revised the
    play before changing code. A game missing from the file skips (the local
    copy of 2026-09-21 lacks 2026_02_NYG_LA)."""

    @pytest.mark.parametrize('game_id, team, cols, expected', [
        ('2026_01_NE_SEA', 'NE', _THIRD, (5, 16)),
        ('2026_01_GB_MIN', 'MIN', _THIRD, (8, 15)),
        ('2026_01_MIA_LV', 'LV', _THIRD, (5, 13)),
        ('2026_02_PIT_NE', 'NE', _THIRD, (4, 12)),
        ('2026_02_GB_NYJ', 'NYJ', _THIRD, (8, 19)),
        ('2026_02_SEA_ARI', 'SEA', _THIRD, (6, 13)),
        ('2026_01_DAL_NYG', 'NYG', _RZ, (4, 4)),
        ('2026_01_GB_MIN', 'MIN', _RZ, (4, 4)),
        ('2026_01_MIA_LV', 'MIA', _RZ, (1, 3)),
        ('2026_02_DET_BUF', 'DET', _RZ, (3, 4)),
        ('2026_02_DET_BUF', 'BUF', _RZ, (5, 5)),
        ('2026_02_GB_NYJ', 'GB', _RZ, (2, 4)),
        ('2026_02_WAS_DAL', 'WAS', _RZ, (1, 3)),
        ('2026_02_NYG_LA', 'LA', _RZ, (3, 3)),
    ])
    def test_matches_espn(self, whole_file, game_id, team, cols, expected):
        row = whole_file[(whole_file['game_id'] == game_id) & (whole_file['team_id'] == team)]
        if row.empty:
            pytest.skip(f'{game_id} is not in this play-by-play file')
        assert len(row) == 1
        assert tuple(int(row.iloc[0][c]) for c in cols) == expected
