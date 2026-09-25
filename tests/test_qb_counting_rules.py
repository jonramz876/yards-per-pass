"""QB counting rules that the box-score pages exposed (spec C).

- Spikes: nflverse flags a spike pass_attempt = 1 but pass = 0 and
  qb_dropback = 0, and filter_plays drops it. Official stats (NFL, ESPN, PFR)
  count it as an incomplete pass, so filter_spikes feeds it to the QB
  aggregators' pass attempts, and to nothing else: dropbacks, EPA, success
  rate, CPOE and aDOT keep excluding it.
- Fumbles: the season aggregator concatenated dropbacks with every QB carry,
  so a scramble fumble was counted twice. It now builds the fumble frame as
  the weekly aggregator does.

These tests call the REAL aggregators (the mirror tests in test_formulas.py
copy the grouping logic and so pass whatever the aggregator does).
"""
import os
import re

import pandas as pd

ROSTER = pd.DataFrame({'gsis_id': ['QB1'], 'position': 'QB'})

SHOUGH = '00-0040743'
MAYFIELD = '00-0034855'
# Every non-null passer_player_id in the fixture, as a QB.
FIXTURE_QBS = pd.DataFrame({
    'gsis_id': ['00-0034857', '00-0039163', MAYFIELD, SHOUGH, '00-0033106', '00-0036442'],
    'position': 'QB',
})

REPO = os.path.join(os.path.dirname(__file__), '..')


def _plays(pbp):
    """filter_plays output plus the name columns the season aggregator reads."""
    from ingest import filter_plays
    return filter_plays(pbp).assign(passer_player_name=lambda d: d['passer_player_id'],
                                    rusher_player_name=lambda d: d['rusher_player_id'])


def _frames(pbp):
    from ingest import filter_spikes
    return _plays(pbp), filter_spikes(pbp)


def _pass_and_spike(raw):
    """One completed 10-yard pass (epa 0.5, air 8, cpoe 3, success 1) and one spike."""
    return raw.game(raw.play(yards_gained=10.0, passing_yards=10.0, air_yards=8.0, epa=0.5, cpoe=3.0, success=1.0),
                    raw.spike(play_id=2.0))


# ---------------------------------------------------------------------------
# Spikes
# ---------------------------------------------------------------------------

def test_filter_spikes_keeps_regular_season_spikes_only(raw):
    from ingest import filter_spikes
    pbp = raw.game(raw.spike(play_id=1.0),
                   raw.spike(play_id=2.0, season_type='POST'),
                   raw.play(play_id=3.0),
                   raw.spike(play_id=4.0, two_point_attempt=1.0))
    out = filter_spikes(pbp)
    assert list(out['play_id']) == [1.0]


def test_season_spike_is_a_pass_attempt_and_nothing_else(raw):
    from ingest import aggregate_qb_stats, passer_rating
    plays, spikes = _frames(_pass_and_spike(raw))
    r = aggregate_qb_stats(plays, ROSTER, 2026, spikes=spikes).iloc[0]
    # counted: attempts and everything computed from them
    assert (r['attempts'], r['completions']) == (2, 1)
    assert r['completion_pct'] == 50.0
    assert r['ypa'] == 5.0
    assert r['any_a'] == 5.0
    assert r['passer_rating'] == passer_rating(1, 2, 10, 0, 0)
    # not counted: the efficiency set (the spike's air_yards = -1 must not be averaged in)
    assert r['dropbacks'] == 1
    assert r['epa_per_db'] == 0.5
    assert r['epa_per_play'] == 0.5
    assert r['total_epa'] == 0.5
    assert r['success_rate'] == 1.0
    assert r['cpoe'] == 3.0
    assert r['adot'] == 8.0


