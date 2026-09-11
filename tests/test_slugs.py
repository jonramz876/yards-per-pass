"""Tests for slug generation and collision handling."""
import sys
import os

import pandas as pd

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripts'))


class TestMakeSlug:
    """make_slug converts player names to URL-friendly slugs."""

    def test_basic_name(self):
        from ingest import make_slug
        assert make_slug("Patrick Mahomes") == "patrick-mahomes"

    def test_apostrophe(self):
        from ingest import make_slug
        assert make_slug("Ja'Marr Chase") == "jamarr-chase"

    def test_period(self):
        from ingest import make_slug
        assert make_slug("T.J. Watt") == "tj-watt"

    def test_suffix(self):
        from ingest import make_slug
        assert make_slug("Marvin Harrison Jr.") == "marvin-harrison-jr"

    def test_hyphenated(self):
        from ingest import make_slug
        assert make_slug("Amon-Ra St. Brown") == "amon-ra-st-brown"

    def test_extra_spaces(self):
        from ingest import make_slug
        assert make_slug("  Josh   Allen  ") == "josh-allen"


def _make_qb_df(players):
    """Build a minimal qb_stats DataFrame for slug generation tests.

    players: list of (player_id, player_name, team_id)
    """
    rows = [{'player_id': pid, 'player_name': name, 'team_id': team,
             'season': 2025, 'games': 1} for pid, name, team in players]
    return pd.DataFrame(rows)


def _empty_df():
    """Empty DataFrame with expected columns."""
    return pd.DataFrame(columns=['player_id', 'player_name', 'team_id'])


def _make_roster(players):
    """Build minimal roster: list of (gsis_id, position)."""
    return pd.DataFrame([{'gsis_id': pid, 'position': pos} for pid, pos in players])


class TestGeneratePlayerSlugs:
    """generate_player_slugs assigns slugs and handles collisions."""

    def test_single_player_clean_slug(self):
        from ingest import generate_player_slugs
        qb = _make_qb_df([('QB1', 'Patrick Mahomes', 'KC')])
        roster = _make_roster([('QB1', 'QB')])
        result = generate_player_slugs(qb, _empty_df(), _empty_df(), roster, conn=None)
        assert len(result) == 1
        row = result.iloc[0]
        assert row['slug'] == 'patrick-mahomes'
        assert row['player_name'] == 'Patrick Mahomes'
        assert row['position'] == 'QB'
        assert row['current_team_id'] == 'KC'

    def test_collision_disambiguated_by_team(self):
        from ingest import generate_player_slugs
        qb = _make_qb_df([
            ('QB_BUF', 'Josh Allen', 'BUF'),
            ('QB_JAX', 'Josh Allen', 'JAX'),
        ])
        roster = _make_roster([('QB_BUF', 'QB'), ('QB_JAX', 'QB')])
        result = generate_player_slugs(qb, _empty_df(), _empty_df(), roster, conn=None)
        slugs = set(result['slug'].tolist())
        assert 'josh-allen-buf' in slugs
        assert 'josh-allen-jax' in slugs
        assert len(slugs) == 2  # unique slugs

    def test_no_collision_across_dataframes(self):
        """Players from different stat DFs with unique names get clean slugs."""
        from ingest import generate_player_slugs
        qb = _make_qb_df([('QB1', 'Patrick Mahomes', 'KC')])
        rec = _make_qb_df([('WR1', 'Tyreek Hill', 'MIA')])
        rb = _make_qb_df([('RB1', 'Derrick Henry', 'BAL')])
        roster = _make_roster([('QB1', 'QB'), ('WR1', 'WR'), ('RB1', 'RB')])
        result = generate_player_slugs(qb, rec, rb, roster, conn=None)
        assert len(result) == 3
        slugs = set(result['slug'].tolist())
        assert 'patrick-mahomes' in slugs
        assert 'tyreek-hill' in slugs
        assert 'derrick-henry' in slugs

    def test_empty_input_returns_empty(self):
        from ingest import generate_player_slugs
        result = generate_player_slugs(_empty_df(), _empty_df(), _empty_df(), _empty_df(), conn=None)
        assert len(result) == 0

    def test_dedup_across_dataframes(self):
        """Same player_id in multiple DFs only appears once."""
        from ingest import generate_player_slugs
        qb = _make_qb_df([('QB1', 'Patrick Mahomes', 'KC')])
        # Same player_id appears as a "rusher" too
        rb = _make_qb_df([('QB1', 'Patrick Mahomes', 'KC')])
        roster = _make_roster([('QB1', 'QB')])
        result = generate_player_slugs(qb, _empty_df(), rb, roster, conn=None)
        assert len(result) == 1
        assert result.iloc[0]['slug'] == 'patrick-mahomes'


