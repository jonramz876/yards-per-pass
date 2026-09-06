"""Tests for the nflverse schedules ingest (games table)."""
import math
import os
import sys

import pandas as pd

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripts'))

GAMES_COLS = [
    'game_id', 'season', 'game_type', 'week', 'gameday', 'weekday',
    'gametime', 'home_team', 'away_team', 'home_score', 'away_score',
]


def _schedules_frame():
    """Fixture mimicking the real games.csv: past season with scores, current
    season without, a playoff row, and a TBD kickoff (null gametime).

    Built through pandas so the dtypes match the real read_csv result:
    home_score/away_score float64 (NaN, not None), gametime string dtype.
    """
    return pd.DataFrame([
        # 2025: played REG game
        {'game_id': '2025_01_KC_BUF', 'season': 2025, 'game_type': 'REG', 'week': 1,
         'gameday': '2025-09-07', 'weekday': 'Sunday', 'gametime': '13:00',
         'home_team': 'BUF', 'away_team': 'KC', 'home_score': 27.0, 'away_score': 20.0},
        # 2025: playoff row (week 19, WC) — must ingest like any other row
        {'game_id': '2025_19_GB_CHI', 'season': 2025, 'game_type': 'WC', 'week': 19,
         'gameday': '2026-01-10', 'weekday': 'Saturday', 'gametime': '16:30',
         'home_team': 'CHI', 'away_team': 'GB', 'home_score': 17.0, 'away_score': 24.0},
        # 2026: unplayed REG game — null scores
        {'game_id': '2026_01_NE_SEA', 'season': 2026, 'game_type': 'REG', 'week': 1,
         'gameday': '2026-09-09', 'weekday': 'Wednesday', 'gametime': '20:20',
         'home_team': 'SEA', 'away_team': 'NE', 'home_score': None, 'away_score': None},
        # 2026: unplayed with kickoff TBD — null gametime AND null scores
        {'game_id': '2026_18_SF_LA', 'season': 2026, 'game_type': 'REG', 'week': 18,
         'gameday': '2027-01-03', 'weekday': 'Sunday', 'gametime': None,
         'home_team': 'LA', 'away_team': 'SF', 'home_score': None, 'away_score': None},
    ])


class _FakeCursor:
    """Records DDL; execute_values is monkeypatched separately to capture rows."""

    def __init__(self, statements):
        self.statements = statements

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql, *args):
        self.statements.append(sql)


class _FakeConn:
    """Minimal psycopg2 connection stand-in."""

    def __init__(self):
        self.statements = []
        self.commits = 0
        self.rollbacks = 0

    def cursor(self):
        return _FakeCursor(self.statements)

    def commit(self):
        self.commits += 1

    def rollback(self):
        self.rollbacks += 1


def _run_ingest(monkeypatch, season, conn, frame=None):
    """Run ingest_schedules against the fixture frame; return captured rows + SQL."""
    import ingest
    from ingest import ingest_schedules

    # The module-level cache stands in for the download (and proves --all reuses it)
    monkeypatch.setattr(ingest, '_SCHEDULES_CACHE',
                        _schedules_frame() if frame is None else frame)

    captured = {}

    def fake_execute_values(cur, sql, rows):
        captured['sql'] = sql
        captured['rows'] = rows

    monkeypatch.setattr(ingest, 'execute_values', fake_execute_values)
    ingest_schedules(conn, season)
    return captured


