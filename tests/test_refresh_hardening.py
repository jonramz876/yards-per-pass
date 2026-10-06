"""Refresh IO: fixes from the chaos test of PR A + PR C (2026-10-06).

CRASH-1       a state file that cannot be loaded for ANY reason means a full run, never a crash
WRONG-SKIP-1  the stored entry is dropped as soon as an attempt starts writing
WRONG-SKIP-2  a file that was really loaded is never recorded as "absent"
RISK-6        the recorded digest is the sha256 of the bytes actually downloaded, and
              must equal what the release API listed before the run
NOTE-9        seasons never attempted are not reported as FAILED

No network and no database (see test_refresh_io.py for the harness).
"""
import hashlib
import io
import json
import logging
from urllib.error import HTTPError, URLError

import pandas as pd
import psycopg2
import pytest

import ingest
from test_refresh_io import (  # noqa: F401  (h and the autouse safety net are fixtures)
    PARTICIPATION, PBP, ROSTER, Harness, h, no_real_network_or_database, schedules_frame,
)
from test_refresh_ddl import REAL_INGEST_SCHEDULES, REAL_PROCESS_SEASON, RealPipeline, RecordingConn

REAL_READ_PARQUET = pd.read_parquet
REAL_DOWNLOAD_PBP = ingest.download_pbp
REAL_DOWNLOAD_ROSTER = ingest.download_roster
REAL_DOWNLOAD_PARTICIPATION = ingest.download_participation

DEEP = '[' * 200000 + ']' * 200000


def set_schedule(h, **kwargs):
    h.monkeypatch.setattr(ingest, "_SCHEDULES_CACHE", schedules_frame(**kwargs))


# --- CRASH-1 ----------------------------------------------------------------------

class TestStateFileCanNeverCrashTheRun:
    @pytest.mark.parametrize("content", [DEEP, '{"version": 1, "seasons": {"2026": ' + DEEP + '}}'],
                             ids=["nested-list", "nested-inside-valid-shape"])
    def test_deeply_nested_json_is_a_full_run(self, h, content, caplog):
        h.state_dir.mkdir(parents=True)
        h.state_path.write_text(content, encoding="utf-8")
        with caplog.at_level(logging.INFO, logger="ingest"):
            assert h.run() == 1
        assert h.seasons_processed() == [2026]
        assert "state file unreadable" in caplog.text
        assert h.state()['seasons']['2026']['pbp'] == 'sha256:pbp-1'   # replaced by a good one
        assert h.summary().strip() == "2026: full run (state file unreadable): 9,469 rows sent"

    @pytest.mark.parametrize("error", [RecursionError("maximum recursion depth exceeded"), MemoryError(),
                                       RuntimeError("anything at all")])
    def test_load_state_fails_open_on_any_exception(self, tmp_path, monkeypatch, error):
        path = tmp_path / "state.json"
        path.write_text("{}", encoding="utf-8")

        def boom(*a, **k):
            raise error
        monkeypatch.setattr(ingest.json, "load", boom)
        assert ingest._load_state(str(path)) == ({}, 'state file unreadable')

    def test_unreadable_state_file_is_removed_at_once(self, h):
        """Otherwise a run that commits nothing leaves it for the workflow's Save step,
        which would re-save the bad file under a new key on every run."""
        h.state_dir.mkdir(parents=True)
        h.state_path.write_text(DEEP, encoding="utf-8")
        h.pipeline.schedule_errors[2026] = [psycopg2.OperationalError("schedules blip")]
        h.pipeline.season_errors[2026] = [KeyError("boom before any commit")]
        with pytest.raises(KeyError):
            h.run()
        assert not h.state_path.exists()

    def test_tracker_that_cannot_be_built_means_a_plain_full_run(self, h, monkeypatch, caplog):
        def boom(*a, **k):
            raise RuntimeError("tracker exploded")
        monkeypatch.setattr(ingest, "RefreshTracker", boom)
        h.state_dir.mkdir(parents=True)
        h.state_path.write_text("{}", encoding="utf-8")
        with caplog.at_level(logging.WARNING, logger="ingest"):
            assert h.run() == 1
        assert h.seasons_processed() == [2026]
        assert h.pipeline.season_calls[-1][2] == {}          # schema steps on
        assert "tracker exploded" in caplog.text
        assert not h.state_path.exists()                     # nothing left to re-save

    def test_fingerprinting_that_raises_means_a_full_run(self, h, monkeypatch):
        def boom(*a, **k):
            raise RecursionError("fingerprint exploded")
        monkeypatch.setattr(ingest, "collect_fingerprint", boom)
        assert h.run() == 1
        assert h.seasons_processed() == [2026]
        assert '2026' not in h.state()['seasons']            # an unknown fingerprint is never recorded
        assert h.summary().strip().startswith("2026: full run (state file not found)")

    def test_save_fails_open_on_any_exception(self, h, monkeypatch, caplog):
        def boom(*a, **k):
            raise RecursionError("dump exploded")
        monkeypatch.setattr(ingest.json, "dump", boom)
        with caplog.at_level(logging.WARNING, logger="ingest"):
            assert h.run() == 1
        assert not h.state_path.exists()
        assert "state file" in caplog.text


