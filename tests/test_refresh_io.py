"""Refresh IO, PR A: skip the refresh when nothing ingest uses has changed
(docs/superpowers/specs/2026-10-06-refresh-io-design.md, revision 2).

No network and no database: the GitHub release API (ingest.urlopen), the schedules
download (ingest._SCHEDULES_CACHE), psycopg2.connect, process_season and
ingest_schedules are all faked.
"""
import io
import json
import logging
import os
from datetime import datetime, timedelta, timezone
from urllib.error import HTTPError, URLError

import pandas as pd
import pytest

import ingest
from test_refresh_resilience import FAKE_URL, FakeConn, ScriptedConnect

TOKEN = "ghs_FAKEtokenFAKEtokenFAKEtoken"
T0 = datetime(2026, 10, 6, 12, 0, 0, tzinfo=timezone.utc)

PBP = "play_by_play_2026.parquet"
ROSTER = "roster_weekly_2026.parquet"
PARTICIPATION = "pbp_participation_2026.parquet"


# --- fakes ----------------------------------------------------------------------

class FakeResponse:
    def __init__(self, status, body):
        self.status = status
        self._body = body if isinstance(body, bytes) else json.dumps(body).encode("utf-8")

    def read(self):
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class FakeGitHub:
    """ingest.urlopen stand-in: one release per tag, answered from `assets`."""

    def __init__(self):
        self.assets = {
            "pbp": {
                PBP: "sha256:pbp-1",
                # near-misses that a loose name match would pick up (review M3)
                "play_by_play_2026.csv.gz": "sha256:pbp-csv",
                "play_by_play_2026.rds": "sha256:pbp-rds",
                "play_by_play_2026.qs": "sha256:pbp-qs",
                "play_by_play_2025.parquet": "sha256:pbp-2025",
            },
            "weekly_rosters": {ROSTER: "sha256:roster-1", "roster_weekly_2025.parquet": "sha256:roster-2025"},
            "pbp_participation": {"pbp_participation_2025.parquet": "sha256:part-2025"},
        }
        self.fail = {}        # tag -> exception to raise, or an int HTTP status, or a raw body
        self.requests = []

    def __call__(self, request, timeout=None):
        self.requests.append(request)
        tag = request.full_url.rsplit("/", 1)[1]
        failure = self.fail.get(tag)
        if isinstance(failure, BaseException):
            raise failure
        if isinstance(failure, int):
            return FakeResponse(failure, {"message": "nope"})
        if failure is not None:
            return FakeResponse(200, failure)
        body = {"tag_name": tag, "assets": [{"name": n, "digest": d} for n, d in self.assets[tag].items()]}
        return FakeResponse(200, body)


def schedules_frame(home_score=27.0, spread=-3.5):
    """Mimics games.csv: the 11 kept columns plus betting columns ingest drops."""
    return pd.DataFrame([
        {'game_id': '2025_01_KC_BUF', 'season': 2025, 'game_type': 'REG', 'week': 1,
         'gameday': '2025-09-07', 'weekday': 'Sunday', 'gametime': '13:00',
         'home_team': 'BUF', 'away_team': 'KC', 'home_score': 31.0, 'away_score': 20.0,
         'spread_line': 1.5, 'total_line': 47.5},
        {'game_id': '2026_01_KC_BUF', 'season': 2026, 'game_type': 'REG', 'week': 1,
         'gameday': '2026-09-13', 'weekday': 'Sunday', 'gametime': '13:00',
         'home_team': 'BUF', 'away_team': 'KC', 'home_score': home_score, 'away_score': 20.0,
         'spread_line': spread, 'total_line': 47.5},
        {'game_id': '2026_18_SF_LA', 'season': 2026, 'game_type': 'REG', 'week': 18,
         'gameday': '2027-01-03', 'weekday': 'Sunday', 'gametime': None,
         'home_team': 'LA', 'away_team': 'SF', 'home_score': None, 'away_score': None,
         'spread_line': spread, 'total_line': 44.0},
    ])


class Pipeline:
    """process_season / ingest_schedules fakes that report what the real ones report."""

    def __init__(self):
        self.season_calls = []
        self.schedule_calls = []
        self.season_errors = {}      # season -> list of exceptions (consumed per call)
        self.schedule_errors = {}
        self.participation_loaded = True
        self.on_process = None       # hook run inside process_season, before it "commits"

    def process_season(self, season, conn, dry_run=False, **kwargs):
        self.season_calls.append((season, conn, kwargs))
        if self.on_process:
            self.on_process(season)
        queue = self.season_errors.get(season, [])
        if queue:
            raise queue.pop(0)
        return {'participation_loaded': self.participation_loaded, 'rows_sent': 9197, 'through_week': 4}

    def ingest_schedules(self, conn, season, **kwargs):
        self.schedule_calls.append((season, conn, kwargs))
        queue = self.schedule_errors.get(season, [])
        if queue:
            raise queue.pop(0)
        return 272


