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