# --- WRONG-SKIP-1 -------------------------------------------------------------------

class TestEntryDroppedOnceAnAttemptStarts:
    def test_schedule_a_b_a_around_a_failed_season_is_not_skipped(self, h):
        """Run 1 stores schedule A. Run 2 sees B, the schedules upsert commits, the season
        fails. nflverse puts the schedule back to A. Run 3 must NOT match the stored A:
        the games table holds B."""
        h.run()
        h.mark_revalidated()
        h.hours_pass(4)
        set_schedule(h, home_score=30.0)                     # B
        h.pipeline.season_errors[2026] = [KeyError("season blew up")]
        with pytest.raises(KeyError):
            h.run()
        assert len(h.pipeline.schedule_calls) == 1
        assert '2026' not in h.state()['seasons']
        h.hours_pass(4)
        set_schedule(h, home_score=27.0)                     # back to A
        assert h.run() == 1
        assert h.seasons_processed() == [2026]
        assert h.state()['seasons']['2026']['schedules'] == ingest.schedules_fingerprint(2026)

    def test_same_with_a_transient_give_up(self, h):
        h.run()
        h.hours_pass(4)
        set_schedule(h, home_score=30.0)
        h.pipeline.season_errors[2026] = [psycopg2.OperationalError(x) for x in "abc"]
        with pytest.raises(psycopg2.OperationalError):
            h.run()
        h.hours_pass(4)
        set_schedule(h, home_score=27.0)
        assert h.run() == 1
        assert h.seasons_processed() == [2026]

    def test_entry_is_dropped_before_the_first_write_even_if_nothing_commits(self, h):
        """Covers "commit succeeded, process died before the state write": the entry is
        gone from disk before the attempt writes anything."""
        h.run()
        h.hours_pass(1)
        seen = {}

        def during_schedules(conn, season, **k):
            seen['entry_on_disk'] = '2026' in h.state()['seasons']
            raise psycopg2.OperationalError("schedules blip")
        h.monkeypatch.setattr(ingest, "ingest_schedules", during_schedules)
        h.pipeline.season_errors[2026] = [KeyError("boom")]
        with pytest.raises(KeyError):
            h.run("--force")
        assert seen == {'entry_on_disk': False}
        assert '2026' not in h.state()['seasons']

    def test_success_puts_the_entry_back(self, h):
        h.run()
        h.hours_pass(4)
        h.github.assets['pbp'][PBP] = "sha256:pbp-2"
        h.run()
        assert h.state()['seasons']['2026']['pbp'] == "sha256:pbp-2"
        h.hours_pass(4)
        assert h.run() == 0

    def test_skipped_and_never_attempted_seasons_keep_their_entries(self, h, monkeypatch):
        monkeypatch.setattr(ingest, "FIRST_SEASON", 2024)
        monkeypatch.setattr(ingest, "CURRENT_SEASON", 2026)
        h.github.assets['pbp']["play_by_play_2024.parquet"] = "sha256:pbp-2024"
        h.github.assets['weekly_rosters']["roster_weekly_2024.parquet"] = "sha256:roster-2024"
        h.run(season="all")
        before = h.state()['seasons']
        h.hours_pass(4)
        # 2024 unchanged (skipped), 2025 changed and fails, 2026 changed but never reached
        h.github.assets['pbp']["play_by_play_2025.parquet"] = "sha256:pbp-2025b"
        h.github.assets['pbp'][PBP] = "sha256:pbp-2"
        h.pipeline.season_errors[2025] = [KeyError("boom")]
        with pytest.raises(KeyError):
            h.run(season="all")
        after = h.state()['seasons']
        assert after['2024'] == before['2024']
        assert '2025' not in after
        assert after['2026'] == before['2026']               # old digest: the next run runs it
        assert h.summary().splitlines() == [
            "2024: skipped: sources unchanged",
            "2025: FAILED (pbp changed)",
            "2026: not attempted (pbp changed)",             # NOTE-9: not "FAILED"
        ]