class Harness:
    def __init__(self, monkeypatch, tmp_path):
        self.monkeypatch = monkeypatch
        self.state_dir = tmp_path / ".ingest-state"
        self.state_path = self.state_dir / "state.json"
        self.marker_path = self.state_dir / "revalidated_at"
        self.output_path = tmp_path / "github_output.txt"
        self.summary_path = tmp_path / "step_summary.md"
        self.now = T0
        self.github = FakeGitHub()
        self.pipeline = Pipeline()
        self.code_hash = "code-1"
        self.schema_hash = "schema-1"
        self.connects = []           # one ScriptedConnect per run
        self.conn_factory = FakeConn
        self.conns = []              # the connections handed to the latest run
        self.sleeps = []

        monkeypatch.setenv("DATABASE_URL", FAKE_URL)   # fake URL; psycopg2.connect is always faked
        monkeypatch.setenv("GH_TOKEN", TOKEN)
        monkeypatch.setenv("GITHUB_OUTPUT", str(self.output_path))
        monkeypatch.setenv("GITHUB_STEP_SUMMARY", str(self.summary_path))
        monkeypatch.setattr(ingest, "urlopen", self.github)
        monkeypatch.setattr(ingest, "_SCHEDULES_CACHE", schedules_frame())
        monkeypatch.setattr(ingest, "_utcnow", lambda: self.now)
        monkeypatch.setattr(ingest, "compute_code_hash", lambda *a, **k: self.code_hash)
        monkeypatch.setattr(ingest, "compute_schema_hash", lambda *a, **k: self.schema_hash, raising=False)
        monkeypatch.setattr(ingest, "process_season", self.pipeline.process_season)
        monkeypatch.setattr(ingest, "ingest_schedules", self.pipeline.ingest_schedules)
        monkeypatch.setattr(ingest.time, "sleep", self.sleeps.append)

    # -- actions --
    def run(self, *extra, season="2026", state=True):
        """One refresh. Returns the number of psycopg2.connect calls it made."""
        for p in (self.output_path, self.summary_path):
            if p.exists():
                p.unlink()
        self.pipeline.season_calls.clear()
        self.pipeline.schedule_calls.clear()
        self.conns = [self.conn_factory(f"run{len(self.connects)}-{i}") for i in range(4)]
        self.sleeps.clear()
        connect = ScriptedConnect(list(self.conns))
        self.connects.append(connect)
        self.monkeypatch.setattr(ingest.psycopg2, "connect", connect)
        argv = ["--all"] if season == "all" else ["--season", season]
        if state:
            argv += ["--state-file", str(self.state_path)]
        ingest.main(argv + list(extra))
        return len(connect.calls)

    def hours_pass(self, hours):
        self.now = self.now + timedelta(hours=hours)

    def mark_revalidated(self):
        """What the workflow's revalidate step does on HTTP 200: date -u +%Y-%m-%dT%H:%M:%SZ"""
        self.marker_path.write_text(self.now.strftime("%Y-%m-%dT%H:%M:%SZ") + "\n", encoding="utf-8")

    # -- observations --
    def state(self):
        return json.loads(self.state_path.read_text(encoding="utf-8"))

    def changed(self):
        lines = [l for l in self.output_path.read_text(encoding="utf-8").splitlines() if l.startswith("changed=")]
        assert len(lines) == 1, lines
        return lines[0].split("=", 1)[1]

    def summary(self):
        return self.summary_path.read_text(encoding="utf-8") if self.summary_path.exists() else ""

    def seasons_processed(self):
        return [c[0] for c in self.pipeline.season_calls]


@pytest.fixture
def h(monkeypatch, tmp_path):
    return Harness(monkeypatch, tmp_path)


@pytest.fixture(autouse=True)
def no_real_network_or_database(monkeypatch):
    """Safety net: a test that forgets to fake these fails instead of going out."""
    def refuse(*a, **k):
        raise AssertionError("test tried to reach the network or a database")
    monkeypatch.setattr(ingest, "urlopen", refuse, raising=False)
    monkeypatch.setattr(ingest.psycopg2, "connect", refuse)
    monkeypatch.setattr(ingest.pd, "read_csv", refuse)
    monkeypatch.setattr(ingest.pd, "read_parquet", refuse)
    monkeypatch.delenv("GITHUB_OUTPUT", raising=False)
    monkeypatch.delenv("GITHUB_STEP_SUMMARY", raising=False)


# --- the release API ------------------------------------------------------------

