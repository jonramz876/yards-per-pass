"""Refresh IO, PR C: no schema statements on a normal run
(docs/superpowers/specs/2026-10-06-refresh-io-design.md, revision 2).

The ensure_* DDL runs only when the schema hash in the state file differs (or there
is no state, or --force). A missing table/column then self-heals once. Every
ensure_* function sets a 10 s lock timeout first.

No network and no database (see test_refresh_io.py for the harness).
"""
import logging

import pandas as pd
import psycopg2
import psycopg2.errors
import pytest

import ingest
from test_refresh_io import (  # noqa: F401  (h and the autouse safety net are fixtures)
    PBP, Harness, h, no_real_network_or_database, schedules_frame,
)

REAL_PROCESS_SEASON = ingest.process_season
REAL_INGEST_SCHEDULES = ingest.ingest_schedules

LOCK_TIMEOUT = "SET LOCAL lock_timeout = '10s'"

# Today's order: ensure_games_table inside ingest_schedules, then the 17 in process_season.
SEASON_ENSURE_ORDER = [
    'ensure_team_season_stats_columns', 'ensure_qb_season_stats_columns', 'ensure_rb_gap_tables',
    'ensure_rb_gap_weekly_tables', 'ensure_def_gap_tables', 'ensure_receiver_stats_table',
    'ensure_rb_season_stats_table', 'ensure_qb_weekly_stats_table', 'ensure_qb_weekly_stats_columns',
    'ensure_receiver_weekly_stats_table', 'ensure_rb_weekly_stats_table', 'ensure_qb_pass_location_tables',
    'ensure_team_down_distance_table', 'ensure_team_situational_table', 'ensure_player_slugs_table',
    'ensure_team_game_stats_table', 'ensure_team_game_stats_columns',
]
ALL_ENSURE = ['ensure_games_table'] + SEASON_ENSURE_ORDER


def is_ddl(sql):
    upper = sql.upper()
    return 'CREATE ' in upper or 'ALTER ' in upper or 'DO $$' in upper


class RecordingCursor:
    def __init__(self, conn):
        self.conn = conn
        self.rowcount = 0

    def execute(self, sql, params=None):
        if self.conn.aborted:
            raise psycopg2.errors.InFailedSqlTransaction(
                "current transaction is aborted, commands ignored until end of transaction block")
        self.conn.events.append(('execute', ' '.join(sql.split())))

    def fetchone(self):
        return (None,)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def close(self):
        pass


class RecordingConn:
    """Keeps an ordered event log and behaves like Postgres after a failed statement:
    every later statement raises InFailedSqlTransaction until rollback()."""

    def __init__(self, name="rec"):
        self.name = name
        self.closed = 0
        self.aborted = False
        self.events = []

    def cursor(self):
        return RecordingCursor(self)

    def commit(self):
        if self.aborted:
            raise psycopg2.errors.InFailedSqlTransaction("commit on an aborted transaction")
        self.events.append(('commit',))

    def rollback(self):
        self.aborted = False
        self.events.append(('rollback',))

    def close(self):
        self.closed = 1

    def fail(self, exc):
        """A statement failed server-side: the transaction is now aborted."""
        self.aborted = True
        self.events.append(('error', type(exc).__name__))
        raise exc

    @property
    def statements(self):
        return [e[1] for e in self.events if e[0] == 'execute']

    @property
    def ddl(self):
        return [s for s in self.statements if is_ddl(s)]

    @property
    def commits(self):
        return sum(1 for e in self.events if e[0] == 'commit')

    @property
    def rollbacks(self):
        return sum(1 for e in self.events if e[0] == 'rollback')


def expected_ddl(names):
    """The DDL the named ensure_* functions issue, in order (computed, not hand-copied)."""
    conn = RecordingConn()
    for name in names:
        getattr(ingest, name)(conn)
    return conn.ddl


# --- lock timeout in every ensure function (spec PR C point 4) ----------------------

