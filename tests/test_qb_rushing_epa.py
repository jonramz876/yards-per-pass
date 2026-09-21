"""QB rushing EPA/carry and success rate on qb_weekly_stats — box score spec §10.1.

Both are computed over exactly the carries rush_attempts counts: designed runs
plus scrambles, kneels excluded.
"""
import math
import re

import pandas as pd
import pytest
from pytest import approx

ALLEN = '00-0034857'
STROUD = '00-0039163'


def _roster(*ids):
    return pd.DataFrame([{'gsis_id': pid, 'position': 'QB'} for pid in ids])


class _FakeCursor:
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql, *args):
        pass


class _FakeConn:
    def __init__(self):
        self.commits = 0

    def cursor(self):
        return _FakeCursor()

    def commit(self):
        self.commits += 1


class TestSyntheticQB:
    def test_one_designed_run_and_one_scramble(self, raw):
        """Designed run +0.4 (success) and scramble -0.6 (failure): 2 carries, -0.10 EPA/carry, 50%.
        Designed runs alone would give +0.40 and 100% over 1 carry — no longer the 2 carries shown."""
        from ingest import aggregate_qb_weekly_stats
        plays = raw.game(raw.play(), raw.rush(6.0, rusher_player_id='QB1', epa=0.4, success=1.0),
                         raw.scramble(7.0, epa=-0.6, success=0.0))
        row = aggregate_qb_weekly_stats(plays, _roster('QB1'), 2026).iloc[0]
        assert row['rush_attempts'] == 2
        assert row['rush_epa_per_carry'] == approx(-0.1)
        assert row['rush_success_rate'] == approx(0.5)

    def test_no_carries_is_null_not_nan(self, raw):
        from ingest import aggregate_qb_weekly_stats
        row = aggregate_qb_weekly_stats(raw.game(raw.play(), raw.play()), _roster('QB1'), 2026).iloc[0]
        assert row['rush_attempts'] == 0
        assert row['rush_epa_per_carry'] is None
        assert row['rush_success_rate'] is None

    def test_kneels_stay_out(self, raw):
        """A kneel is not a carry in the QB tables (MEMORY.md kneel fix), so it cannot drag EPA/carry down."""
        from ingest import aggregate_qb_weekly_stats
        plays = raw.game(raw.play(), raw.rush(6.0, rusher_player_id='QB1', epa=0.4, success=1.0),
                         raw.kneel(), raw.kneel())
        row = aggregate_qb_weekly_stats(plays, _roster('QB1'), 2026).iloc[0]
        assert row['rush_attempts'] == 1
        assert row['rush_epa_per_carry'] == approx(0.4)
        assert row['rush_success_rate'] == approx(1.0)

    def test_two_qbs_are_kept_apart(self, raw):
        from ingest import aggregate_qb_weekly_stats
        plays = raw.game(raw.play(passer_player_id='QB1'), raw.rush(3.0, rusher_player_id='QB1', epa=-0.5, success=0.0),
                         raw.play(passer_player_id='QB2', posteam='BUF', defteam='KC'),
                         raw.scramble(11.0, rusher_player_id='QB2', posteam='BUF', defteam='KC', epa=1.2, success=1.0))
        out = aggregate_qb_weekly_stats(plays, _roster('QB1', 'QB2'), 2026).set_index('player_id')
        assert out.loc['QB1', 'rush_epa_per_carry'] == approx(-0.5)
        assert out.loc['QB1', 'rush_success_rate'] == approx(0.0)
        assert out.loc['QB2', 'rush_epa_per_carry'] == approx(1.2)
        assert out.loc['QB2', 'rush_success_rate'] == approx(1.0)


class TestFixtureQBs:
    def test_allen_and_stroud_week_one(self, pbp_fixture):
        """Allen: 5 carries (4 designed + 1 scramble) -> -0.46, 40%. Stroud: 2 (1 + 1) -> +0.73, 50%."""
        from ingest import aggregate_qb_weekly_stats, filter_plays
        plays = filter_plays(pbp_fixture[pbp_fixture['game_id'] == '2026_01_BUF_HOU'])
        out = aggregate_qb_weekly_stats(plays, _roster(ALLEN, STROUD), 2026).set_index('player_id')
        assert out.loc[ALLEN, 'rush_attempts'] == 5
        assert out.loc[ALLEN, 'rush_epa_per_carry'] == approx(-0.4626, abs=5e-5)
        assert out.loc[ALLEN, 'rush_success_rate'] == approx(0.40, abs=0.005)
        assert out.loc[STROUD, 'rush_attempts'] == 2
        assert out.loc[STROUD, 'rush_epa_per_carry'] == approx(0.7312, abs=5e-5)
        assert out.loc[STROUD, 'rush_success_rate'] == approx(0.50, abs=0.005)
        # Designed runs alone would be Allen -1.17 / 25% over 4 plays (spec §10.1)
        assert out.loc[ALLEN, 'rush_epa_per_carry'] != approx(-1.17, abs=0.05)

    def test_existing_columns_unchanged(self, pbp_fixture):
        from ingest import aggregate_qb_weekly_stats, filter_plays
        plays = filter_plays(pbp_fixture[pbp_fixture['game_id'] == '2026_01_BUF_HOU'])
        out = aggregate_qb_weekly_stats(plays, _roster(ALLEN, STROUD), 2026).set_index('player_id')
        assert (out.loc[ALLEN, 'completions'], out.loc[ALLEN, 'attempts']) == (20, 29)
        assert (out.loc[STROUD, 'completions'], out.loc[STROUD, 'attempts']) == (26, 38)
        assert out.loc[ALLEN, 'rush_tds'] == 2