class TestFetchReleaseAssets:
    def test_returns_name_to_digest_for_every_asset(self, monkeypatch):
        gh = FakeGitHub()
        monkeypatch.setattr(ingest, "urlopen", gh)
        assets = ingest.fetch_release_assets("pbp", token=TOKEN)
        assert assets[PBP] == "sha256:pbp-1"
        assert len(assets) == 5
        req = gh.requests[0]
        assert req.full_url == "https://api.github.com/repos/nflverse/nflverse-data/releases/tags/pbp"
        assert req.get_header("Authorization") == f"Bearer {TOKEN}"

    def test_no_token_sends_no_authorization_header(self, monkeypatch):
        gh = FakeGitHub()
        monkeypatch.setattr(ingest, "urlopen", gh)
        assert ingest.fetch_release_assets("pbp") is not None
        assert gh.requests[0].get_header("Authorization") is None

    @pytest.mark.parametrize("failure", [
        URLError("temporary failure in name resolution"),
        HTTPError("https://api.github.com/x", 403, "rate limit exceeded", {}, io.BytesIO(b"{}")),
        TimeoutError("timed out"),
        403,
        500,
        {"message": "Not Found"},                 # 200 but no assets list
        {"assets": "not-a-list"},
        {"assets": [{"digest": "sha256:x"}]},     # an asset with no name
        b"<html>not json</html>",
    ], ids=["urlerror", "http403", "timeout", "status403", "status500", "no-assets", "assets-not-list",
            "asset-without-name", "not-json"])
    def test_any_doubt_returns_none(self, monkeypatch, failure):
        gh = FakeGitHub()
        gh.fail["pbp"] = failure
        monkeypatch.setattr(ingest, "urlopen", gh)
        assert ingest.fetch_release_assets("pbp", token=TOKEN) is None
        assert len(gh.requests) == 1          # one attempt, no retries

    def test_token_never_logged(self, monkeypatch, caplog):
        gh = FakeGitHub()
        gh.fail["pbp"] = URLError(f"proxy said no to Bearer {TOKEN}")
        monkeypatch.setattr(ingest, "urlopen", gh)
        with caplog.at_level(logging.DEBUG, logger="ingest"):
            assert ingest.fetch_release_assets("pbp", token=TOKEN) is None
        assert caplog.text                    # the failure was logged...
        assert TOKEN not in caplog.text       # ...without the token


class TestAssetFingerprint:
    ASSETS = {
        "play_by_play_2026.csv.gz": "sha256:csv",
        "play_by_play_2026.rds": "sha256:rds",
        "play_by_play_2026.qs": "sha256:qs",
        "games.qs": "sha256:games-qs",
    }

    def test_exact_name_match_only(self):
        # The parquet file is missing; its three siblings must not stand in for it.
        assert ingest.asset_fingerprint(self.ASSETS, PBP) == ingest.ABSENT
        assert ingest.asset_fingerprint(self.ASSETS, "games.csv") == ingest.ABSENT
        with_parquet = dict(self.ASSETS, **{PBP: "sha256:parquet"})
        assert ingest.asset_fingerprint(with_parquet, PBP) == "sha256:parquet"

    def test_asset_without_digest_is_unknown(self):
        assert ingest.asset_fingerprint({PBP: None}, PBP) is None
        assert ingest.asset_fingerprint({PBP: ""}, PBP) is None

    def test_failed_api_call_is_unknown_not_absent(self):
        assert ingest.asset_fingerprint(None, PBP) is None


# --- the schedules fingerprint (review I1) ----------------------------------------

class TestSchedulesFingerprint:
    def fp(self, monkeypatch, frame, season=2026):
        monkeypatch.setattr(ingest, "_SCHEDULES_CACHE", frame)
        return ingest.schedules_fingerprint(season)

    def test_betting_line_change_keeps_the_fingerprint(self, monkeypatch):
        a = self.fp(monkeypatch, schedules_frame(spread=-3.5))
        b = self.fp(monkeypatch, schedules_frame(spread=-6.0))
        assert a == b and len(a) == 64

    def test_score_change_moves_it(self, monkeypatch):
        assert self.fp(monkeypatch, schedules_frame(home_score=27.0)) != self.fp(monkeypatch, schedules_frame(home_score=28.0))

    def test_null_score_filling_in_moves_it(self, monkeypatch):
        assert self.fp(monkeypatch, schedules_frame(home_score=None)) != self.fp(monkeypatch, schedules_frame(home_score=0.0))

    def test_kickoff_time_change_moves_it(self, monkeypatch):
        flexed = schedules_frame()
        flexed.loc[flexed['game_id'] == '2026_18_SF_LA', 'gametime'] = '20:20'
        assert self.fp(monkeypatch, schedules_frame()) != self.fp(monkeypatch, flexed)

    def test_another_seasons_rows_do_not_matter(self, monkeypatch):
        other = schedules_frame()
        other.loc[other['season'] == 2025, 'home_score'] = 99.0
        assert self.fp(monkeypatch, schedules_frame()) == self.fp(monkeypatch, other)
        assert self.fp(monkeypatch, schedules_frame(), 2025) != self.fp(monkeypatch, other, 2025)

    def test_row_order_does_not_matter(self, monkeypatch):
        frame = schedules_frame()
        assert self.fp(monkeypatch, frame) == self.fp(monkeypatch, frame.iloc[::-1].reset_index(drop=True))

    def test_download_failure_is_unknown(self, monkeypatch):
        def boom():
            raise URLError("no route to host")
        monkeypatch.setattr(ingest, "download_schedules", boom)
        assert ingest.schedules_fingerprint(2026) is None

    def test_hashes_exactly_the_rows_ingest_sends(self, monkeypatch):
        """The fingerprint must not be able to drift from what is written."""
        monkeypatch.setattr(ingest, "_SCHEDULES_CACHE", schedules_frame())
        sent = {}
        monkeypatch.setattr(ingest, "execute_values", lambda cur, sql, rows: sent.setdefault("rows", rows))
        ingest.ingest_schedules(FakeConn("c"), 2026)
        assert len(sent["rows"]) == 2
        assert ingest.schedules_fingerprint(2026) == ingest.hash_schedule_rows(sent["rows"])