class TestLockTimeoutInEveryEnsureFunction:
    def test_there_are_18_and_the_list_above_names_them_all(self):
        found = sorted(n for n in dir(ingest) if n.startswith('ensure_') and callable(getattr(ingest, n)))
        assert found == sorted(ALL_ENSURE)
        assert len(found) == 18

    @pytest.mark.parametrize("name", ALL_ENSURE)
    def test_lock_timeout_is_the_first_statement(self, name):
        conn = RecordingConn()
        getattr(ingest, name)(conn)
        assert conn.statements[0] == LOCK_TIMEOUT
        assert conn.statements.count(LOCK_TIMEOUT) == 1
        assert len(conn.ddl) >= 1
        # SET LOCAL lasts for one transaction: everything must be inside the single commit.
        assert conn.commits == 1
        assert conn.events[-1] == ('commit',)
        assert conn.events[0] == ('execute', LOCK_TIMEOUT)

    @pytest.mark.parametrize("name", ALL_ENSURE)
    def test_lock_timeout_error_is_not_swallowed(self, name):
        """LockNotAvailable is an OperationalError: run_seasons retries the season."""
        class Locked(RecordingConn):
            def cursor(self):
                outer = self

                class Cur(RecordingCursor):
                    def execute(self, sql, params=None):
                        super().execute(sql, params)
                        if is_ddl(' '.join(sql.split())):
                            raise psycopg2.errors.LockNotAvailable("canceling statement due to lock timeout")
                return Cur(outer)

        conn = Locked()
        with pytest.raises(psycopg2.errors.LockNotAvailable):
            getattr(ingest, name)(conn)
        assert conn.statements[0] == LOCK_TIMEOUT
        assert conn.commits == 0
        assert isinstance(psycopg2.errors.LockNotAvailable("x"), ingest.TRANSIENT_DB_ERRORS)


# --- the schema hash (review M5) -----------------------------------------------------

class TestSchemaHash:
    def make(self, tmp_path, code="CREATE TABLE a;\n", reqs="pandas==2.2.3\n"):
        (tmp_path / "ingest.py").write_text(code, encoding="utf-8")
        (tmp_path / "requirements.txt").write_text(reqs, encoding="utf-8")
        return ingest.compute_schema_hash(script_dir=str(tmp_path))

    def test_changes_with_any_edit_to_ingest_py(self, tmp_path):
        a = self.make(tmp_path)
        assert a == self.make(tmp_path) and len(a) == 64
        assert a != self.make(tmp_path, code="CREATE TABLE a; ALTER TABLE a ADD COLUMN b INT;\n")

    def test_ignores_requirements(self, tmp_path):
        assert self.make(tmp_path) == self.make(tmp_path, reqs="pandas==9.9.9\n")

    def test_unreadable_file_is_unknown(self, tmp_path):
        assert ingest.compute_schema_hash(script_dir=str(tmp_path / "missing")) is None

    def test_real_file_hashes(self):
        value = ingest.compute_schema_hash()
        assert isinstance(value, str) and len(value) == 64


# --- gating through main(), with the pipeline faked ----------------------------------

def kwargs_seen(calls):
    return [c[2] for c in calls]