def _roster_with_headshots():
    """Roster carrying headshot/jersey columns. 00-001 appears in two weeks
    with different values; week 2 (the latest) must win."""
    return pd.DataFrame([
        {'gsis_id': '00-001', 'position': 'QB', 'full_name': 'Josh Allen',
         'week': 1, 'jersey_number': 10, 'headshot_url': 'https://img/old.png'},
        {'gsis_id': '00-001', 'position': 'QB', 'full_name': 'Josh Allen',
         'week': 2, 'jersey_number': 17, 'headshot_url': 'https://img/new.png'},
        {'gsis_id': '00-002', 'position': 'WR', 'full_name': 'No Photo Guy',
         'week': 2, 'jersey_number': None, 'headshot_url': None},
    ])


class TestSlugHeadshotAndJersey:
    """generate_player_slugs carries headshot_url + jersey_number from the roster."""

    def test_slugs_carry_headshot_and_jersey(self):
        from ingest import generate_player_slugs
        qb = _make_qb_df([('00-001', 'J.Allen', 'BUF')])
        result = generate_player_slugs(qb, _empty_df(), _empty_df(),
                                       _roster_with_headshots(), conn=None)
        row = result[result['player_id'] == '00-001'].iloc[0]
        assert row['headshot_url'] == 'https://img/new.png'  # latest week wins
        assert row['jersey_number'] == 17

    def test_latest_week_wins_regardless_of_row_order(self):
        """Sorting by week, not row order, decides the winning value."""
        from ingest import generate_player_slugs
        roster = _roster_with_headshots().iloc[::-1].reset_index(drop=True)
        qb = _make_qb_df([('00-001', 'J.Allen', 'BUF')])
        result = generate_player_slugs(qb, _empty_df(), _empty_df(), roster, conn=None)
        row = result[result['player_id'] == '00-001'].iloc[0]
        assert row['headshot_url'] == 'https://img/new.png'
        assert row['jersey_number'] == 17

    def test_null_headshot_and_jersey_become_none(self):
        from ingest import generate_player_slugs
        qb = _make_qb_df([('00-002', 'N.Guy', 'SEA')])
        result = generate_player_slugs(qb, _empty_df(), _empty_df(),
                                       _roster_with_headshots(), conn=None)
        row = result[result['player_id'] == '00-002'].iloc[0]
        assert row['headshot_url'] is None
        assert row['jersey_number'] is None

    def test_slugs_tolerate_missing_headshot_columns(self):
        """Roster parquet without the columns must not raise."""
        from ingest import generate_player_slugs
        roster = _roster_with_headshots().drop(columns=['headshot_url', 'jersey_number'])
        qb = _make_qb_df([('00-001', 'J.Allen', 'BUF')])
        result = generate_player_slugs(qb, _empty_df(), _empty_df(), roster, conn=None)
        assert 'headshot_url' in result.columns
        assert 'jersey_number' in result.columns
        assert result['headshot_url'].isna().all()
        assert result['jersey_number'].isna().all()

    def test_roster_without_week_column_still_works(self):
        """Older roster frames have no week column — must not raise on sort."""
        from ingest import generate_player_slugs
        roster = _roster_with_headshots().drop(columns=['week']).iloc[:1]
        qb = _make_qb_df([('00-001', 'J.Allen', 'BUF')])
        result = generate_player_slugs(qb, _empty_df(), _empty_df(), roster, conn=None)
        row = result[result['player_id'] == '00-001'].iloc[0]
        assert row['headshot_url'] == 'https://img/old.png'
        assert row['jersey_number'] == 10

    def test_row_with_null_week_loses_to_a_real_week(self):
        from ingest import generate_player_slugs
        roster = _roster_with_headshots()
        roster.loc[len(roster)] = {'gsis_id': '00-001', 'position': 'QB',
                                   'full_name': 'Josh Allen', 'week': None,
                                   'jersey_number': 99,
                                   'headshot_url': 'https://img/unknown.png'}
        qb = _make_qb_df([('00-001', 'J.Allen', 'BUF')])
        result = generate_player_slugs(qb, _empty_df(), _empty_df(), roster, conn=None)
        row = result[result['player_id'] == '00-001'].iloc[0]
        assert row['jersey_number'] == 17
        assert row['headshot_url'] == 'https://img/new.png'

    def test_unparseable_jersey_is_skipped_not_fatal(self):
        """A junk jersey value must not crash the ingest."""
        from ingest import generate_player_slugs
        roster = _roster_with_headshots()
        roster['jersey_number'] = roster['jersey_number'].astype(object)
        roster.loc[1, 'jersey_number'] = 'N/A'
        qb = _make_qb_df([('00-001', 'J.Allen', 'BUF')])
        result = generate_player_slugs(qb, _empty_df(), _empty_df(), roster, conn=None)
        row = result[result['player_id'] == '00-001'].iloc[0]
        assert row['jersey_number'] == 10  # falls back to the parseable week-1 value
        assert row['headshot_url'] == 'https://img/new.png'

    def test_empty_result_has_headshot_columns(self):
        from ingest import generate_player_slugs
        result = generate_player_slugs(_empty_df(), _empty_df(), _empty_df(),
                                       _empty_df(), conn=None)
        assert 'headshot_url' in result.columns
        assert 'jersey_number' in result.columns