# --- the code hash (review M4) ----------------------------------------------------

class TestCodeHash:
    def make(self, tmp_path, code="print(1)\n", reqs="pandas==2.2.3\n"):
        (tmp_path / "ingest.py").write_text(code, encoding="utf-8")
        (tmp_path / "requirements.txt").write_text(reqs, encoding="utf-8")
        return ingest.compute_code_hash(script_dir=str(tmp_path))

    def test_stable_for_the_same_inputs(self, tmp_path):
        assert self.make(tmp_path) == self.make(tmp_path)
        assert len(self.make(tmp_path)) == 64

    def test_changes_with_ingest_py(self, tmp_path):
        assert self.make(tmp_path) != self.make(tmp_path, code="print(2)\n")

    def test_changes_with_requirements(self, tmp_path):
        assert self.make(tmp_path) != self.make(tmp_path, reqs="pandas==2.2.4\n")

    def test_changes_with_a_library_version(self, tmp_path, monkeypatch):
        before = self.make(tmp_path)
        real = ingest.importlib_metadata.version
        monkeypatch.setattr(ingest.importlib_metadata, "version",
                            lambda name: "99.0.0" if name == "numpy" else real(name))
        assert self.make(tmp_path) != before

    def test_unreadable_file_is_unknown(self, tmp_path):
        assert ingest.compute_code_hash(script_dir=str(tmp_path / "missing")) is None

    def test_real_files_hash(self):
        value = ingest.compute_code_hash()
        assert isinstance(value, str) and len(value) == 64


# --- the decision -----------------------------------------------------------------

FP = {'code': 'c', 'pbp': 'sha256:p', 'roster': 'sha256:r', 'participation': 'absent', 'schedules': 's'}


def entry(hours_ago=1.0, **overrides):
    e = dict(FP, last_full_run_at=(T0 - timedelta(hours=hours_ago)).strftime("%Y-%m-%dT%H:%M:%SZ"))
    e.update(overrides)
    return e


class TestDecideSeason:
    def test_identical_and_fresh_skips(self):
        assert ingest.decide_season(entry(), dict(FP), T0) == (False, 'sources unchanged')

    @pytest.mark.parametrize("part", ['code', 'pbp', 'roster', 'participation', 'schedules'])
    def test_any_one_part_differing_runs(self, part):
        run, reason = ingest.decide_season(entry(), dict(FP, **{part: 'different'}), T0)
        assert run is True
        assert reason == f"{part} changed"

    @pytest.mark.parametrize("part", ['code', 'pbp', 'roster', 'participation', 'schedules'])
    @pytest.mark.parametrize("bad", [None, ""])
    def test_any_unknown_part_runs(self, part, bad):
        # even if the stored entry holds the same "unknown" value
        run, reason = ingest.decide_season(entry(**{part: bad}), dict(FP, **{part: bad}), T0)
        assert run is True
        assert reason == f"could not read {part}"

    def test_participation_appearing_runs(self):
        run, reason = ingest.decide_season(entry(), dict(FP, participation='sha256:new'), T0)
        assert (run, reason) == (True, 'participation changed')

    def test_force_runs_even_when_identical(self):
        assert ingest.decide_season(entry(), dict(FP), T0, force=True) == (True, 'forced')

    def test_no_entry_runs(self):
        assert ingest.decide_season(None, dict(FP), T0) == (True, 'no stored fingerprint')
        assert ingest.decide_season("garbage", dict(FP), T0) == (True, 'no stored fingerprint')

    def test_state_note_runs(self):
        assert ingest.decide_season(entry(), dict(FP), T0, state_note='state file not found') == (True, 'state file not found')

    @pytest.mark.parametrize("hours,expected", [(19.0, False), (19.99, False), (20.01, True), (21.0, True), (240.0, True)])
    def test_max_skip_age_is_20_hours(self, hours, expected):
        run, reason = ingest.decide_season(entry(hours_ago=hours), dict(FP), T0)
        assert run is expected
        assert reason == ('max skip age' if expected else 'sources unchanged')

    @pytest.mark.parametrize("stamp", [None, "", "yesterday", 12345, "2026-10-07T12:00:00Z"],
                             ids=["missing", "empty", "unparseable", "not-a-string", "in-the-future"])
    def test_doubtful_last_full_run_runs(self, stamp):
        e = entry()
        e['last_full_run_at'] = stamp
        assert ingest.decide_season(e, dict(FP), T0) == (True, 'max skip age')


