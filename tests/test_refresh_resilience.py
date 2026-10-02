"""Refresh resilience: ride out Supabase connection/latency blips (2026-10-02 spec + review).

No real database: psycopg2.connect, process_season, ingest_schedules and the clock are faked.
"""
import logging
from urllib.error import URLError

import psycopg2
import psycopg2.errors
import pytest

import ingest

FAKE_URL = "postgresql://someuser:hunter2@fakehost.invalid:5432/postgres"


class FakeClock:
    """time.monotonic + time.sleep on one virtual timeline."""

    def __init__(self, start=1000.0):
        self.now = start
        self.sleeps = []

    def monotonic(self):
        return self.now

    def sleep(self, seconds):
        self.sleeps.append(seconds)
        self.now += seconds


class FakeCursor:
    def __init__(self, conn):
        self.conn = conn

    def execute(self, sql, params=None):
        if self.conn.fail_set:
            raise psycopg2.OperationalError("server closed the connection unexpectedly")
        self.conn.executed.append(sql)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def close(self):
        pass


class FakeConn:
    def __init__(self, name, fail_set=False):
        self.name = name
        self.closed = 0
        self.close_calls = 0
        self.commits = 0
        self.executed = []
        self.fail_set = fail_set

    def cursor(self):
        return FakeCursor(self)

    def commit(self):
        self.commits += 1

    def rollback(self):
        pass

    def close(self):
        self.close_calls += 1
        self.closed = 1

    def __repr__(self):
        return f"FakeConn({self.name})"


class ScriptedConnect:
    """psycopg2.connect stand-in: each call pops the next scripted result (exception or conn)."""

    def __init__(self, script):
        self.script = list(script)
        self.calls = []

    def __call__(self, *args, **kwargs):
        self.calls.append((args, kwargs))
        item = self.script.pop(0)
        if isinstance(item, BaseException):
            raise item
        return item


@pytest.fixture
def clock(monkeypatch):
    c = FakeClock()
    monkeypatch.setattr(ingest.time, "monotonic", c.monotonic)
    monkeypatch.setattr(ingest.time, "sleep", c.sleep)
    return c


def op_err(msg="(ECHECKOUTTIMEOUT) unable to check out connection from the pool"):
    return psycopg2.OperationalError(msg)


def full_deadline(clock):
    return clock.now + ingest.RUN_BUDGET_SECONDS


# --- connect_with_retry -------------------------------------------------------