class _FakeCursor:
    """Records nothing itself — execute_values is monkeypatched to capture."""

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class _FakeConn:
    """Minimal psycopg2 connection stand-in: only cursor() as a context manager."""

    def cursor(self):
        return _FakeCursor()


class _SlugDbCursor:
    def __init__(self, conn): self.conn = conn; self._rows = []
    def __enter__(self): return self
    def __exit__(self, *exc): return False
    def execute(self, sql, params=None):
        self.conn.executed.append(sql)
        self._rows = list(self.conn.slug_rows) if 'FROM player_slugs' in sql else []
    def fetchall(self): return self._rows


class _SlugDbConn:
    """Answers only 'SELECT player_id, slug FROM player_slugs'; records every SQL + commits."""
    def __init__(self, slug_rows=()):
        self.slug_rows = list(slug_rows); self.executed = []; self.commits = 0
    def cursor(self): return _SlugDbCursor(self)
    def commit(self): self.commits += 1
    def rollback(self): pass


class TestUpsertPlayerSlugs:
    """upsert_player_slugs must never hand NaN to psycopg2.

    A mixed roster (some players with jersey/headshot, some without) gives
    jersey_number a float64 dtype, so pandas cannot store None in it. NaN
    reaching execute_values is adapted as 'NaN'::float and Postgres rejects
    it for the INTEGER/TEXT columns, killing the whole ingest.
    """

    def test_missing_jersey_and_headshot_are_none_not_nan(self, monkeypatch):
        import math
        import ingest
        from ingest import generate_player_slugs, upsert_player_slugs

        qb = _make_qb_df([
            ('00-001', 'J.Allen', 'BUF'),   # has jersey + headshot
            ('00-002', 'N.Guy', 'SEA'),     # has neither
        ])
        df = generate_player_slugs(qb, _empty_df(), _empty_df(),
                                   _roster_with_headshots(), conn=None)
        assert len(df) == 2

        captured = {}

        def fake_execute_values(cur, sql, rows):
            captured['rows'] = rows

        monkeypatch.setattr(ingest, 'execute_values', fake_execute_values)
        upsert_player_slugs(_FakeConn(), df)

        rows = captured['rows']
        assert len(rows) == 2

        # No NaN may survive into the tuples handed to psycopg2.
        flat = [v for row in rows for v in row]
        assert not any(isinstance(v, float) and math.isnan(v) for v in flat), \
            f"NaN leaked into upsert rows: {rows}"

        # Every value is either NULL or a real int/str.
        for v in flat:
            assert v is None or isinstance(v, (int, str)), \
                f"unexpected value {v!r} ({type(v).__name__}) in upsert rows"

        by_id = {row[0]: row for row in rows}
        cols = ['player_id', 'slug', 'player_name', 'position',
                'current_team_id', 'headshot_url', 'jersey_number']
        jersey_i = cols.index('jersey_number')
        headshot_i = cols.index('headshot_url')

        # The jersey-less player's slots are literally None.
        assert by_id['00-002'][jersey_i] is None
        assert by_id['00-002'][headshot_i] is None

        # The player who has them keeps a plain int jersey (not float/numpy).
        assert by_id['00-001'][jersey_i] == 17
        assert isinstance(by_id['00-001'][jersey_i], int)
        assert not isinstance(by_id['00-001'][jersey_i], bool)
        assert by_id['00-001'][headshot_i] == 'https://img/new.png'