# --- whole runs through main() ----------------------------------------------------

class TestSkipUnchangedRuns:
    def test_first_run_has_no_state_so_it_runs_and_records(self, h, caplog):
        with caplog.at_level(logging.INFO, logger="ingest"):
            assert h.run() == 1
        assert h.seasons_processed() == [2026]
        assert "state file not found" in caplog.text
        s = h.state()
        assert s['version'] == 1
        assert s['seasons']['2026'] == {
            'code': 'code-1', 'pbp': 'sha256:pbp-1', 'roster': 'sha256:roster-1',
            'participation': 'absent', 'schedules': ingest.schedules_fingerprint(2026),
            'last_full_run_at': '2026-10-06T12:00:00Z',
        }
        assert s['last_change_at'] == '2026-10-06T12:00:00Z'
        assert h.changed() == "true"

    def test_unchanged_sources_never_open_a_database_connection(self, h, caplog):
        h.run()
        h.mark_revalidated()
        h.hours_pass(4)
        before = h.state()
        with caplog.at_level(logging.INFO, logger="ingest"):
            assert h.run() == 0                       # psycopg2.connect not called
        assert h.seasons_processed() == []
        assert h.pipeline.schedule_calls == []
        assert "skipped: sources unchanged (pbp pbp-1, roster roster-1, participation absent, schedules " in caplog.text
        assert h.state() == before                    # a skip writes nothing
        assert h.changed() == "false"

    def test_three_api_calls_per_run_with_the_token(self, h):
        h.run()
        assert sorted(r.full_url.rsplit("/", 1)[1] for r in h.github.requests) == ['pbp', 'pbp_participation', 'weekly_rosters']
        assert all(r.get_header("Authorization") == f"Bearer {TOKEN}" for r in h.github.requests)

    @pytest.mark.parametrize("part", ['code', 'pbp', 'roster', 'participation', 'schedules'])
    def test_any_one_fingerprint_differing_gives_a_full_run(self, h, part, caplog):
        h.run()
        h.mark_revalidated()
        h.hours_pass(4)
        if part == 'code':
            h.code_hash = "code-2"
        elif part == 'pbp':
            h.github.assets['pbp'][PBP] = "sha256:pbp-2"
        elif part == 'roster':
            h.github.assets['weekly_rosters'][ROSTER] = "sha256:roster-2"
        elif part == 'participation':
            h.github.assets['pbp_participation'][PARTICIPATION] = "sha256:part-2026"
        else:
            h.monkeypatch.setattr(ingest, "_SCHEDULES_CACHE", schedules_frame(home_score=30.0))
        with caplog.at_level(logging.INFO, logger="ingest"):
            assert h.run() == 1
        assert h.seasons_processed() == [2026]
        assert [c[0] for c in h.pipeline.schedule_calls] == [2026]
        assert f"{part} changed" in caplog.text
        assert h.changed() == "true"
        assert h.state()['seasons']['2026']['last_full_run_at'] == '2026-10-06T16:00:00Z'

    def test_betting_line_only_change_does_not_connect(self, h):
        h.run()
        h.mark_revalidated()
        h.hours_pass(4)
        h.monkeypatch.setattr(ingest, "_SCHEDULES_CACHE", schedules_frame(spread=-9.5))
        assert h.run() == 0
        assert h.changed() == "false"

    @pytest.mark.parametrize("failure", [URLError("dns"), 403, {"message": "API rate limit exceeded"}],
                             ids=["exception", "http403", "no-assets"])
    @pytest.mark.parametrize("tag", ["pbp", "weekly_rosters", "pbp_participation"])
    def test_api_failure_gives_a_full_run(self, h, tag, failure, caplog):
        h.run()
        h.hours_pass(4)
        h.github.fail[tag] = failure
        with caplog.at_level(logging.INFO, logger="ingest"):
            assert h.run() == 1
        assert h.seasons_processed() == [2026]
        assert "could not read" in caplog.text
        # ...and an unknown fingerprint is never recorded, so the next run is full too
        assert '2026' not in h.state()['seasons']
        del h.github.fail[tag]
        h.hours_pass(4)
        assert h.run() == 1

    def test_asset_without_digest_gives_a_full_run(self, h):
        h.run()
        h.hours_pass(4)
        h.github.assets['pbp'][PBP] = None
        assert h.run() == 1

    def test_schedules_download_failure_gives_a_full_run(self, h):
        h.run()
        h.hours_pass(4)
        def boom():
            raise URLError("no route to host")
        h.monkeypatch.setattr(ingest, "download_schedules", boom)
        assert h.run() == 1
        assert '2026' not in h.state()['seasons']

    def test_older_than_20_hours_gives_a_full_run(self, h, caplog):
        h.run()
        h.hours_pass(19)
        assert h.run() == 0
        h.hours_pass(2)                               # 21 h since the last full run
        with caplog.at_level(logging.INFO, logger="ingest"):
            assert h.run() == 1
        assert "max skip age" in caplog.text
        assert h.state()['seasons']['2026']['last_full_run_at'] == '2026-10-07T09:00:00Z'
        h.hours_pass(4)
        assert h.run() == 0                           # the clock restarted

    def test_force_gives_a_full_run(self, h, caplog):
        h.run()
        h.hours_pass(1)
        with caplog.at_level(logging.INFO, logger="ingest"):
            assert h.run("--force") == 1
        assert h.seasons_processed() == [2026]
        assert "forced" in caplog.text

    @pytest.mark.parametrize("content", ["", "{not json", "[]", '{"version": 99, "seasons": {}}',
                                         '{"version": 1, "seasons": []}', '\x00\x01\x02'],
                             ids=["empty", "broken-json", "list", "wrong-version", "seasons-not-dict", "binary"])
    def test_unreadable_state_gives_a_full_run_and_is_replaced(self, h, content, caplog):
        h.state_dir.mkdir(parents=True)
        h.state_path.write_text(content, encoding="utf-8")
        with caplog.at_level(logging.INFO, logger="ingest"):
            assert h.run() == 1
        assert "state file unreadable" in caplog.text
        assert h.state()['seasons']['2026']['pbp'] == 'sha256:pbp-1'

    def test_state_entry_of_the_wrong_shape_gives_a_full_run(self, h):
        h.state_dir.mkdir(parents=True)
        h.state_path.write_text(json.dumps({"version": 1, "seasons": {"2026": "oops"}}), encoding="utf-8")
        assert h.run() == 1


