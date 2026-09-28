"""The /team-stats page's footnotes, tied to the code that makes them true
(team stats spec 2026-09-28 §5.4, §6.1).

Each test runs the real ingest code, then reads lib/stats/team-stats.ts and
checks the sentence that describes it is there. If the code changes so that a
sentence becomes false, the first half fails; if the sentence is reworded
away, the second half does.
"""
import os

from pytest import approx

from conftest import team_game_row

REPO = os.path.join(os.path.dirname(__file__), '..')
BUF_HOU = '2026_01_BUF_HOU'


def _ts():
    with open(os.path.join(REPO, 'lib', 'stats', 'team-stats.ts'), encoding='utf-8') as f:
        return f.read()


def _one(raw, *frames):
    """Aggregate a synthetic game and return KC's row (the away team in the defaults)."""
    from ingest import aggregate_team_game_stats
    out = aggregate_team_game_stats(raw.game(*frames), 2026)
    return team_game_row(out, out['game_id'].iloc[0], 'KC')


def test_team_tiers_counts_plays_differently(pbp_fixture, team_game_rows):
    """C1: Team Tiers' play set (filter_plays) is not the box score's (team_game_stats)."""
    from ingest import filter_plays
    plays = filter_plays(pbp_fixture)
    tiers_buf = len(plays[(plays['game_id'] == BUF_HOU) & (plays['posteam'] == 'BUF')])
    box_buf = team_game_row(team_game_rows, BUF_HOU, 'BUF')['plays']
    assert box_buf == 56
    assert tiers_buf == 52
    assert tiers_buf != box_buf
    assert 'counts plays differently' in _ts()


def test_explosive_rules_match_the_footnote(raw):
    """C4: completions of 20+ and runs of 10+ count, 19 and 9 don't; a scramble
    of 10+ is an explosive run but not a designed run (rush_plays)."""
    row = _one(raw,
               raw.play(yards_gained=20.0, passing_yards=20.0),   # explosive pass
               raw.play(yards_gained=19.0, passing_yards=19.0),   # not
               raw.rush(10.0),                                    # explosive run
               raw.rush(9.0),                                     # not
               raw.scramble(12.0))                                # explosive run, not a designed run
    assert (row['explosive_pass'], row['explosive_rush'], row['explosive_plays']) == (1, 2, 3)
    assert row['rush_plays'] == 2
    ts = _ts()
    for phrase in ('completions of 20+ yards', 'runs of 10+', 'QB scrambles count as runs', 'designed runs only'):
        assert phrase in ts, phrase


def test_penalty_cost_counts_flags_on_both_sides(raw):
    """C6 (J1): a flag KC commits on DEFENCE lowers KC's own epa_lost_penalties."""
    base = _one(raw, raw.play())
    own_defence = raw.no_play(posteam='BUF', defteam='KC', penalty_team='KC', penalty_yards=15.0, epa=0.8)
    row = _one(raw, raw.play(), own_defence)
    assert base['epa_lost_penalties'] == approx(0.0)
    assert row['epa_lost_penalties'] == approx(-0.8)
    assert 'flags on both sides of the ball' in _ts()


def test_strip_sack_counts_in_both(raw):
    """C6b: a strip-sack is in both epa_lost_sacks and epa_lost_turnovers, so the
    page's Total (their sum) counts it twice."""
    strip = raw.sack(9.0, fumble=1.0, fumble_lost=1.0, fumbled_1_team='KC', fumbled_1_player_id='QB1', epa=-5.0)
    row = _one(raw, strip, raw.play())
    assert row['epa_lost_sacks'] == approx(-5.0)
    assert row['epa_lost_turnovers'] == approx(-5.0)
    ts = _ts()
    assert 'strip-sack' in ts
    assert 'counts it twice' in ts