class TestIngestSchedulesTransform:
    """ingest_schedules selects the 11 games columns and hands psycopg2 clean values."""

    def test_selects_only_the_games_columns(self, monkeypatch):
        conn = _FakeConn()
        captured = _run_ingest(monkeypatch, 2026, conn)
        rows = captured['rows']
        assert all(len(r) == len(GAMES_COLS) for r in rows)
        col_list = captured['sql'].split('games (')[1].split(')')[0]
        assert [c.strip() for c in col_list.split(',')] == GAMES_COLS

    def test_filters_to_the_requested_season(self, monkeypatch):
        conn = _FakeConn()
        captured = _run_ingest(monkeypatch, 2026, conn)
        rows = captured['rows']
        assert len(rows) == 2
        season_i = GAMES_COLS.index('season')
        assert {r[season_i] for r in rows} == {2026}
        assert {r[0] for r in rows} == {'2026_01_NE_SEA', '2026_18_SF_LA'}

    def test_playoff_rows_ingest_with_their_round_and_week(self, monkeypatch):
        conn = _FakeConn()
        captured = _run_ingest(monkeypatch, 2025, conn)
        by_id = {r[0]: r for r in captured['rows']}
        assert len(by_id) == 2
        wc = by_id['2025_19_GB_CHI']
        assert wc[GAMES_COLS.index('game_type')] == 'WC'
        assert wc[GAMES_COLS.index('week')] == 19

    def test_null_scores_and_gametime_are_none_not_nan(self, monkeypatch):
        conn = _FakeConn()
        captured = _run_ingest(monkeypatch, 2026, conn)
        rows = captured['rows']

        flat = [v for row in rows for v in row]
        assert not any(isinstance(v, float) and math.isnan(v) for v in flat), \
            f"NaN leaked into upsert rows: {rows}"

        by_id = {r[0]: r for r in rows}
        for col in ('home_score', 'away_score'):
            assert by_id['2026_01_NE_SEA'][GAMES_COLS.index(col)] is None
        assert by_id['2026_18_SF_LA'][GAMES_COLS.index('gametime')] is None
        # A present gametime survives untouched
        assert by_id['2026_01_NE_SEA'][GAMES_COLS.index('gametime')] == '20:20'

    def test_values_are_plain_python_types(self, monkeypatch):
        """numpy scalars have no psycopg2 adapter — season/week/scores must be builtins."""
        conn = _FakeConn()
        captured = _run_ingest(monkeypatch, 2025, conn)
        row = {r[0]: r for r in captured['rows']}['2025_01_KC_BUF']

        week = row[GAMES_COLS.index('week')]
        assert type(week) is int and week == 1
        assert type(row[GAMES_COLS.index('season')]) is int
        home = row[GAMES_COLS.index('home_score')]
        assert type(home) is float and home == 27.0
        for col in ('game_id', 'game_type', 'gameday', 'weekday', 'home_team', 'away_team'):
            assert type(row[GAMES_COLS.index(col)]) is str

    def test_conflict_update_covers_scores_and_reschedules(self, monkeypatch):
        conn = _FakeConn()
        captured = _run_ingest(monkeypatch, 2026, conn)
        sql = captured['sql']
        assert 'ON CONFLICT (game_id) DO UPDATE SET' in sql
        for col in ('home_score', 'away_score', 'gameday', 'gametime', 'weekday'):
            assert f'{col} = EXCLUDED.{col}' in sql
        # game_id/season/game_type/teams are identity — never overwritten
        assert 'game_id = EXCLUDED.game_id' not in sql
        assert 'home_team = EXCLUDED.home_team' not in sql

    def test_creates_table_and_commits(self, monkeypatch):
        conn = _FakeConn()
        _run_ingest(monkeypatch, 2026, conn)
        ddl = ' '.join(conn.statements)
        assert 'CREATE TABLE IF NOT EXISTS games' in ddl
        assert 'idx_games_season_home' in ddl
        assert 'idx_games_season_away' in ddl
        assert 'ENABLE ROW LEVEL SECURITY' in ddl
        assert 'public_read' in ddl
        assert conn.commits >= 1
        assert conn.rollbacks == 0

    def test_unknown_season_writes_nothing(self, monkeypatch):
        conn = _FakeConn()
        captured = _run_ingest(monkeypatch, 1999, conn)
        assert 'rows' not in captured
        assert conn.statements == []


class TestIngestSchedulesDryRun:
    """conn is None → count only, no writes."""

    def test_dry_run_writes_nothing(self, monkeypatch, caplog):
        import ingest

        monkeypatch.setattr(ingest, '_SCHEDULES_CACHE', _schedules_frame())

        def boom(*args, **kwargs):
            raise AssertionError("dry run must not reach execute_values")

        monkeypatch.setattr(ingest, 'execute_values', boom)
        with caplog.at_level('INFO', logger='ingest'):
            assert ingest.ingest_schedules(None, 2026) is None
        assert "Would upsert 2 schedule rows for 2026" in caplog.text