class TestStateWrittenOnlyAfterCommit:
    def test_nothing_recorded_while_the_season_is_still_running(self, h):
        seen = {}

        def during(season):
            seen['recorded'] = h.state_path.exists() and '2026' in h.state().get('seasons', {})
        h.pipeline.on_process = during
        h.run()
        assert seen == {'recorded': False}
        assert '2026' in h.state()['seasons']

    def test_failed_season_records_nothing(self, h):
        h.pipeline.season_errors[2026] = [ValueError("validate_data: EPA/play out of range")]
        with pytest.raises(ValueError):
            h.run()
        assert not h.state_path.exists() or '2026' not in h.state()['seasons']
        h.hours_pass(4)
        assert h.run() == 1                           # so the next run is a full run

    def test_failed_season_leaves_an_older_entry_alone(self, h):
        h.run()
        before = h.state()['seasons']['2026']
        h.hours_pass(4)
        h.github.assets['pbp'][PBP] = "sha256:pbp-2"
        h.pipeline.season_errors[2026] = [ingest.DataQualityError("truncated file")]
        with pytest.raises(ingest.DataQualityError):
            h.run()
        assert h.state()['seasons']['2026'] == before   # still the old digest: next run runs again
        h.hours_pass(4)
        assert h.run() == 1

    def test_data_not_yet_published_records_nothing(self, h):
        h.pipeline.season_errors[2026] = [ingest.DataNotYetPublished("PBP file for 2026 not on nflverse yet.")]
        assert h.run() == 1
        assert '2026' not in h.state().get('seasons', {})
        h.hours_pass(4)
        assert h.run() == 1

    def test_transient_retry_then_success_records_once(self, h):
        import psycopg2
        h.pipeline.season_errors[2026] = [psycopg2.OperationalError("blip")]
        assert h.run() == 2                           # reconnect for the retry
        assert len(h.pipeline.season_calls) == 2
        assert h.state()['seasons']['2026']['pbp'] == 'sha256:pbp-1'

    def test_participation_listed_but_not_loaded_is_not_recorded(self, h, caplog):
        """Review I4: the API showed a file, the download fell back to none (clobber 404),
        the season committed with NULL routes. Recording the digest would freeze that."""
        h.github.assets['pbp_participation'][PARTICIPATION] = "sha256:part-2026"
        h.pipeline.participation_loaded = False
        with caplog.at_level(logging.INFO, logger="ingest"):
            assert h.run() == 1
        assert '2026' not in h.state()['seasons']
        assert "participation" in caplog.text and "not recorded" in caplog.text
        assert h.changed() == "true"                  # data was still written
        h.hours_pass(4)
        h.pipeline.participation_loaded = True
        assert h.run() == 1                           # heals on the next run
        assert h.state()['seasons']['2026']['participation'] == "sha256:part-2026"

    def test_forced_run_that_loses_participation_removes_the_matching_entry(self, h):
        h.github.assets['pbp_participation'][PARTICIPATION] = "sha256:part-2026"
        h.run()
        assert h.state()['seasons']['2026']['participation'] == "sha256:part-2026"
        h.hours_pass(1)
        h.pipeline.participation_loaded = False
        assert h.run("--force") == 1                  # wrote NULL routes over good ones
        assert '2026' not in h.state()['seasons']     # the older entry must not survive
        h.hours_pass(1)
        assert h.run() == 1

    def test_absent_participation_with_nothing_loaded_is_recorded(self, h):
        h.pipeline.participation_loaded = False       # consistent with "absent"
        h.run()
        assert h.state()['seasons']['2026']['participation'] == 'absent'

    def test_process_season_that_reports_nothing_is_not_recorded(self, h):
        h.monkeypatch.setattr(ingest, "process_season", lambda season, conn, dry_run=False, **k: None)
        assert h.run() == 1
        assert '2026' not in h.state()['seasons']

    def test_failed_schedules_ingest_is_not_recorded(self, h, caplog):
        import psycopg2
        h.run()
        h.hours_pass(4)
        h.github.assets['pbp'][PBP] = "sha256:pbp-2"
        h.pipeline.schedule_errors[2026] = [psycopg2.errors.UniqueViolation("schedules boom")]
        with caplog.at_level(logging.INFO, logger="ingest"):
            assert h.run() == 1
        assert h.seasons_processed() == [2026]        # the season still ran, as today
        assert '2026' not in h.state()['seasons']
        h.hours_pass(4)
        assert h.run() == 1

    def test_state_is_keyed_by_season(self, h):
        h.run()
        entry_2026 = h.state()['seasons']['2026']
        h.github.assets['pbp_participation'].pop("pbp_participation_2025.parquet")
        assert h.run(season="2025") == 1
        s = h.state()
        assert s['seasons']['2026'] == entry_2026
        assert s['seasons']['2025']['pbp'] == 'sha256:pbp-2025'
        h.hours_pass(1)
        assert h.run() == 0
        assert h.run(season="2025") == 0

    def test_all_runs_only_the_seasons_that_changed(self, h, monkeypatch):
        monkeypatch.setattr(ingest, "FIRST_SEASON", 2025)
        monkeypatch.setattr(ingest, "CURRENT_SEASON", 2026)
        assert h.run(season="all") == 1
        assert h.seasons_processed() == [2025, 2026]
        assert len(h.github.requests) == 3            # one call per release, not per season
        h.hours_pass(4)
        h.github.assets['pbp'][PBP] = "sha256:pbp-2"
        assert h.run(season="all") == 1
        assert h.seasons_processed() == [2026]
        h.hours_pass(4)
        assert h.run(season="all") == 0

    def test_earlier_season_is_saved_when_a_later_one_fails(self, h, monkeypatch):
        monkeypatch.setattr(ingest, "FIRST_SEASON", 2025)
        monkeypatch.setattr(ingest, "CURRENT_SEASON", 2026)
        h.pipeline.season_errors[2026] = [KeyError("boom")]
        with pytest.raises(KeyError):
            h.run(season="all")
        assert list(h.state()['seasons']) == ['2025']

    def test_state_write_failure_does_not_fail_the_run(self, h, monkeypatch, caplog):
        def refuse(*a, **k):
            raise OSError("disk full")
        monkeypatch.setattr(ingest.os, "replace", refuse)
        with caplog.at_level(logging.WARNING, logger="ingest"):
            assert h.run() == 1
        assert "state file" in caplog.text
        assert not h.state_path.exists()