def test_weekly_spike_is_a_pass_attempt_and_nothing_else(raw):
    from ingest import aggregate_qb_weekly_stats, passer_rating
    plays, spikes = _frames(_pass_and_spike(raw))
    w = aggregate_qb_weekly_stats(plays, ROSTER, 2026, spikes=spikes)
    assert len(w) == 1
    w = w.iloc[0]
    assert (w['attempts'], w['completions']) == (2, 1)
    assert w['passer_rating'] == passer_rating(1, 2, 10, 0, 0)
    assert w['ypa'] == 5.0
    assert w['epa_per_dropback'] == 0.5
    assert w['adot'] == 8.0


def test_shough_week_one_matches_espn(pbp_fixture):
    """The fixture's one spike: 2026_01_NO_DET play 4759. ESPN: Shough 35/56, 87.6
    (without the spike the site showed 35/55, 89.2)."""
    from ingest import aggregate_qb_stats, aggregate_qb_weekly_stats
    plays, spikes = _frames(pbp_fixture)
    assert list(zip(spikes['game_id'], spikes['play_id'])) == [('2026_01_NO_DET', 4759.0)]

    weekly = aggregate_qb_weekly_stats(plays, FIXTURE_QBS, 2026, spikes=spikes)
    w = weekly[weekly['player_id'] == SHOUGH].iloc[0]
    assert (w['completions'], w['attempts']) == (35, 56)
    assert w['passer_rating'] == 87.6

    with_spikes = aggregate_qb_stats(plays, FIXTURE_QBS, 2026, spikes=spikes).set_index('player_id').loc[SHOUGH]
    without = aggregate_qb_stats(plays, FIXTURE_QBS, 2026, spikes=None).set_index('player_id').loc[SHOUGH]
    assert with_spikes['attempts'] == 56
    assert with_spikes['passer_rating'] == 87.6
    for col in ('dropbacks', 'epa_per_db', 'adot', 'cpoe', 'success_rate'):
        assert with_spikes[col] == without[col], col


def test_spikes_argument_edge_cases(raw):
    from ingest import aggregate_qb_stats, aggregate_qb_weekly_stats
    plays = _plays(raw.game(raw.play()))
    season = aggregate_qb_stats(plays, ROSTER, 2026)
    weekly = aggregate_qb_weekly_stats(plays, ROSTER, 2026)

    # None and an empty frame are the same as no keyword at all
    for empty in (None, pd.DataFrame()):
        pd.testing.assert_frame_equal(season, aggregate_qb_stats(plays, ROSTER, 2026, spikes=empty))
        pd.testing.assert_frame_equal(weekly, aggregate_qb_weekly_stats(plays, ROSTER, 2026, spikes=empty))

    # A spike by a passer with no dropback in that game adds no row
    _, other_game = _frames(raw.game(raw.spike(game_id='2026_02_KC_DEN', play_id=9.0)))
    pd.testing.assert_frame_equal(weekly, aggregate_qb_weekly_stats(plays, ROSTER, 2026, spikes=other_game))
    _, other_qb = _frames(raw.game(raw.spike(passer_player_id='QB2', play_id=9.0)))
    pd.testing.assert_frame_equal(season, aggregate_qb_stats(plays, ROSTER, 2026, spikes=other_qb))
    pd.testing.assert_frame_equal(weekly, aggregate_qb_weekly_stats(plays, ROSTER, 2026, spikes=other_qb))

    # A spike with no passer id changes nothing
    _, nameless = _frames(raw.game(raw.spike(passer_player_id=None, play_id=9.0)))
    assert len(nameless) == 1
    pd.testing.assert_frame_equal(season, aggregate_qb_stats(plays, ROSTER, 2026, spikes=nameless))
    pd.testing.assert_frame_equal(weekly, aggregate_qb_weekly_stats(plays, ROSTER, 2026, spikes=nameless))


# ---------------------------------------------------------------------------
# Fumbles
# ---------------------------------------------------------------------------