# --- WRONG-SKIP-2 and RISK-6 ----------------------------------------------------------

class TestOnlyWhatWasReallyDownloadedIsRecorded:
    @pytest.mark.parametrize("tag,name", [("pbp", PBP), ("weekly_rosters", ROSTER)], ids=["pbp", "roster"])
    def test_file_missing_from_the_listing_but_loaded_is_never_recorded_absent(self, h, tag, name, caplog):
        del h.github.assets[tag][name]
        with caplog.at_level(logging.INFO, logger="ingest"):
            assert h.run() == 1
        assert '2026' not in h.state()['seasons']
        assert "not recorded" in caplog.text
        h.hours_pass(4)
        assert h.run() == 1                                  # same listing: still a full run
        assert h.seasons_processed() == [2026]

    def test_empty_listings_everywhere_never_skip(self, h):
        for tag in h.github.assets:
            h.github.assets[tag] = {}
        h.run()
        assert '2026' not in h.state()['seasons']
        h.hours_pass(4)
        assert h.run() == 1

    def test_participation_absent_in_the_listing_but_loaded_is_not_recorded(self, h):
        h.pipeline.participation_loaded = True               # the download worked anyway
        h.pipeline.downloaded['participation'] = "sha256:part-real"
        h.run()
        assert '2026' not in h.state()['seasons']
        h.hours_pass(4)
        assert h.run() == 1

    @pytest.mark.parametrize("part", ["pbp", "roster", "participation"])
    def test_listing_ahead_of_the_download_is_not_recorded(self, h, part):
        """The API already lists the new digest while the download still served the old
        bytes: recording the listed digest would freeze old data until the 20 h rule."""
        h.github.assets['pbp_participation'][PARTICIPATION] = "sha256:part-1"
        h.run()
        h.hours_pass(4)
        tag, name = {"pbp": ("pbp", PBP), "roster": ("weekly_rosters", ROSTER),
                     "participation": ("pbp_participation", PARTICIPATION)}[part]
        old = h.github.assets[tag][name]
        h.github.assets[tag][name] = f"sha256:{part}-NEW"   # listed: new
        h.pipeline.downloaded[part] = old                    # served: still the old bytes
        assert h.run() == 1
        assert '2026' not in h.state()['seasons']
        h.hours_pass(4)
        del h.pipeline.downloaded[part]                      # the download caught up
        assert h.run() == 1
        assert h.state()['seasons']['2026'][part] == f"sha256:{part}-NEW"
        h.hours_pass(4)
        assert h.run() == 0

    @pytest.mark.parametrize("part", ["pbp", "roster", "participation"])
    def test_download_ahead_of_the_listing_is_not_recorded(self, h, part):
        """Re-upload between the digest read and the download: newer bytes than listed."""
        h.github.assets['pbp_participation'][PARTICIPATION] = "sha256:part-1"
        h.pipeline.downloaded[part] = f"sha256:{part}-NEW"
        assert h.run() == 1
        assert '2026' not in h.state()['seasons']
        h.hours_pass(4)
        tag, name = {"pbp": ("pbp", PBP), "roster": ("weekly_rosters", ROSTER),
                     "participation": ("pbp_participation", PARTICIPATION)}[part]
        h.github.assets[tag][name] = f"sha256:{part}-NEW"   # the listing caught up
        assert h.run() == 1
        assert h.state()['seasons']['2026'][part] == f"sha256:{part}-NEW"

    @pytest.mark.parametrize("digests", [None, {}, {'pbp': None, 'roster': None}, "garbage"],
                             ids=["missing", "empty", "nones", "wrong-type"])
    def test_run_that_cannot_say_what_it_downloaded_is_not_recorded(self, h, digests):
        def process(season, conn, dry_run=False, **k):
            h.pipeline.season_calls.append((season, conn, k))
            result = {'participation_loaded': False, 'rows_sent': 1, 'through_week': 4}
            if digests is not None:
                result['source_digests'] = digests
            return result
        h.monkeypatch.setattr(ingest, "process_season", process)
        assert h.run() == 1
        assert '2026' not in h.state()['seasons']
        assert h.changed() == "true"

    def test_matching_downloads_are_recorded_as_before(self, h):
        h.github.assets['pbp_participation'][PARTICIPATION] = "sha256:part-1"
        h.run()
        e = h.state()['seasons']['2026']
        assert (e['pbp'], e['roster'], e['participation']) == ('sha256:pbp-1', 'sha256:roster-1', 'sha256:part-1')