class TestConnectWithRetry:
    def test_succeeds_on_third_attempt_with_expected_waits(self, clock, monkeypatch, caplog):
        good = FakeConn("good")
        connect = ScriptedConnect([op_err(), op_err(), good])
        monkeypatch.setattr(ingest.psycopg2, "connect", connect)
        with caplog.at_level(logging.INFO, logger="ingest"):
            conn = ingest.connect_with_retry(FAKE_URL, full_deadline(clock))
        assert conn is good
        assert len(connect.calls) == 3
        assert clock.sleeps == [30, 60]
        assert connect.calls[0][1].get("connect_timeout") == 30

    def test_sets_120s_statement_timeout_on_every_connection(self, clock, monkeypatch):
        good = FakeConn("good")
        monkeypatch.setattr(ingest.psycopg2, "connect", ScriptedConnect([good]))
        ingest.connect_with_retry(FAKE_URL, full_deadline(clock))
        assert any("statement_timeout" in s and "120000" in s for s in good.executed)
        assert good.commits >= 1  # session-level SET must survive the next transaction

    def test_failed_statement_timeout_set_counts_as_failed_attempt(self, clock, monkeypatch):
        bad = FakeConn("bad", fail_set=True)
        good = FakeConn("good")
        monkeypatch.setattr(ingest.psycopg2, "connect", ScriptedConnect([bad, good]))
        conn = ingest.connect_with_retry(FAKE_URL, full_deadline(clock))
        assert conn is good
        assert bad.closed
        assert clock.sleeps == [30]

    def test_gives_up_after_five_attempts_and_reraises(self, clock, monkeypatch):
        errors = [op_err(f"attempt {i}") for i in range(1, 6)]
        connect = ScriptedConnect(errors)
        monkeypatch.setattr(ingest.psycopg2, "connect", connect)
        with pytest.raises(psycopg2.OperationalError) as exc:
            ingest.connect_with_retry(FAKE_URL, full_deadline(clock))
        assert exc.value is errors[-1]
        assert len(connect.calls) == 5
        assert clock.sleeps == [30, 60, 120, 240]

    def test_never_sleeps_past_the_deadline(self, clock, monkeypatch, caplog):
        err = op_err()
        connect = ScriptedConnect([err, FakeConn("never")])
        monkeypatch.setattr(ingest.psycopg2, "connect", connect)
        with caplog.at_level(logging.INFO, logger="ingest"):
            with pytest.raises(psycopg2.OperationalError) as exc:
                ingest.connect_with_retry(FAKE_URL, clock.now + 40)  # 30 s wait + 30 s connect won't fit
        assert exc.value is err
        assert clock.sleeps == []
        assert len(connect.calls) == 1
        assert "deadline" in caplog.text

    def test_logs_never_contain_the_database_url(self, clock, monkeypatch, caplog):
        monkeypatch.setattr(ingest.psycopg2, "connect", ScriptedConnect([op_err(), op_err(), FakeConn("ok")]))
        with caplog.at_level(logging.DEBUG, logger="ingest"):
            ingest.connect_with_retry(FAKE_URL, full_deadline(clock))
        assert caplog.text  # the failures were logged...
        assert FAKE_URL not in caplog.text  # ...without the URL
        assert "hunter2" not in caplog.text


# --- retry decorator ----------------------------------------------------------

class TestRetryDecoratorDbErrors:
    @pytest.mark.parametrize("err", [
        psycopg2.errors.QueryCanceled("canceling statement due to statement timeout"),
        psycopg2.errors.InFailedSqlTransaction("current transaction is aborted"),
        psycopg2.OperationalError("server closed the connection unexpectedly"),
    ])
    def test_psycopg2_errors_reraised_immediately(self, clock, err):
        calls = []

        @ingest.retry(max_retries=3, delay=5)
        def upsert():
            calls.append(1)
            raise err

        with pytest.raises(type(err)) as exc:
            upsert()
        assert exc.value is err
        assert calls == [1]
        assert clock.sleeps == []

    def test_url_error_still_retried(self, clock):
        calls = []

        @ingest.retry(max_retries=3, delay=5, backoff=2)
        def download():
            calls.append(1)
            if len(calls) < 3:
                raise URLError("temporary failure in name resolution")
            return "ok"

        assert download() == "ok"
        assert len(calls) == 3
        assert clock.sleeps == [5, 10]


# --- run_seasons: season-level retry -------------------------------------------

class SeasonScript:
    """process_season / ingest_schedules fakes that record which conn each call got."""

    def __init__(self, outcomes=None, schedule_outcomes=None):
        # outcomes: {season: [exception-or-None, ...]} consumed per call
        self.outcomes = {k: list(v) for k, v in (outcomes or {}).items()}
        self.schedule_outcomes = {k: list(v) for k, v in (schedule_outcomes or {}).items()}
        self.calls = []
        self.schedule_calls = []

    def process_season(self, season, conn, dry_run=False):
        self.calls.append((season, conn, dry_run))
        queue = self.outcomes.get(season, [])
        result = queue.pop(0) if queue else None
        if result is not None:
            raise result

    def ingest_schedules(self, conn, season):
        self.schedule_calls.append((season, conn))
        queue = self.schedule_outcomes.get(season, [])
        result = queue.pop(0) if queue else None
        if result is not None:
            raise result


@pytest.fixture
def season_script(monkeypatch):
    def install(**kwargs):
        s = SeasonScript(**kwargs)
        monkeypatch.setattr(ingest, "process_season", s.process_season)
        monkeypatch.setattr(ingest, "ingest_schedules", s.ingest_schedules)
        return s
    return install