class TestSchemaAndUpsert:
    def test_ensure_columns_adds_both_and_commits(self):
        import ingest
        statements = []

        class Cur(_FakeCursor):
            def execute(self, sql, *args):
                statements.append(sql)

        class Conn(_FakeConn):
            def cursor(self):
                return Cur()

        conn = Conn()
        ingest.ensure_qb_weekly_stats_columns(conn)
        ddl = ' '.join(statements)
        assert 'ALTER TABLE qb_weekly_stats ADD COLUMN IF NOT EXISTS rush_epa_per_carry NUMERIC' in ddl
        assert 'ALTER TABLE qb_weekly_stats ADD COLUMN IF NOT EXISTS rush_success_rate NUMERIC' in ddl
        assert conn.commits == 1

    def test_upsert_writes_the_new_columns_and_null_for_no_carries(self, monkeypatch, raw):
        import ingest
        from ingest import aggregate_qb_weekly_stats, upsert_qb_weekly_stats
        captured = {}

        def fake_execute_values(cur, sql, rows):
            captured['sql'] = sql
            captured['rows'] = rows

        monkeypatch.setattr(ingest, 'execute_values', fake_execute_values)
        plays = raw.game(raw.play(passer_player_id='QB1'), raw.scramble(9.0, rusher_player_id='QB1', epa=0.8, success=1.0),
                         raw.play(passer_player_id='QB2', posteam='BUF', defteam='KC'))
        df = aggregate_qb_weekly_stats(plays, _roster('QB1', 'QB2'), 2026)
        upsert_qb_weekly_stats(_FakeConn(), df)

        cols = [c.strip() for c in
                re.search(r'INSERT INTO qb_weekly_stats \(([^)]*)\)', captured['sql']).group(1).split(',')]
        assert 'rush_epa_per_carry' in cols and 'rush_success_rate' in cols
        assert 'rush_epa_per_carry = EXCLUDED.rush_epa_per_carry' in captured['sql']
        assert 'rush_success_rate = EXCLUDED.rush_success_rate' in captured['sql']
        by_id = {r[cols.index('player_id')]: dict(zip(cols, r)) for r in captured['rows']}
        assert by_id['QB1']['rush_epa_per_carry'] == approx(0.8)
        assert by_id['QB1']['rush_success_rate'] == approx(1.0)
        assert by_id['QB2']['rush_epa_per_carry'] is None
        assert by_id['QB2']['rush_success_rate'] is None
        flat = [v for r in captured['rows'] for v in r]
        assert not any(isinstance(v, float) and math.isnan(v) for v in flat)

    def test_upsert_converts_nan_adot_and_cpoe_to_none(self, monkeypatch, raw):
        """A QB whose only dropback this game is a sack has 0 true pass attempts,
        so adot (unmatched left-merge) and cpoe (.dropna().mean() on an all-NaN
        group) stay real float64 NaN out of the aggregator — unlike
        rush_epa_per_carry/rush_success_rate, which _ratio always makes a safe
        None. upsert_qb_weekly_stats must still convert that NaN to None before
        execute_values, never let a bare NaN through (chaos report ERROR #2,
        ingest.py's upsert_qb_weekly_stats .where(df[cols].notna(), None))."""
        import ingest
        from ingest import aggregate_qb_weekly_stats, upsert_qb_weekly_stats
        captured = {}

        def fake_execute_values(cur, sql, rows):
            captured['sql'] = sql
            captured['rows'] = rows

        monkeypatch.setattr(ingest, 'execute_values', fake_execute_values)
        plays = raw.game(raw.sack())
        df = aggregate_qb_weekly_stats(plays, _roster('QB1'), 2026)
        # Sanity: confirm the aggregator really does leak a raw NaN here (not a
        # safe None) — otherwise this test would not exercise the upsert bug.
        assert math.isnan(df['adot'].iloc[0])
        assert math.isnan(df['cpoe'].iloc[0])

        upsert_qb_weekly_stats(_FakeConn(), df)

        cols = [c.strip() for c in
                re.search(r'INSERT INTO qb_weekly_stats \(([^)]*)\)', captured['sql']).group(1).split(',')]
        row = dict(zip(cols, captured['rows'][0]))
        assert row['adot'] is None
        assert row['cpoe'] is None
        flat = [v for r in captured['rows'] for v in r]
        assert not any(isinstance(v, float) and math.isnan(v) for v in flat)