# --- the download helper that hashes what it reads --------------------------------------

def parquet_bytes(frame):
    buf = io.BytesIO()
    frame.to_parquet(buf)
    return buf.getvalue()


def sha(data):
    return "sha256:" + hashlib.sha256(data).hexdigest()


class FakeDownload:
    def __init__(self, data):
        self._data = data

    def read(self):
        return self._data

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class FakeWeb:
    """ingest.urlopen stand-in serving both the release API (Request objects, via the
    harness's FakeGitHub) and file downloads (plain URL strings)."""

    def __init__(self, github):
        self.github = github
        self.files = {}          # url -> bytes, or an exception to raise
        self.downloads = []

    def __call__(self, target, timeout=None):
        if not isinstance(target, str):
            return self.github(target, timeout=timeout)
        self.downloads.append(target)
        item = self.files.get(target, HTTPError(target, 404, "Not Found", {}, io.BytesIO(b"")))
        if isinstance(item, BaseException):
            raise item
        return FakeDownload(item)


@pytest.fixture
def web(h, monkeypatch):
    w = FakeWeb(h.github)
    monkeypatch.setattr(ingest, "urlopen", w)
    monkeypatch.setattr(ingest.pd, "read_parquet", REAL_READ_PARQUET)   # reads BytesIO only here
    monkeypatch.setattr(ingest, "_DOWNLOAD_DIGESTS", {}, raising=False)
    monkeypatch.setattr(ingest, "CURRENT_SEASON", 2026)
    return w


URL = "https://example.invalid/some.parquet"


class TestReadParquetRecordingDigest:
    def test_returns_the_frame_and_remembers_the_sha256_of_the_bytes(self, web):
        frame = pd.DataFrame({'a': [1, 2, 3], 'b': ['x', 'y', 'z']})
        data = parquet_bytes(frame)
        web.files[URL] = data
        out = ingest._read_parquet_url(URL)
        pd.testing.assert_frame_equal(out, frame)
        assert ingest._DOWNLOAD_DIGESTS[URL] == sha(data)
        assert web.downloads == [URL]                        # one download, hashed and parsed

    def test_failed_download_forgets_any_older_digest(self, web):
        web.files[URL] = parquet_bytes(pd.DataFrame({'a': [1]}))
        ingest._read_parquet_url(URL)
        web.files[URL] = URLError("connection reset")
        with pytest.raises(URLError):
            ingest._read_parquet_url(URL)
        assert URL not in ingest._DOWNLOAD_DIGESTS

    def test_bytes_that_are_not_parquet_leave_no_digest(self, web):
        web.files[URL] = b"<html>rate limited</html>"
        with pytest.raises(Exception):
            ingest._read_parquet_url(URL)
        assert URL not in ingest._DOWNLOAD_DIGESTS

    def test_404_is_still_an_http_error_so_not_yet_published_still_works(self, web, monkeypatch):
        monkeypatch.setattr(ingest.time, "sleep", lambda s: None)
        with pytest.raises(ingest.DataNotYetPublished):
            REAL_DOWNLOAD_PBP(2026)                          # nothing served: 404
        with pytest.raises(ingest.DataNotYetPublished):
            REAL_DOWNLOAD_ROSTER(2026)
        assert REAL_DOWNLOAD_PARTICIPATION(2026) is None
        assert ingest._DOWNLOAD_DIGESTS == {}

    def test_historical_404_is_still_a_real_failure(self, web, monkeypatch):
        monkeypatch.setattr(ingest.time, "sleep", lambda s: None)
        with pytest.raises(HTTPError):
            REAL_DOWNLOAD_PBP(2021)


