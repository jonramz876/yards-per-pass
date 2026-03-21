"""Tests for slug generation and collision handling."""
import sys
import os

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