class TestRunSeasonsRetry:
    def test_query_canceled_once_then_succeeds(self, clock, monkeypatch, season_script):
        c1, c2 = FakeConn("c1"), FakeConn("c2")
        connect = ScriptedConnect([c1, c2])
        monkeypatch.setattr(ingest.psycopg2, "connect", connect)
        s = season_script(outcomes={2026: [psycopg2.errors.QueryCanceled("statement timeout")]})

        ingest.run_seasons([2026], FAKE_URL, False, full_deadline(clock))

        assert [c for _, c, _ in s.calls] == [c1, c2]
        assert len(connect.calls) == 2
        assert clock.sleeps == [120]
        assert c1.closed and c2.closed

    def test_operational_error_three_times_reraised_after_two_retries(self, clock, monkeypatch, season_script):
        conns = [FakeConn(f"c{i}") for i in range(3)]
        monkeypatch.setattr(ingest.psycopg2, "connect", ScriptedConnect(conns))
        errs = [op_err(f"blip {i}") for i in range(3)]
        s = season_script(outcomes={2026: list(errs)})

        with pytest.raises(psycopg2.OperationalError) as exc:
            ingest.run_seasons([2026], FAKE_URL, False, full_deadline(clock))

        assert exc.value is errs[-1]
        assert len(s.calls) == 3
        assert clock.sleeps == [120, 300]
        assert all(c.closed for c in conns)

    def test_error_surfacing_from_rollback_is_retried(self, clock, monkeypatch, season_script):
        # process_season's except path calls conn.rollback(); on a dead connection that raises
        # InterfaceError, which replaces the original error. It must still count as transient.
        c1, c2 = FakeConn("c1"), FakeConn("c2")
        monkeypatch.setattr(ingest.psycopg2, "connect", ScriptedConnect([c1, c2]))
        s = season_script(outcomes={2026: [psycopg2.InterfaceError("connection already closed")]})

        ingest.run_seasons([2026], FAKE_URL, False, full_deadline(clock))

        assert len(s.calls) == 2
        assert s.calls[-1][1] is c2

    def test_in_failed_sql_transaction_is_retried(self, clock, monkeypatch, season_script):
        monkeypatch.setattr(ingest.psycopg2, "connect", ScriptedConnect([FakeConn("c1"), FakeConn("c2")]))
        s = season_script(outcomes={2026: [psycopg2.errors.InFailedSqlTransaction("current transaction is aborted")]})
        ingest.run_seasons([2026], FAKE_URL, False, full_deadline(clock))
        assert len(s.calls) == 2

    @pytest.mark.parametrize("err", [
        ingest.DataQualityError("PBP for 2026 only goes through week 3 but DB already has week 4"),
        ValueError("validate_data: EPA/play out of range"),
        KeyError("player_id"),
    ])
    def test_non_transient_errors_not_retried(self, clock, monkeypatch, season_script, err):
        c1 = FakeConn("c1")
        connect = ScriptedConnect([c1])
        monkeypatch.setattr(ingest.psycopg2, "connect", connect)
        s = season_script(outcomes={2026: [err]})

        with pytest.raises(type(err)) as exc:
            ingest.run_seasons([2026], FAKE_URL, False, full_deadline(clock))

        assert exc.value is err
        assert len(s.calls) == 1
        assert len(connect.calls) == 1
        assert clock.sleeps == []
        assert c1.closed

    def test_data_not_yet_published_still_skipped(self, clock, monkeypatch, season_script, caplog):
        c1 = FakeConn("c1")
        monkeypatch.setattr(ingest.psycopg2, "connect", ScriptedConnect([c1]))
        s = season_script(outcomes={2026: [ingest.DataNotYetPublished("PBP file for 2026 not on nflverse yet.")]})

        with caplog.at_level(logging.INFO, logger="ingest"):
            ingest.run_seasons([2026], FAKE_URL, False, full_deadline(clock))

        assert len(s.calls) == 1
        assert clock.sleeps == []
        assert "Season 2026 skipped" in caplog.text
        assert c1.closed

    def test_schedules_rerun_on_retry_and_their_failure_does_not_stop_it(self, clock, monkeypatch, season_script):
        c1, c2 = FakeConn("c1"), FakeConn("c2")
        monkeypatch.setattr(ingest.psycopg2, "connect", ScriptedConnect([c1, c2]))
        s = season_script(
            outcomes={2026: [op_err("blip")]},
            schedule_outcomes={2026: [op_err("schedules blip")]},
        )

        ingest.run_seasons([2026], FAKE_URL, False, full_deadline(clock))

        assert s.schedule_calls == [(2026, c1), (2026, c2)]
        assert [c for _, c, _ in s.calls] == [c1, c2]

    def test_reconnects_before_attempt_when_connection_already_closed(self, clock, monkeypatch, season_script):
        c1, c2 = FakeConn("c1"), FakeConn("c2")
        connect = ScriptedConnect([c1, c2])
        monkeypatch.setattr(ingest.psycopg2, "connect", connect)
        s = season_script()
        # 2025's schedules notices the connection died (closed flag set) and only warns.
        def dying_schedules(conn, season):
            s.schedule_calls.append((season, conn))
            if season == 2025:
                conn.closed = 2
                raise psycopg2.InterfaceError("connection already closed")
        monkeypatch.setattr(ingest, "ingest_schedules", dying_schedules)

        ingest.run_seasons([2025, 2026], FAKE_URL, False, full_deadline(clock))

        # process_season gets a fresh connection instead of wasting its downloads on the dead one,
        # and that connection carries on to 2026.
        assert [(season, c) for season, c, _ in s.calls] == [(2025, c2), (2026, c2)]
        assert s.schedule_calls == [(2025, c1), (2026, c2)]
        assert len(connect.calls) == 2
        assert clock.sleeps == []
        assert c2.closed

    def test_reconnected_conn_used_by_later_seasons_and_closed_in_finally(self, clock, monkeypatch, season_script):
        c1, c2 = FakeConn("c1"), FakeConn("c2")
        connect = ScriptedConnect([c1, c2])
        monkeypatch.setattr(ingest.psycopg2, "connect", connect)
        s = season_script(outcomes={2025: [op_err("blip")]})

        ingest.run_seasons([2025, 2026], FAKE_URL, False, full_deadline(clock))

        assert [(season, c) for season, c, _ in s.calls] == [(2025, c1), (2025, c2), (2026, c2)]
        assert s.schedule_calls[-1] == (2026, c2)
        assert c1.closed and c2.closed
        assert c2.close_calls >= 1
        assert len(connect.calls) == 2

    def test_new_conn_closed_in_finally_when_later_season_fails(self, clock, monkeypatch, season_script):
        c1, c2 = FakeConn("c1"), FakeConn("c2")
        monkeypatch.setattr(ingest.psycopg2, "connect", ScriptedConnect([c1, c2]))
        season_script(outcomes={2025: [op_err("blip")], 2026: [KeyError("boom")]})

        with pytest.raises(KeyError):
            ingest.run_seasons([2025, 2026], FAKE_URL, False, full_deadline(clock))

        assert c2.closed

    def test_old_conn_close_error_is_ignored(self, clock, monkeypatch, season_script):
        c1, c2 = FakeConn("c1"), FakeConn("c2")

        def broken_close():
            raise psycopg2.InterfaceError("connection already closed")
        c1.close = broken_close
        monkeypatch.setattr(ingest.psycopg2, "connect", ScriptedConnect([c1, c2]))
        s = season_script(outcomes={2026: [op_err("blip")]})

        ingest.run_seasons([2026], FAKE_URL, False, full_deadline(clock))

        assert s.calls[-1][1] is c2

    def test_dry_run_never_connects_or_reconnects(self, clock, monkeypatch, season_script):
        connect = ScriptedConnect([])
        monkeypatch.setattr(ingest.psycopg2, "connect", connect)
        err = op_err("would never happen in dry run, but must not trigger a reconnect")
        s = season_script(outcomes={2026: [err]})

        with pytest.raises(psycopg2.OperationalError) as exc:
            ingest.run_seasons([2026], None, True, full_deadline(clock))

        assert exc.value is err
        assert connect.calls == []
        assert clock.sleeps == []
        assert s.calls == [(2026, None, True)]
        assert s.schedule_calls == [(2026, None)]

    def test_dry_run_happy_path_never_connects(self, clock, monkeypatch, season_script):
        connect = ScriptedConnect([])
        monkeypatch.setattr(ingest.psycopg2, "connect", connect)
        s = season_script()
        ingest.run_seasons([2025, 2026], None, True, full_deadline(clock))
        assert connect.calls == []
        assert [c for _, c, _ in s.calls] == [None, None]