class TestSchemaGate:
    def test_first_run_ensures_and_records_the_hash_after_the_commit(self, h):
        seen = {}

        def during(season):
            seen['recorded'] = h.state_path.exists() and 'schema_hash' in h.state()
        h.pipeline.on_process = during
        h.run()
        assert kwargs_seen(h.pipeline.season_calls) == [{}]          # ensure steps on (the default)
        assert kwargs_seen(h.pipeline.schedule_calls) == [{}]
        assert seen == {'recorded': False}
        assert h.state()['schema_hash'] == 'schema-1'

    def test_matching_hash_skips_the_ensure_steps_on_the_next_full_run(self, h):
        h.run()
        h.hours_pass(4)
        h.github.assets['pbp'][PBP] = "sha256:pbp-2"
        h.run()
        assert kwargs_seen(h.pipeline.season_calls) == [{'ensure_schema': False}]
        assert kwargs_seen(h.pipeline.schedule_calls) == [{'ensure_schema': False}]

    def test_changed_hash_runs_them_once_then_skips_again(self, h):
        h.run()
        h.hours_pass(4)
        h.schema_hash = "schema-2"
        h.code_hash = "code-2"                                       # ingest.py changed: both hashes move
        h.run()
        assert kwargs_seen(h.pipeline.season_calls) == [{}]
        assert h.state()['schema_hash'] == 'schema-2'
        h.hours_pass(4)
        h.github.assets['pbp'][PBP] = "sha256:pbp-3"
        h.run()
        assert kwargs_seen(h.pipeline.season_calls) == [{'ensure_schema': False}]

    def test_force_runs_them_even_with_a_matching_hash(self, h):
        h.run()
        h.hours_pass(1)
        h.run("--force")
        assert kwargs_seen(h.pipeline.season_calls) == [{}]
        assert kwargs_seen(h.pipeline.schedule_calls) == [{}]

    def test_unknown_schema_hash_always_ensures_and_is_never_recorded(self, h):
        h.schema_hash = None
        h.run()
        assert 'schema_hash' not in h.state()
        h.hours_pass(4)
        h.github.assets['pbp'][PBP] = "sha256:pbp-2"
        h.run()
        assert kwargs_seen(h.pipeline.season_calls) == [{}]

    def test_no_state_file_ensures_every_time(self, h):
        """Revert safety (review M9): with PR A's state file gone, PR C is today's behaviour."""
        h.run(state=False)
        h.run(state=False)
        assert kwargs_seen(h.pipeline.season_calls) == [{}]
        assert kwargs_seen(h.pipeline.schedule_calls) == [{}]

    @pytest.mark.parametrize("error", [KeyError("boom"), ingest.DataNotYetPublished("not yet")],
                             ids=["failed", "not-published"])
    def test_hash_not_recorded_unless_the_season_committed(self, h, error):
        h.pipeline.season_errors[2026] = [error]
        try:
            h.run()
        except KeyError:
            pass
        assert not h.state_path.exists() or 'schema_hash' not in h.state()

    def test_hash_not_recorded_when_the_schedules_ingest_failed(self, h):
        """ensure_games_table runs inside ingest_schedules: if that failed, the games DDL may not exist."""
        h.pipeline.schedule_errors[2026] = [psycopg2.errors.LockNotAvailable("lock timeout")]
        h.run()
        assert 'schema_hash' not in h.state()
        h.hours_pass(4)
        h.run()
        assert kwargs_seen(h.pipeline.season_calls) == [{}]
        assert h.state()['schema_hash'] == 'schema-1'

    def test_all_seasons_ensure_once_per_run(self, h, monkeypatch):
        monkeypatch.setattr(ingest, "FIRST_SEASON", 2025)
        monkeypatch.setattr(ingest, "CURRENT_SEASON", 2026)
        h.run(season="all")
        assert kwargs_seen(h.pipeline.season_calls) == [{}, {'ensure_schema': False}]

    def test_unreadable_state_ensures(self, h):
        h.run()
        h.state_path.write_text("{broken", encoding="utf-8")
        h.hours_pass(4)
        h.run()
        assert kwargs_seen(h.pipeline.season_calls) == [{}]


# --- self-heal in run_seasons (spec PR C point 3, review M7) ---------------------------

def missing_column():
    return psycopg2.errors.UndefinedColumn('column "designed_runs" of relation "team_game_stats" does not exist')


def missing_table():
    return psycopg2.errors.UndefinedTable('relation "team_game_stats" does not exist')


@pytest.fixture
def skipping(h):
    """A harness whose stored schema hash matches: the next full run skips the ensure steps."""
    h.run()
    h.hours_pass(4)
    h.github.assets['pbp'][PBP] = "sha256:pbp-2"
    h.conn_factory = RecordingConn
    return h