class TestRevalidateBookkeeping:
    """Review I3: `changed` stays true until a revalidate succeeded after the last data change."""

    def test_failed_revalidate_is_retried_by_the_next_skipped_run(self, h):
        h.run()
        assert h.changed() == "true"
        # run 1's POST failed: the workflow wrote no marker
        h.hours_pass(4)
        assert h.run() == 0                           # skipped, still no database
        assert h.changed() == "true"                  # ...but the POST is asked for again
        h.mark_revalidated()                          # this time HTTP 200
        h.hours_pass(4)
        assert h.run() == 0
        assert h.changed() == "false"

    def test_marker_older_than_the_last_change_does_not_count(self, h):
        h.run()
        h.mark_revalidated()
        h.hours_pass(4)
        h.github.assets['pbp'][PBP] = "sha256:pbp-2"
        h.run()                                       # new data at 16:00; marker is from 12:00
        h.hours_pass(4)
        assert h.run() == 0
        assert h.changed() == "true"
        h.mark_revalidated()
        h.hours_pass(4)
        assert h.run() == 0
        assert h.changed() == "false"

    def test_marker_written_in_the_same_second_as_the_change_counts(self, h):
        h.run()
        h.mark_revalidated()                          # same virtual second as the commit
        h.hours_pass(4)
        h.run()
        assert h.changed() == "false"

    @pytest.mark.parametrize("content", ["", "garbage", "2026-13-45T99:99:99Z"])
    def test_unparseable_marker_means_changed(self, h, content):
        h.run()
        h.marker_path.write_text(content, encoding="utf-8")
        h.hours_pass(4)
        assert h.run() == 0
        assert h.changed() == "true"

    def test_run_that_only_committed_schedules_is_a_change(self, h):
        h.pipeline.season_errors[2026] = [ingest.DataNotYetPublished("not yet")]
        h.run()
        assert h.changed() == "true"
        assert h.state()['last_change_at'] == '2026-10-06T12:00:00Z'

    def test_no_state_file_writes_no_output(self, h):
        assert h.run(state=False) == 1
        assert not h.output_path.exists()             # the workflow treats a missing output as changed