def _named_roster(entries, week=1):
    """Roster frame from (gsis_id, position, full_name[, jersey_number]) tuples.

    A player given a jersey also gets a headshot URL; one without gets neither.
    """
    rows = []
    for e in entries:
        gsis_id, pos, name = e[:3]
        jersey = e[3] if len(e) > 3 else None
        rows.append({'gsis_id': gsis_id, 'position': pos, 'full_name': name,
                     'week': week, 'jersey_number': jersey,
                     'headshot_url': f'https://img/{gsis_id}.png' if jersey is not None else None})
    return pd.DataFrame(rows)


def _patch_backfill(monkeypatch, unslugged, rosters=None, error=None):
    """Monkeypatch find_unslugged_players + download_roster.

    Returns the list of seasons download_roster was called with.
    """
    import ingest
    calls = []
    monkeypatch.setattr(ingest, 'find_unslugged_players', lambda conn: unslugged)

    def fake_download_roster(season):
        calls.append(season)
        if error is not None:
            raise error
        return (rosters or {})[season]

    monkeypatch.setattr(ingest, 'download_roster', fake_download_roster)
    return calls


def _row(df, pid):
    return df[df['player_id'] == pid].iloc[0]


class TestSlugImmutability:
    """Stored slugs are never deleted or regenerated, and nothing commits mid-run."""

    def test_existing_slug_kept_when_roster_name_changes(self, monkeypatch):
        from ingest import generate_player_slugs
        _patch_backfill(monkeypatch, {})
        conn = _SlugDbConn([('00-0036196', 'gabriel-davis')])
        rec = _make_qb_df([('00-0036196', 'G.Davis', 'BUF')])
        roster = _named_roster([('00-0036196', 'WR', 'Gabe Davis')])
        result = generate_player_slugs(_empty_df(), rec, _empty_df(), roster, conn, season=2026)
        row = _row(result, '00-0036196')
        assert row['slug'] == 'gabriel-davis'
        assert row['player_name'] == 'Gabe Davis'
        assert not any('DELETE' in sql for sql in conn.executed)
        assert conn.commits == 0

    def test_rostered_player_without_stats_keeps_slug_and_nothing_deleted(self, monkeypatch):
        """The exact 2026-09-10 trigger: Gainwell on the 2026 roster, no 2026 stats."""
        from ingest import generate_player_slugs
        calls = _patch_backfill(monkeypatch, {})
        conn = _SlugDbConn([('00-0036919', 'kenneth-gainwell'), ('QB1', 'sam-darnold')])
        qb = _make_qb_df([('QB1', 'S.Darnold', 'SEA')])
        roster = _named_roster([('QB1', 'QB', 'Sam Darnold'),
                                ('00-0036919', 'RB', 'Kenny Gainwell')])
        result = generate_player_slugs(qb, _empty_df(), _empty_df(), roster, conn, season=2026)
        assert not any('DELETE' in sql for sql in conn.executed)
        assert conn.commits == 0
        assert _row(result, 'QB1')['slug'] == 'sam-darnold'
        # No row for him, so the upsert leaves his stored row alone
        assert '00-0036919' not in set(result['player_id'])
        assert calls == []

    def test_generate_player_slugs_source_has_no_delete_or_commit(self):
        import inspect
        import ingest
        src = inspect.getsource(ingest.generate_player_slugs)
        assert 'DELETE FROM' not in src
        assert '.commit(' not in src