class TestSelfHeal:
    @pytest.mark.parametrize("make_error", [missing_column, missing_table], ids=["column", "table"])
    def test_missing_object_with_ensure_skipped_heals_once(self, skipping, make_error, caplog):
        h = skipping
        h.pipeline.season_errors[2026] = [make_error()]
        with caplog.at_level(logging.INFO, logger="ingest"):
            assert h.run() == 1                                       # same connection, no reconnect
        assert kwargs_seen(h.pipeline.season_calls) == [{'ensure_schema': False}, {}]
        assert kwargs_seen(h.pipeline.schedule_calls) == [{'ensure_schema': False}, {}]
        assert h.sleeps == []                                         # not a transient retry: no wait
        assert h.conns[0].rollbacks == 1                              # rolled back before the retry
        assert "running the schema steps" in caplog.text
        assert h.state()['seasons']['2026']['pbp'] == "sha256:pbp-2"

    def test_second_missing_object_is_raised(self, skipping):
        h = skipping
        first, second = missing_column(), missing_column()
        h.pipeline.season_errors[2026] = [first, second, missing_column()]
        with pytest.raises(psycopg2.errors.UndefinedColumn) as exc:
            h.run()
        assert exc.value is second
        assert len(h.pipeline.season_calls) == 2                      # once-only: no loop

    def test_missing_object_with_ensure_on_is_raised_at_once(self, h):
        err = missing_table()
        h.pipeline.season_errors[2026] = [err]
        with pytest.raises(psycopg2.errors.UndefinedTable) as exc:
            h.run()                                                   # no state: ensure steps were on
        assert exc.value is err
        assert len(h.pipeline.season_calls) == 1

    def test_no_heal_when_too_little_time_is_left(self, skipping, monkeypatch, caplog):
        h = skipping
        monkeypatch.setattr(ingest, "RUN_BUDGET_SECONDS", ingest.MIN_ATTEMPT_SECONDS - 60)
        err = missing_column()
        h.pipeline.season_errors[2026] = [err]
        with caplog.at_level(logging.INFO, logger="ingest"):
            with pytest.raises(psycopg2.errors.UndefinedColumn) as exc:
                h.run()
        assert exc.value is err
        assert len(h.pipeline.season_calls) == 1
        assert "deadline" in caplog.text

    def test_heal_then_transient_error_still_gets_its_retry(self, skipping):
        h = skipping
        h.pipeline.season_errors[2026] = [missing_column(), psycopg2.OperationalError("blip")]
        assert h.run() == 2                                           # the transient retry reconnects
        # the repair stays switched on for the rest of the season's attempts
        assert kwargs_seen(h.pipeline.season_calls) == [{'ensure_schema': False}, {}, {}]
        assert h.sleeps == [120]

    def test_transient_error_then_heal(self, skipping):
        h = skipping
        h.pipeline.season_errors[2026] = [psycopg2.OperationalError("blip"), missing_column()]
        assert h.run() == 2
        assert kwargs_seen(h.pipeline.season_calls) == [{'ensure_schema': False}, {'ensure_schema': False}, {}]
        assert h.sleeps == [120]

    def test_heal_does_not_use_up_the_transient_retries(self, skipping):
        h = skipping
        h.pipeline.season_errors[2026] = [missing_column(), psycopg2.OperationalError("a"),
                                          psycopg2.OperationalError("b")]
        assert h.run() == 3
        assert len(h.pipeline.season_calls) == 4                      # 1 + heal + 2 transient retries
        assert h.sleeps == [120, 300]

    def test_each_season_gets_its_own_heal(self, skipping, monkeypatch):
        h = skipping
        monkeypatch.setattr(ingest, "FIRST_SEASON", 2025)
        monkeypatch.setattr(ingest, "CURRENT_SEASON", 2026)
        h.pipeline.season_errors[2025] = [missing_column()]
        h.run(season="all")
        # 2025 healed (ensure ran, hash recorded again) so 2026 skips the ensure steps
        assert [(c[0], c[2]) for c in h.pipeline.season_calls] == [
            (2025, {'ensure_schema': False}), (2025, {}), (2026, {'ensure_schema': False})]

    def test_dry_run_never_heals(self, h):
        h.pipeline.season_errors[2026] = [missing_column()]
        with pytest.raises(psycopg2.errors.UndefinedColumn):
            h.run("--dry-run")
        assert len(h.pipeline.season_calls) == 1


