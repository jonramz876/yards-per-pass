"""team_game_stats DDL, upsert, stale-row cleanup and process_season wiring —
box score spec §5 ("How it runs", "Stale rows")."""
import math

import pandas as pd
import pytest

from conftest import FIXTURE_GAMES


class _FakeCursor:
    """Records every execute(sql, params); rowcount is always 0."""

    def __init__(self, calls):
        self.calls = calls
        self.rowcount = 0

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql, params=None):
        self.calls.append((' '.join(sql.split()), params))


class _FakeConn:
    def __init__(self):
        self.calls = []
        self.commits = 0
        self.rollbacks = 0

    def cursor(self):
        return _FakeCursor(self.calls)

    def commit(self):
        self.commits += 1

    def rollback(self):
        self.rollbacks += 1


class TestEnsureTable:
    def test_ddl_declares_every_stored_column(self):
        from ingest import ensure_team_game_stats_table, TEAM_GAME_STATS_COLS
        conn = _FakeConn()
        ensure_team_game_stats_table(conn)
        ddl = ' '.join(sql for sql, _ in conn.calls)
        assert 'CREATE TABLE IF NOT EXISTS team_game_stats' in ddl
        for col in TEAM_GAME_STATS_COLS:
            assert f' {col} ' in ddl, col
        assert 'UNIQUE (game_id, team_id)' in ddl
        assert 'team_id TEXT NOT NULL REFERENCES teams(id)' in ddl
        assert 'idx_team_game_stats_season_week' in ddl
        assert 'idx_team_game_stats_team_season' in ddl
        assert 'ALTER TABLE team_game_stats ENABLE ROW LEVEL SECURITY' in ddl
        assert 'CREATE POLICY "public_read" ON team_game_stats FOR SELECT USING (true)' in ddl
        assert conn.commits == 1
        assert conn.rollbacks == 0


class TestUpsert:
    def test_sql_columns_and_conflict_target(self, monkeypatch, team_game_rows):
        import ingest
        from ingest import upsert_team_game_stats, TEAM_GAME_STATS_COLS
        captured = {}

        def fake_execute_values(cur, sql, rows):
            captured['sql'] = ' '.join(sql.split())
            captured['rows'] = rows

        monkeypatch.setattr(ingest, 'execute_values', fake_execute_values)
        upsert_team_game_stats(_FakeConn(), team_game_rows)
        sql = captured['sql']
        assert sql.startswith(f"INSERT INTO team_game_stats ({', '.join(TEAM_GAME_STATS_COLS)}) VALUES %s")
        assert 'ON CONFLICT (game_id, team_id) DO UPDATE SET' in sql
        assert 'game_id = EXCLUDED.game_id' not in sql
        assert 'team_id = EXCLUDED.team_id' not in sql
        for col in TEAM_GAME_STATS_COLS[2:]:
            assert f'{col} = EXCLUDED.{col}' in sql, col
        assert len(captured['rows']) == 6

    def test_rows_are_plain_python_with_null_never_nan(self, monkeypatch, raw):
        """numpy scalars have no psycopg2 adapter; NaN would reach Postgres as 'NaN'::numeric."""
        import ingest
        from ingest import aggregate_team_game_stats, upsert_team_game_stats, TEAM_GAME_STATS_COLS
        captured = {}

        def fake_execute_values(cur, sql, rows):
            captured['rows'] = rows

        monkeypatch.setattr(ingest, 'execute_values', fake_execute_values)
        # KC only passes, so its rush rates are NULL; BUF never has the ball.
        df = aggregate_team_game_stats(raw.game(raw.play(), raw.play()), 2026)
        upsert_team_game_stats(_FakeConn(), df)
        rows = captured['rows']
        assert len(rows) == 2
        flat = [v for r in rows for v in r]
        assert not any(isinstance(v, float) and math.isnan(v) for v in flat)
        assert all(type(v) in (int, float, str, type(None)) for v in flat)
        kc = dict(zip(TEAM_GAME_STATS_COLS, [r for r in rows if r[1] == 'KC'][0]))
        assert type(kc['plays']) is int and kc['plays'] == 2
        assert type(kc['epa_per_play']) is float
        assert kc['rush_epa_per_play'] is None
        assert kc['yards_per_rush'] is None
        assert type(kc['week']) is int and type(kc['season']) is int
        # INT column, NULL-able, so not in TEAM_GAME_STATS_INT_COLS — still an int here.
        assert type(kc['time_of_possession_seconds']) is int
        buf = dict(zip(TEAM_GAME_STATS_COLS, [r for r in rows if r[1] == 'BUF'][0]))
        assert buf['epa_per_play'] is None
        assert buf['plays'] == 0

    def test_empty_frame_writes_nothing(self, monkeypatch):
        import ingest
        from ingest import upsert_team_game_stats, TEAM_GAME_STATS_COLS

        def boom(*args, **kwargs):
            raise AssertionError('empty frame must not reach execute_values')

        monkeypatch.setattr(ingest, 'execute_values', boom)
        upsert_team_game_stats(_FakeConn(), pd.DataFrame(columns=TEAM_GAME_STATS_COLS))