class TestRunDeadline:
    def test_no_retry_when_too_little_time_left(self, clock, monkeypatch, season_script, caplog):
        c1 = FakeConn("c1")
        connect = ScriptedConnect([c1, FakeConn("never")])
        monkeypatch.setattr(ingest.psycopg2, "connect", connect)
        err = psycopg2.errors.QueryCanceled("canceling statement due to statement timeout")
        s = season_script(outcomes={2026: [err]})
        deadline = clock.now + ingest.MIN_ATTEMPT_SECONDS + 60  # less than wait + a full attempt

        with caplog.at_level(logging.INFO, logger="ingest"):
            with pytest.raises(psycopg2.errors.QueryCanceled) as exc:
                ingest.run_seasons([2026], FAKE_URL, False, deadline)

        assert exc.value is err
        assert len(s.calls) == 1
        assert clock.sleeps == []
        assert len(connect.calls) == 1
        assert "deadline" in caplog.text
        assert c1.closed

    def test_second_retry_skipped_once_budget_runs_low(self, clock, monkeypatch, season_script, caplog):
        # Each failing attempt burns 5 virtual minutes; the budget allows the first retry only.
        conns = [FakeConn(f"c{i}") for i in range(3)]
        monkeypatch.setattr(ingest.psycopg2, "connect", ScriptedConnect(conns))
        errs = [op_err(f"blip {i}") for i in range(3)]
        s = season_script(outcomes={2026: list(errs)})
        real_process = s.process_season

        def slow_process(season, conn, dry_run=False):
            clock.now += 300
            return real_process(season, conn, dry_run=dry_run)
        monkeypatch.setattr(ingest, "process_season", slow_process)

        with caplog.at_level(logging.INFO, logger="ingest"):
            with pytest.raises(psycopg2.OperationalError) as exc:
                ingest.run_seasons([2026], FAKE_URL, False, full_deadline(clock))

        # t=300 fail -> wait 120 -> t=720 fail; 1440-720-300 = 420 < 600+30 -> give up
        assert exc.value is errs[1]
        assert len(s.calls) == 2
        assert clock.sleeps == [120]
        assert "deadline" in caplog.text

    def test_reconnect_retries_respect_attempt_window(self, clock, monkeypatch, season_script):
        # After the season wait, reconnect keeps failing: its own retries must stop early enough
        # that a started attempt still has MIN_ATTEMPT_SECONDS before the run deadline.
        c1 = FakeConn("c1")
        connect = ScriptedConnect([c1] + [op_err(f"connect {i}") for i in range(5)])
        monkeypatch.setattr(ingest.psycopg2, "connect", connect)
        season_script(outcomes={2026: [op_err("blip")]})
        deadline = clock.now + 1000

        with pytest.raises(psycopg2.OperationalError):
            ingest.run_seasons([2026], FAKE_URL, False, deadline)

        # season wait 120, then connect waits 30, 60, 120; the 240 wait would cross deadline - 600
        assert clock.sleeps == [120, 30, 60, 120]
        assert clock.now <= deadline - ingest.MIN_ATTEMPT_SECONDS