class TestSlugBackfill:
    """Players with season stats in ANY season but no slug get one."""

    def test_historical_player_without_slug_gets_one_week1_case(self, monkeypatch):
        """Week 1 2026: only SEA/NE played; Gainwell (2021-2025 stats) has no slug."""
        from ingest import generate_player_slugs
        calls = _patch_backfill(
            monkeypatch,
            {'00-0036919': [(2025, 'K.Gainwell', 'PIT'), (2024, 'K.Gainwell', 'PHI')]},
            rosters={2025: _named_roster([('00-0036919', 'RB', 'Kenneth Gainwell')], week=18)},
        )
        qb = _make_qb_df([('QB_SEA', 'S.Darnold', 'SEA'), ('QB_NE', 'D.Maye', 'NE')])
        roster = _named_roster([('QB_SEA', 'QB', 'Sam Darnold'),
                                ('QB_NE', 'QB', 'Drake Maye'),
                                ('00-0036919', 'RB', 'Kenny Gainwell', 14)])
        result = generate_player_slugs(qb, _empty_df(), _empty_df(), roster,
                                       _SlugDbConn(), season=2026)
        row = _row(result, '00-0036919')
        assert row['slug'] == 'kenneth-gainwell'
        assert row['player_name'] == 'Kenny Gainwell'
        assert row['position'] == 'RB'
        assert row['current_team_id'] == 'PIT'
        assert row['jersey_number'] == 14
        assert calls == [2025]
        assert _row(result, 'QB_SEA')['slug'] == 'sam-darnold'
        assert _row(result, 'QB_NE')['slug'] == 'drake-maye'

    def test_backfill_keeps_historical_name_after_he_plays(self, monkeypatch):
        """Monday case: he now has 2026 stats (TB) and still no slug."""
        from ingest import generate_player_slugs
        calls = _patch_backfill(
            monkeypatch,
            {'00-0036919': [(2026, 'K.Gainwell', 'TB'), (2025, 'K.Gainwell', 'PIT')]},
            rosters={2025: _named_roster([('00-0036919', 'RB', 'Kenneth Gainwell')])},
        )
        rec = _make_qb_df([('00-0036919', 'K.Gainwell', 'TB')])
        roster = _named_roster([('00-0036919', 'RB', 'Kenny Gainwell', 14)])
        result = generate_player_slugs(_empty_df(), rec, _empty_df(), roster,
                                       _SlugDbConn(), season=2026)
        row = _row(result, '00-0036919')
        assert row['slug'] == 'kenneth-gainwell'
        assert row['player_name'] == 'Kenny Gainwell'
        assert row['current_team_id'] == 'TB'
        assert calls == [2025]

    def test_player_off_current_roster_named_from_last_roster(self, monkeypatch):
        """Lassiter case: one 2023 stats row, not on the current roster."""
        from ingest import generate_player_slugs
        _patch_backfill(
            monkeypatch,
            {'00-0037420': [(2023, 'K.Lassiter', 'CIN')]},
            rosters={2023: _named_roster([('00-0037420', 'WR', 'Kwamie Lassiter II')])},
        )
        qb = _make_qb_df([('QB1', 'S.Darnold', 'SEA')])
        roster = _named_roster([('QB1', 'QB', 'Sam Darnold', 14)])
        result = generate_player_slugs(qb, _empty_df(), _empty_df(), roster,
                                       _SlugDbConn(), season=2026)
        row = _row(result, '00-0037420')
        assert row['slug'] == 'kwamie-lassiter-ii'
        assert row['position'] == 'WR'
        assert row['current_team_id'] == 'CIN'
        assert row['player_name'] == 'Kwamie Lassiter II'
        # Mixed column: pandas may store the missing value as NaN, not None
        assert pd.isna(row['headshot_url'])
        assert pd.isna(row['jersey_number'])

    def test_new_player_only_this_season_uses_current_roster_no_download(self, monkeypatch):
        from ingest import generate_player_slugs
        calls = _patch_backfill(monkeypatch, {'ROOK1': [(2026, 'R.Rookie', 'SEA')]})
        qb = _make_qb_df([('ROOK1', 'R.Rookie', 'SEA')])
        roster = _named_roster([('ROOK1', 'QB', 'Rick Rookie')])
        result = generate_player_slugs(qb, _empty_df(), _empty_df(), roster,
                                       _SlugDbConn(), season=2026)
        assert _row(result, 'ROOK1')['slug'] == 'rick-rookie'
        assert calls == []

    def test_backfill_player_only_in_rb_season_stats_this_season_gets_slug(self, monkeypatch):
        """Only a 2026 row, in none of the frames passed in, but on the current roster."""
        from ingest import generate_player_slugs
        calls = _patch_backfill(monkeypatch, {'RB9': [(2026, 'F.Back', 'NE')]})
        qb = _make_qb_df([('QB1', 'S.Darnold', 'SEA')])
        roster = _named_roster([('QB1', 'QB', 'Sam Darnold'), ('RB9', 'RB', 'Fred Back')])
        result = generate_player_slugs(qb, _empty_df(), _empty_df(), roster,
                                       _SlugDbConn(), season=2026)
        row = _row(result, 'RB9')
        assert row['slug'] == 'fred-back'
        assert row['current_team_id'] == 'NE'
        assert row['position'] == 'RB'
        assert calls == []

    def test_backfill_collision_uses_team_suffix(self, monkeypatch):
        from ingest import generate_player_slugs
        _patch_backfill(
            monkeypatch,
            {'00-0036919': [(2025, 'K.Gainwell', 'PIT')]},
            rosters={2025: _named_roster([('00-0036919', 'RB', 'Kenneth Gainwell')])},
        )
        conn = _SlugDbConn([('OTHER', 'kenneth-gainwell')])
        qb = _make_qb_df([('QB1', 'S.Darnold', 'SEA')])
        roster = _named_roster([('QB1', 'QB', 'Sam Darnold')])
        result = generate_player_slugs(qb, _empty_df(), _empty_df(), roster, conn, season=2026)
        assert _row(result, '00-0036919')['slug'] == 'kenneth-gainwell-pit'
        # The stored slug is untouched: no DELETE, and no row that could rewrite it
        assert not any('DELETE' in sql for sql in conn.executed)
        assert 'OTHER' not in set(result['player_id'])
        assert conn.slug_rows == [('OTHER', 'kenneth-gainwell')]

    def test_backfill_null_team_collision_uses_unknown_suffix(self, monkeypatch):
        import math
        import ingest
        from ingest import generate_player_slugs, upsert_player_slugs
        _patch_backfill(
            monkeypatch,
            {'P1': [(2025, 'X.Guy', None)]},
            rosters={2025: _named_roster([('P1', 'WR', 'Xavier Guy')])},
        )
        conn = _SlugDbConn([('OTHER', 'xavier-guy')])
        qb = _make_qb_df([('QB1', 'S.Darnold', 'SEA')])
        roster = _named_roster([('QB1', 'QB', 'Sam Darnold')])
        result = generate_player_slugs(qb, _empty_df(), _empty_df(), roster, conn, season=2026)
        row = _row(result, 'P1')
        assert row['slug'] == 'xavier-guy-unknown'
        assert pd.isna(row['current_team_id'])

        captured = {}

        def fake_execute_values(cur, sql, rows):
            captured['rows'] = rows

        monkeypatch.setattr(ingest, 'execute_values', fake_execute_values)
        upsert_player_slugs(_FakeConn(), result)
        cols = ['player_id', 'slug', 'player_name', 'position',
                'current_team_id', 'headshot_url', 'jersey_number']
        by_id = {r[0]: r for r in captured['rows']}
        team_slot = by_id['P1'][cols.index('current_team_id')]
        assert team_slot is None  # NULL for Postgres, never 'NaN'
        flat = [v for r in captured['rows'] for v in r]
        assert not any(isinstance(v, float) and math.isnan(v) for v in flat)

    def test_backfill_nan_current_position_double_collision_does_not_crash(self, monkeypatch):
        """Chaos E4: the current roster's latest-week position is NaN (pandas 3 str
        dtype missing value) and both the base and team-suffixed slugs are taken.
        The position-suffix step used to call .lower() on the NaN and crash, which
        rolled back the whole night and repeated every night after."""
        import math
        import ingest
        from ingest import generate_player_slugs, upsert_player_slugs
        _patch_backfill(
            monkeypatch,
            {'P1': [(2025, 'X.Guy', 'PIT')]},
            rosters={2025: _named_roster([('P1', 'WR', 'Xavier Guy')])},
        )
        conn = _SlugDbConn([('OTHER1', 'xavier-guy'), ('OTHER2', 'xavier-guy-pit')])
        qb = _make_qb_df([('QB1', 'S.Darnold', 'SEA')])
        roster = _named_roster([('QB1', 'QB', 'Sam Darnold'),
                                ('P1', float('nan'), 'Xavier Guy')])
        result = generate_player_slugs(qb, _empty_df(), _empty_df(), roster, conn, season=2026)
        row = _row(result, 'P1')
        assert row['slug'] == 'xavier-guy-pit-x'
        assert row['current_team_id'] == 'PIT'
        assert _row(result, 'QB1')['slug'] == 'sam-darnold'
        # Stored slugs untouched
        assert not any('DELETE' in sql for sql in conn.executed)
        assert not {'OTHER1', 'OTHER2'} & set(result['player_id'])

        captured = {}

        def fake_execute_values(cur, sql, rows):
            captured['rows'] = rows

        monkeypatch.setattr(ingest, 'execute_values', fake_execute_values)
        upsert_player_slugs(_FakeConn(), result)
        flat = [v for r in captured['rows'] for v in r]
        assert not any(isinstance(v, float) and math.isnan(v) for v in flat)

    def test_backfill_roster_download_failure_skips_player_without_crashing(self, monkeypatch):
        from urllib.error import HTTPError
        from ingest import generate_player_slugs
        calls = _patch_backfill(
            monkeypatch,
            {'00-0036919': [(2026, 'K.Gainwell', 'TB'), (2025, 'K.Gainwell', 'PIT')]},
            error=HTTPError('https://example.invalid/roster', 500, 'boom', None, None),
        )
        qb = _make_qb_df([('QB1', 'S.Darnold', 'SEA')])
        rec = _make_qb_df([('00-0036919', 'K.Gainwell', 'TB')])
        roster = _named_roster([('QB1', 'QB', 'Sam Darnold'),
                                ('00-0036919', 'RB', 'Kenny Gainwell')])
        result = generate_player_slugs(qb, rec, _empty_df(), roster,
                                       _SlugDbConn(), season=2026)
        assert calls == [2025]
        assert '00-0036919' not in set(result['player_id'])
        assert 'kenny-gainwell' not in set(result['slug'])
        assert _row(result, 'QB1')['slug'] == 'sam-darnold'

    def test_backfill_skipped_without_conn_or_season(self, monkeypatch):
        import ingest
        from ingest import generate_player_slugs

        def must_not_be_called(*args, **kwargs):
            raise AssertionError("backfill must not run")

        monkeypatch.setattr(ingest, 'find_unslugged_players', must_not_be_called)
        monkeypatch.setattr(ingest, 'download_roster', must_not_be_called)
        qb = _make_qb_df([('QB1', 'S.Darnold', 'SEA')])
        roster = _named_roster([('QB1', 'QB', 'Sam Darnold')])
        for conn, season in [(None, 2026), (None, None), (_SlugDbConn(), None)]:
            result = generate_player_slugs(qb, _empty_df(), _empty_df(), roster, conn,
                                           season=season)
            assert _row(result, 'QB1')['slug'] == 'sam-darnold'

    def test_backfill_special_character_names(self, monkeypatch):
        from ingest import generate_player_slugs
        _patch_backfill(
            monkeypatch,
            {'SW1': [(2025, 'D.Swift', 'CHI')]},
            rosters={2025: _named_roster([('SW1', 'RB', "D'Andre Swift Jr.")])},
        )
        qb = _make_qb_df([('QB1', 'S.Darnold', 'SEA')])
        roster = _named_roster([('QB1', 'QB', 'Sam Darnold')])
        result = generate_player_slugs(qb, _empty_df(), _empty_df(), roster,
                                       _SlugDbConn(), season=2026)
        assert _row(result, 'SW1')['slug'] == 'dandre-swift-jr'

    def test_find_unslugged_players_groups_rows_and_reads_all_tables(self):
        from ingest import find_unslugged_players

        class _RowsCursor:
            def __init__(self, conn): self.conn = conn
            def __enter__(self): return self
            def __exit__(self, *exc): return False
            def execute(self, sql, params=None): self.conn.executed.append(sql)
            def fetchall(self): return list(self.conn.rows)

        class _RowsConn:
            def __init__(self, rows): self.rows = rows; self.executed = []
            def cursor(self): return _RowsCursor(self)

        conn = _RowsConn([('A', 'A.One', 'PIT', 2025), ('A', 'A.One', 'PHI', 2024),
                          ('B', 'B.Two', None, 2023)])
        assert find_unslugged_players(conn) == {
            'A': [(2025, 'A.One', 'PIT'), (2024, 'A.One', 'PHI')],
            'B': [(2023, 'B.Two', None)],
        }
        sql = conn.executed[0]
        for table in ('qb_season_stats', 'receiver_season_stats', 'rb_season_stats',
                      'rb_gap_stats', 'player_slugs'):
            assert table in sql
        assert find_unslugged_players(_RowsConn([])) == {}

    def test_roster_full_names_latest_week_wins_and_skips_nan(self):
        from ingest import _roster_full_names
        roster = pd.DataFrame([
            {'gsis_id': 'A', 'position': 'RB', 'full_name': 'Kenneth Gainwell', 'week': 2},
            {'gsis_id': 'A', 'position': 'RB', 'full_name': 'Kenny Old', 'week': 1},
            {'gsis_id': 'B', 'position': 'WR', 'full_name': float('nan'), 'week': 2},
        ])
        out = _roster_full_names(roster)
        assert out == {'A': ('Kenneth Gainwell', 'RB')}
        no_name_col = pd.DataFrame([{'gsis_id': 'A', 'position': 'RB', 'week': 1}])
        assert _roster_full_names(no_name_col) == {}
        assert _roster_full_names(None) == {}

    def test_process_season_passes_season_to_slug_generation(self):
        """Wiring guard: a defined-but-never-called fix once hid a slug bug."""
        import inspect
        import ingest
        src = inspect.getsource(ingest.process_season)
        assert ('generate_player_slugs(qb_stats, receiver_stats, rb_gap_stats, roster, '
                'conn, season=season)') in src