class TestCleanup:
    def _run(self, **kwargs):
        from ingest import cleanup_stale_rows
        conn = _FakeConn()
        cleanup_stale_rows(conn, 2026, team_ids=['KC'], player_ids=['QB1'], **kwargs)
        return [c for c in conn.calls if 'team_game_stats' in c[0]]

    def test_deletes_games_missing_from_the_file(self):
        calls = self._run(game_ids=['2026_01_KC_BUF', '2026_02_BUF_NYJ'])
        assert calls == [('DELETE FROM team_game_stats WHERE season = %s AND game_id != ALL(%s)',
                          (2026, ['2026_01_KC_BUF', '2026_02_BUF_NYJ']))]

    def test_empty_list_deletes_nothing(self):
        """Same guard as every other cleanup: an empty list would delete the whole season."""
        assert self._run(game_ids=[]) == []

    def test_omitted_parameter_deletes_nothing(self):
        assert self._run() == []


class TestProcessSeasonWiring:
    """The slug bug was a function defined but never called from process_season.
    Every other aggregator and DB call is stubbed; the new code runs for real."""

    ROSTER = pd.DataFrame([{'gsis_id': '00-0034857', 'position': 'QB'}])

    def _wire(self, monkeypatch, pbp_fixture):
        import ingest
        calls = []

        def record(name, result=None):
            def _f(*args, **kwargs):
                calls.append((name, args, kwargs))
                return result
            return _f

        monkeypatch.setattr(ingest, 'download_pbp', lambda season: pbp_fixture.copy())
        monkeypatch.setattr(ingest, 'download_roster', lambda season: self.ROSTER)
        monkeypatch.setattr(ingest, 'download_participation', lambda season: None)
        stubs = {
            'aggregate_team_stats': pd.DataFrame({'team_id': ['BUF'], 'off_epa_play': [0.1], 'def_epa_play': [-0.1]}),
            'aggregate_qb_stats': pd.DataFrame({'player_id': ['00-0034857'], 'dropbacks': [31]}),
            'aggregate_qb_pass_location_stats': pd.DataFrame(),
            'aggregate_rb_gap_stats': pd.DataFrame(),
            'aggregate_rb_gap_stats_weekly': pd.DataFrame(),
            'aggregate_def_gap_stats': pd.DataFrame(),
            'aggregate_receiver_stats': pd.DataFrame(),
            'aggregate_rb_season_stats': pd.DataFrame(),
            'aggregate_qb_weekly_stats': pd.DataFrame(),
            'aggregate_receiver_weekly_stats': pd.DataFrame(),
            'aggregate_rb_weekly_stats': pd.DataFrame(),
            'aggregate_team_down_distance_stats': pd.DataFrame(),
            'aggregate_team_situational_stats': pd.DataFrame(),
            'generate_player_slugs': pd.DataFrame(),
            'validate_data': None,
            'get_existing_through_week': None,
            'update_freshness': None,
            'cleanup_stale_rows': None,
        }
        for name, result in stubs.items():
            monkeypatch.setattr(ingest, name, record(name, result))
        for name in dir(ingest):
            if name.startswith('ensure_') or (name.startswith('upsert_') and name != 'upsert_team_game_stats'):
                monkeypatch.setattr(ingest, name, record(name))

        real_aggregate = ingest.aggregate_team_game_stats
        real_upsert = ingest.upsert_team_game_stats

        def spy_aggregate(pbp, season):
            calls.append(('aggregate_team_game_stats', (len(pbp), season), {}))
            return real_aggregate(pbp, season)

        def spy_upsert(conn, df):
            calls.append(('upsert_team_game_stats', (df,), {}))

        monkeypatch.setattr(ingest, 'aggregate_team_game_stats', spy_aggregate)
        monkeypatch.setattr(ingest, 'upsert_team_game_stats', spy_upsert)
        monkeypatch.setattr(ingest, 'execute_values', lambda *a, **k: None)
        return ingest, calls

    def test_full_run_aggregates_raw_pbp_ensures_upserts_and_cleans_up(self, monkeypatch, pbp_fixture):
        ingest, calls = self._wire(monkeypatch, pbp_fixture)
        conn = _FakeConn()
        ingest.process_season(2026, conn)
        names = [c[0] for c in calls]

        agg = [c for c in calls if c[0] == 'aggregate_team_game_stats']
        assert agg == [('aggregate_team_game_stats', (len(pbp_fixture), 2026), {})]  # RAW rows, not filter_plays' 398

        up = [c for c in calls if c[0] == 'upsert_team_game_stats']
        assert len(up) == 1
        df = up[0][1][0]
        assert len(df) == 6 and sorted(df['game_id'].unique()) == sorted(FIXTURE_GAMES)

        assert names.index('ensure_team_game_stats_table') < names.index('upsert_team_game_stats')

        cleanup = [c for c in calls if c[0] == 'cleanup_stale_rows'][0]
        assert sorted(cleanup[2]['game_ids']) == sorted(FIXTURE_GAMES)
        assert names.index('upsert_team_game_stats') < names.index('cleanup_stale_rows') < names.index('update_freshness')
        assert conn.commits == 1 and conn.rollbacks == 0

    def test_dry_run_reports_team_game_rows_and_writes_nothing(self, monkeypatch, pbp_fixture, caplog):
        ingest, calls = self._wire(monkeypatch, pbp_fixture)
        with caplog.at_level('INFO', logger='ingest'):
            ingest.process_season(2026, None, dry_run=True)
        assert 'Team game stats: 6 rows (3 games)' in caplog.text
        assert not any(c[0].startswith(('upsert_', 'ensure_', 'cleanup_')) for c in calls)