# --- the real process_season / ingest_schedules against a recording connection ---------

class RealPipeline:
    """Everything that would download, aggregate or upsert is stubbed; the ensure_*
    functions, process_season, ingest_schedules and run_seasons are the real ones."""

    def __init__(self, h, monkeypatch):
        self.h = h
        self.upserts = []
        self.fail_upsert = {}          # upsert name -> list of exceptions (consumed per call)
        self.freshness_errors = []     # get_existing_through_week errors (consumed per call)
        week4 = pd.DataFrame({'week': [4]})
        monkeypatch.setattr(ingest, 'download_pbp', lambda season: week4)
        monkeypatch.setattr(ingest, 'download_roster', lambda season: pd.DataFrame({'gsis_id': ['x'], 'position': ['QB']}))
        monkeypatch.setattr(ingest, 'download_participation', lambda season: None)
        monkeypatch.setattr(ingest, 'filter_plays', lambda pbp: week4)
        monkeypatch.setattr(ingest, 'filter_spikes', lambda pbp: pd.DataFrame())
        for name in dir(ingest):
            if name.startswith('aggregate_'):
                monkeypatch.setattr(ingest, name, lambda *a, **k: pd.DataFrame())
            elif name.startswith('upsert_'):
                monkeypatch.setattr(ingest, name, self._upsert(name))
        monkeypatch.setattr(ingest, 'aggregate_team_stats', lambda *a, **k: pd.DataFrame({'team_id': ['BUF']}))
        monkeypatch.setattr(ingest, 'aggregate_qb_stats', lambda *a, **k: pd.DataFrame({'player_id': ['00-1']}))
        monkeypatch.setattr(ingest, 'validate_data', lambda *a, **k: None)
        monkeypatch.setattr(ingest, 'generate_player_slugs', lambda *a, **k: pd.DataFrame())
        monkeypatch.setattr(ingest, 'cleanup_stale_rows', lambda conn, season, **k: None)
        monkeypatch.setattr(ingest, 'update_freshness', lambda conn, season, week: None)
        monkeypatch.setattr(ingest, 'get_existing_through_week', self._through_week)
        monkeypatch.setattr(ingest, 'execute_values', self._execute_values)
        monkeypatch.setattr(ingest, 'process_season', REAL_PROCESS_SEASON)
        monkeypatch.setattr(ingest, 'ingest_schedules', REAL_INGEST_SCHEDULES)
        h.conn_factory = RecordingConn

    def _upsert(self, name):
        def upsert(conn, df):
            queue = self.fail_upsert.get(name, [])
            if queue:
                conn.fail(queue.pop(0))
            self.upserts.append(name)
            with conn.cursor() as cur:
                cur.execute(f"INSERT INTO /* {name} */ t VALUES (1)")
        return upsert

    def _through_week(self, conn, season):
        with conn.cursor() as cur:
            cur.execute("SELECT through_week FROM data_freshness WHERE season = %s")
        if self.freshness_errors:
            conn.fail(self.freshness_errors.pop(0))
        return None

    def _execute_values(self, cur, sql, rows):
        cur.execute(' '.join(sql.split()))


@pytest.fixture
def real(h, monkeypatch):
    return RealPipeline(h, monkeypatch)


def second_run(h):
    """A full run whose stored schema hash matches."""
    h.run()
    h.hours_pass(4)
    h.github.assets['pbp'][PBP] = "sha256:pbp-2"