def source_files(web, h, pbp_rows=1, list_them=True):
    """Serve three real parquet files for 2026 and (optionally) list their true digests."""
    pbp = pd.DataFrame({c: [1.0] * pbp_rows for c in ingest.REQUIRED_PBP_COLS})
    roster = pd.DataFrame({'gsis_id': [f"00-{i:07d}" for i in range(120)], 'position': ['QB'] * 120})
    part = pd.DataFrame({'nflverse_game_id': ['2026_01_KC_BUF'] * 1200, 'play_id': range(1200)})
    files = {
        'pbp': (ingest.PBP_URL.format(season=2026), parquet_bytes(pbp)),
        'roster': (ingest.ROSTER_URL.format(season=2026), parquet_bytes(roster)),
        'participation': (ingest.PARTICIPATION_URL.format(season=2026), parquet_bytes(part)),
    }
    for part_name, (url, data) in files.items():
        web.files[url] = data
    if list_them:
        h.github.assets['pbp'][PBP] = sha(files['pbp'][1])
        h.github.assets['weekly_rosters'][ROSTER] = sha(files['roster'][1])
        h.github.assets['pbp_participation'][PARTICIPATION] = sha(files['participation'][1])
    return files


class TestEndToEndWithRealDownloads:
    """Real download_* functions, real process_season and run_seasons; only the
    aggregation, upserts and the network are faked."""

    @pytest.fixture
    def real(self, h, web, monkeypatch):
        r = RealPipeline(h, monkeypatch)
        monkeypatch.setattr(ingest, "_DOWNLOAD_DIGESTS", {})
        monkeypatch.setattr(ingest, "download_pbp", REAL_DOWNLOAD_PBP)
        monkeypatch.setattr(ingest, "download_roster", REAL_DOWNLOAD_ROSTER)
        monkeypatch.setattr(ingest, "download_participation", REAL_DOWNLOAD_PARTICIPATION)
        return r

    def test_process_season_reports_the_digest_of_each_file_it_loaded(self, h, web, real):
        files = source_files(web, h)
        result = ingest.process_season(2026, RecordingConn())
        assert result['participation_loaded'] is True
        assert result['source_digests'] == {part: sha(data) for part, (url, data) in files.items()}

    def test_participation_that_failed_to_load_reports_no_digest(self, h, web, real):
        files = source_files(web, h)
        web.files[files['participation'][0]] = HTTPError("u", 404, "Not Found", {}, io.BytesIO(b""))
        result = ingest.process_season(2026, RecordingConn())
        assert result['participation_loaded'] is False
        assert result['source_digests']['participation'] is None
        assert result['source_digests']['pbp'] == sha(files['pbp'][1])

    def test_matching_bytes_are_recorded_and_the_next_run_skips(self, h, web, real):
        files = source_files(web, h)
        assert h.run() == 1
        entry = h.state()['seasons']['2026']
        assert entry['pbp'] == sha(files['pbp'][1])
        assert entry['participation'] == sha(files['participation'][1])
        h.hours_pass(4)
        assert h.run() == 0
        assert len(web.downloads) == 3                       # the skipped run downloaded nothing

    def test_bytes_that_differ_from_the_listing_are_not_recorded(self, h, web, real, caplog):
        files = source_files(web, h)
        h.github.assets['pbp'][PBP] = "sha256:" + "0" * 64   # the API lists some other upload
        with caplog.at_level(logging.INFO, logger="ingest"):
            assert h.run() == 1
        assert '2026' not in h.state()['seasons']
        assert "pbp" in caplog.text and "not recorded" in caplog.text
        h.hours_pass(4)
        h.github.assets['pbp'][PBP] = sha(files['pbp'][1])
        assert h.run() == 1
        assert h.state()['seasons']['2026']['pbp'] == sha(files['pbp'][1])

    def test_participation_404_during_a_re_upload_is_not_recorded(self, h, web, real):
        """Review I4, now with the real download path."""
        files = source_files(web, h)
        web.files[files['participation'][0]] = HTTPError("u", 404, "Not Found", {}, io.BytesIO(b""))
        assert h.run() == 1
        assert '2026' not in h.state()['seasons']


# --- NOTE-9 -----------------------------------------------------------------------------

class TestSummaryOfAFailedRun:
    def test_connect_failure_is_reported_as_failed_not_as_not_attempted(self, h, monkeypatch):
        """No season started because the database could not be reached: the first season
        that was due is the failure; only the ones behind it were "not attempted"."""
        monkeypatch.setattr(ingest, "FIRST_SEASON", 2025)
        monkeypatch.setattr(ingest, "CURRENT_SEASON", 2026)

        def run_seasons(*a, **k):
            raise psycopg2.OperationalError("could not connect")
        monkeypatch.setattr(ingest, "run_seasons", run_seasons)
        with pytest.raises(psycopg2.OperationalError):
            h.run(season="all")
        assert h.summary().splitlines() == [
            "2025: FAILED (state file not found)",
            "2026: not attempted (state file not found)",
        ]
        assert h.changed() == "true"