def test_season_scramble_fumble_counts_once(raw):
    """A scramble is in dropbacks AND among the QB's carries; its fumble is one fumble."""
    from ingest import aggregate_qb_stats, aggregate_qb_weekly_stats
    plays = _plays(raw.game(
        raw.scramble(3.0, play_id=1.0, fumble=1.0, fumble_lost=1.0, fumbled_1_player_id='QB1'),
        raw.rush(2.0, play_id=2.0, rusher_player_id='QB1', fumble=1.0, fumbled_1_player_id='QB1'),
        raw.sack(play_id=3.0, fumble=1.0, fumble_lost=1.0, fumbled_1_player_id='QB1'),
        raw.play(play_id=4.0),
    ))
    r = aggregate_qb_stats(plays, ROSTER, 2026).iloc[0]
    assert (r['fumbles'], r['fumbles_lost']) == (3, 2)
    w = aggregate_qb_weekly_stats(plays, ROSTER, 2026)
    assert (w['fumbles'].sum(), w['fumbles_lost'].sum()) == (3, 2)


def test_mayfield_week_one_fumbles_match_espn(pbp_fixture):
    """2026_01_TB_CIN play 1213 is a lost scramble fumble. ESPN week 1: FUM 3, LOST 3
    (the season row said 4 / 4)."""
    from ingest import aggregate_qb_stats
    season = aggregate_qb_stats(_plays(pbp_fixture), FIXTURE_QBS, 2026).set_index('player_id')
    assert (season.loc[MAYFIELD, 'fumbles'], season.loc[MAYFIELD, 'fumbles_lost']) == (3, 3)


def test_season_fumbles_equal_the_game_log_sum(pbp_fixture):
    from ingest import aggregate_qb_stats, aggregate_qb_weekly_stats
    plays = _plays(pbp_fixture)
    season = aggregate_qb_stats(plays, FIXTURE_QBS, 2026).set_index('player_id')
    weekly = aggregate_qb_weekly_stats(plays, FIXTURE_QBS, 2026).groupby('player_id')[['fumbles', 'fumbles_lost']].sum()
    assert len(season) > 0
    for qb in season.index:
        got = (season.loc[qb, 'fumbles'], season.loc[qb, 'fumbles_lost'])
        want = (weekly.loc[qb, 'fumbles'], weekly.loc[qb, 'fumbles_lost']) if qb in weekly.index else (0, 0)
        assert got == want, qb


# ---------------------------------------------------------------------------
# The four definitions that describe dropbacks / aDOT in terms of pass attempts
# ---------------------------------------------------------------------------

def _read(*parts):
    with open(os.path.join(REPO, *parts), encoding='utf-8') as f:
        return f.read()


def _glossary_definition(text, term):
    m = re.search(r'term:\s*"' + re.escape(term) + r'",\s*(?:id:\s*"[^"]*",\s*)?definition:\s*"([^"]*)"', text)
    assert m, f'glossary entry {term!r} not found'
    return m.group(1)


def test_definitions_name_the_spike_exception(raw):
    """The wording and the code, tied together. The Dropback entry says only that a
    spike is not a dropback: whether it is a pass attempt depends on the season
    until 2020-2025 are re-ingested (spec C, D7)."""
    from ingest import aggregate_qb_stats
    plays, spikes = _frames(_pass_and_spike(raw))
    r = aggregate_qb_stats(plays, ROSTER, 2026, spikes=spikes).iloc[0]
    assert (r['attempts'], r['dropbacks']) == (2, 1)
    assert r['epa_per_db'] == 0.5 and r['adot'] == 8.0

    tooltip = _read('components', 'ui', 'MetricTooltip.tsx')
    m = re.search(r'"EPA/DB":\s*"([^"]*)"', tooltip)
    assert m, 'MetricTooltip "EPA/DB" entry not found'
    definitions = {'tooltip EPA/DB': m.group(1)}

    glossary = _read('app', 'glossary', 'page.tsx')
    for term in ('EPA/Dropback (EPA/DB)', 'aDOT (Average Depth of Target)', 'Dropback'):
        definitions[term] = _glossary_definition(glossary, term)

    for name, text in definitions.items():
        assert 'spike' in text, name
    assert 'is not a dropback' in definitions['Dropback']