class TestNormalRunIssuesNoDdl:
    def test_first_run_issues_todays_ddl_in_todays_order(self, h, real):
        h.run()
        conn = h.conns[0]
        assert conn.ddl == expected_ddl(ALL_ENSURE)
        assert conn.statements.count(LOCK_TIMEOUT) == 18
        assert conn.commits == 21        # connect + 18 ensure + schedules + season, as before this change
        assert h.state()['schema_hash'] == 'schema-1'

    def test_normal_run_issues_zero_ddl_statements(self, h, real, caplog):
        second_run(h)
        real.upserts.clear()             # forget the first (setup) run
        with caplog.at_level(logging.INFO, logger="ingest"):
            assert h.run() == 1
        conn = h.conns[0]
        assert conn.ddl == []            # DDL count on a normal run == 0
        assert LOCK_TIMEOUT not in conn.statements
        assert not any('ROW LEVEL SECURITY' in s or 'POLICY' in s for s in conn.statements)
        assert conn.commits == 3         # connect, schedules, season
        assert conn.rollbacks == 0
        assert "schema unchanged: skipped 17 ensure steps" in caplog.text
        assert "Ensured" not in caplog.text
        # the work itself still happened
        assert any(s.startswith('INSERT INTO games') for s in conn.statements)
        assert 'upsert_team_game_stats' in real.upserts

    def test_forced_run_issues_the_ddl_again(self, h, real):
        second_run(h)
        h.run("--force")
        assert h.conns[0].ddl == expected_ddl(ALL_ENSURE)

    def test_process_season_default_still_ensures(self, real):
        """Called the old way (seed.yml, local runs): 17 ensure steps, as before."""
        conn = RecordingConn()
        ingest.process_season(2026, conn)
        assert conn.ddl == expected_ddl(SEASON_ENSURE_ORDER)
        assert conn.commits == 18

    def test_process_season_can_skip_them(self, real):
        conn = RecordingConn()
        ingest.process_season(2026, conn, ensure_schema=False)
        assert conn.ddl == [] and conn.commits == 1


class TestSelfHealWithARealAbortedTransaction:
    def test_missing_column_on_an_upsert_heals(self, h, real, caplog):
        second_run(h)
        real.upserts.clear()             # forget the first (setup) run
        real.fail_upsert['upsert_team_game_stats'] = [missing_column()]
        with caplog.at_level(logging.INFO, logger="ingest"):
            assert h.run() == 1
        conn = h.conns[0]
        kinds = [e[0] if e[0] != 'execute' else ('ddl' if is_ddl(e[1]) or e[1] == LOCK_TIMEOUT else 'sql')
                 for e in conn.events]
        error_at = kinds.index('error')
        first_ddl = kinds.index('ddl')
        assert first_ddl > error_at                                   # no DDL before the failure
        assert 'rollback' in kinds[error_at:first_ddl]                # rolled back BEFORE the first ensure
        after = [e[1] for e in conn.events[error_at:] if e[0] == 'execute']
        assert [s for s in after if is_ddl(s)] == expected_ddl(ALL_ENSURE)
        assert conn.events[-1] == ('commit',)                         # the retried season committed
        assert real.upserts.count('upsert_team_game_stats') == 1
        assert h.state()['seasons']['2026']['pbp'] == "sha256:pbp-2"
        assert "FAILED" not in h.summary()

    def test_missing_data_freshness_fails_once_more_and_never_loops(self, h, real):
        """get_existing_through_week runs outside process_season's own try: nothing has
        rolled the transaction back when run_seasons sees the error (review M7)."""
        second_run(h)
        real.upserts.clear()             # forget the first (setup) run
        first = psycopg2.errors.UndefinedTable('relation "data_freshness" does not exist')
        second = psycopg2.errors.UndefinedTable('relation "data_freshness" does not exist')
        real.freshness_errors = [first, second, missing_table()]
        with pytest.raises(psycopg2.errors.UndefinedTable) as exc:
            h.run()
        assert exc.value is second
        conn = h.conns[0]
        assert [e for e in conn.events if e[0] == 'error'] == [('error', 'UndefinedTable')] * 2
        first_error = conn.events.index(('error', 'UndefinedTable'))
        assert conn.events[first_error + 1] == ('rollback',)          # usable again for the retry
        # the retry ran with the ensure steps on, but only reached the games table
        assert [s for s in conn.statements if is_ddl(s)] == expected_ddl(['ensure_games_table'])
        assert real.upserts == []
        assert '2026: FAILED' in h.summary()