class TestStepSummary:
    def test_full_run_names_the_reason_and_rows_sent(self, h):
        h.run()
        assert h.summary().strip() == "2026: full run (state file not found): 9,469 rows sent"

    def test_skipped_run(self, h):
        h.run()
        h.hours_pass(4)
        h.run()
        assert h.summary().strip() == "2026: skipped: sources unchanged"

    def test_forced_run(self, h):
        h.run()
        h.hours_pass(1)
        h.run("--force")
        assert h.summary().strip() == "2026: full run (forced): 9,469 rows sent"

    def test_max_skip_age_run(self, h):
        h.run()
        h.hours_pass(21)
        h.run()
        assert h.summary().strip() == "2026: full run (max skip age): 9,469 rows sent"

    def test_not_yet_published(self, h):
        h.pipeline.season_errors[2026] = [ingest.DataNotYetPublished("not yet")]
        h.run()
        assert h.summary().strip() == "2026: full run (state file not found): not yet published, 272 rows sent"

    def test_failed_run_still_gets_a_line(self, h):
        h.pipeline.season_errors[2026] = [KeyError("boom")]
        with pytest.raises(KeyError):
            h.run()
        assert h.summary().strip() == "2026: FAILED (state file not found)"

    def test_one_line_per_season(self, h, monkeypatch):
        monkeypatch.setattr(ingest, "FIRST_SEASON", 2025)
        monkeypatch.setattr(ingest, "CURRENT_SEASON", 2026)
        h.run(season="all")
        h.hours_pass(4)
        h.github.assets['pbp'][PBP] = "sha256:pbp-2"
        h.run(season="all")
        assert h.summary().splitlines() == [
            "2025: skipped: sources unchanged",
            "2026: full run (pbp changed): 9,469 rows sent",
        ]


class TestSecretsAndModes:
    def test_token_and_database_url_never_logged(self, h, caplog):
        h.github.fail['pbp'] = URLError("dns")
        with caplog.at_level(logging.DEBUG, logger="ingest"):
            h.run()
            h.hours_pass(4)
            h.run()
        assert TOKEN not in caplog.text
        assert "hunter2" not in caplog.text
        assert TOKEN not in h.state_path.read_text(encoding="utf-8")

    def test_dry_run_reads_and_writes_no_state_and_calls_no_api(self, h):
        assert h.run("--dry-run") == 0
        assert h.github.requests == []
        assert not h.state_dir.exists()
        assert h.seasons_processed() == [2026]

    def test_without_a_state_file_nothing_changes(self, h):
        """Local runs and seed.yml: no API call, no state, a full run every time."""
        assert h.run(state=False) == 1
        assert h.run(state=False) == 1
        assert h.github.requests == []
        assert not h.state_dir.exists()
        # call for call as before this change: no extra keyword arguments
        assert h.pipeline.season_calls[-1][2] == {}
        assert h.pipeline.schedule_calls[-1][2] == {}

    def test_missing_database_url_still_exits_1(self, h, monkeypatch):
        monkeypatch.delenv("DATABASE_URL")
        with pytest.raises(SystemExit) as exc:
            h.run()
        assert exc.value.code == 1


class TestStateFileIo:
    def test_save_is_atomic_and_leaves_no_temp_file(self, h):
        h.run()
        assert sorted(p.name for p in h.state_dir.iterdir()) == ['state.json']

    def test_creates_the_state_directory(self, h):
        assert not h.state_dir.exists()
        h.run()
        assert h.state_path.exists()