# --- ingest_schedules: gate and local self-heal (review I6) -----------------------------

class TestSchedulesGate:
    def run(self, monkeypatch, conn, errors=(), **kwargs):
        monkeypatch.setattr(ingest, '_SCHEDULES_CACHE', schedules_frame())
        queue = list(errors)
        calls = []

        def fake_execute_values(cur, sql, rows):
            calls.append(len(rows))
            cur.execute(' '.join(sql.split()))
            if queue:
                conn.fail(queue.pop(0))
        monkeypatch.setattr(ingest, 'execute_values', fake_execute_values)
        return calls, (lambda: ingest.ingest_schedules(conn, 2026, **kwargs))

    def test_default_still_creates_the_table_first(self, monkeypatch):
        conn = RecordingConn()
        calls, go = self.run(monkeypatch, conn)
        assert go() == 2
        assert conn.ddl == expected_ddl(['ensure_games_table'])
        assert conn.commits == 2

    def test_skipped_gate_issues_no_ddl(self, monkeypatch):
        conn = RecordingConn()
        calls, go = self.run(monkeypatch, conn, ensure_schema=False)
        assert go() == 2
        assert conn.ddl == [] and LOCK_TIMEOUT not in conn.statements
        assert conn.commits == 1 and conn.rollbacks == 0

    @pytest.mark.parametrize("error", [
        psycopg2.errors.UndefinedTable('relation "games" does not exist'),
        psycopg2.errors.UndefinedColumn('column "weekday" of relation "games" does not exist'),
    ], ids=["table", "column"])
    def test_missing_table_or_column_heals_once(self, monkeypatch, error, caplog):
        conn = RecordingConn()
        calls, go = self.run(monkeypatch, conn, errors=[error], ensure_schema=False)
        with caplog.at_level(logging.INFO, logger="ingest"):
            assert go() == 2
        assert calls == [2, 2]                                        # upsert retried once
        kinds = [e[0] for e in conn.events]
        assert kinds.index('rollback') == kinds.index('error') + 1    # rollback, then the DDL
        assert conn.ddl == expected_ddl(['ensure_games_table'])
        assert conn.events[-1] == ('commit',)
        assert "creating it and retrying once" in caplog.text

    def test_second_failure_raises_and_leaves_the_connection_usable(self, monkeypatch):
        conn = RecordingConn()
        second = psycopg2.errors.UndefinedColumn('column "weekday" does not exist')
        calls, go = self.run(monkeypatch, conn,
                             errors=[psycopg2.errors.UndefinedTable('relation "games" does not exist'), second],
                             ensure_schema=False)
        with pytest.raises(psycopg2.errors.UndefinedColumn) as exc:
            go()
        assert exc.value is second
        assert calls == [2, 2]
        assert conn.aborted is False and conn.events[-1] == ('rollback',)

    def test_no_heal_when_the_table_was_just_ensured(self, monkeypatch):
        conn = RecordingConn()
        err = psycopg2.errors.UndefinedColumn('column "weekday" does not exist')
        calls, go = self.run(monkeypatch, conn, errors=[err])
        with pytest.raises(psycopg2.errors.UndefinedColumn) as exc:
            go()
        assert exc.value is err
        assert calls == [2]
        assert conn.aborted is False

    def test_other_errors_are_not_healed(self, monkeypatch):
        conn = RecordingConn()
        err = psycopg2.errors.QueryCanceled("canceling statement due to statement timeout")
        calls, go = self.run(monkeypatch, conn, errors=[err], ensure_schema=False)
        with pytest.raises(psycopg2.errors.QueryCanceled):
            go()
        assert calls == [2] and conn.ddl == []

    def test_dry_run_unchanged(self, monkeypatch):
        monkeypatch.setattr(ingest, '_SCHEDULES_CACHE', schedules_frame())
        assert ingest.ingest_schedules(None, 2026, ensure_schema=False) is None
