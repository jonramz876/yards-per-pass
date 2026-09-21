"""Tests for aggregate_team_game_stats — box score spec §4 (definitions), §5
(table), §11 (golden game + tricky cases)."""
import math

import pandas as pd
import pytest
from pytest import approx

from conftest import FIXTURE_GAMES, FIXTURE_PATH, RAW_PBP_COLUMNS, team_game_row

BUF_HOU = '2026_01_BUF_HOU'
NO_DET = '2026_01_NO_DET'
TB_CIN = '2026_01_TB_CIN'

KEY_COLS = ['game_id', 'team_id', 'season', 'week', 'opponent_id', 'home_away']


# ---------------------------------------------------------------------------
# Fixture integrity
# ---------------------------------------------------------------------------

class TestFixture:
    def test_has_every_raw_row_of_the_three_games(self, pbp_fixture):
        counts = pbp_fixture['game_id'].value_counts().to_dict()
        assert counts == {BUF_HOU: 180, NO_DET: 218, TB_CIN: 169}
        assert sorted(counts) == sorted(FIXTURE_GAMES)

    def test_keeps_kicks_and_penalty_rows(self, pbp_fixture):
        """Possession, drives, penalties and red zone need the rows filter_plays drops."""
        kinds = pbp_fixture['play_type'].value_counts()
        for play_type in ('kickoff', 'punt', 'extra_point', 'field_goal', 'no_play', 'qb_kneel'):
            assert kinds.get(play_type, 0) > 0, play_type
        assert pbp_fixture['play_type'].isna().sum() > 0  # game start / end rows

    def test_columns_are_exactly_the_ones_the_code_reads(self, pbp_fixture):
        assert list(pbp_fixture.columns) == RAW_PBP_COLUMNS
        assert (pbp_fixture['season_type'] == 'REG').all()
        assert (pbp_fixture['week'] == 1).all()

    def test_carries_no_pandas_metadata(self):
        """A pandas-written parquet embeds a metadata blob that only pandas
        reads back identically; without it, pandas 2.2.3 (CI) and pandas 3
        (local) parse the file the same way (module docstring)."""
        import pyarrow.parquet as pq
        assert pq.ParquetFile(FIXTURE_PATH).schema_arrow.metadata is None


# ---------------------------------------------------------------------------
# Golden: 2026_01_BUF_HOU (spec §4). Where each GOLD number comes from:
#   * efficiency (plays, EPA/play, success rate, first-down rate, and their
#     pass / rush / early / late splits) — verified against rbsdm.com;
#   * traditional (first downs, 3rd/4th down, total plays and yards, net
#     passing, comp/att, interceptions, sacks, rushing, red zone, penalties,
#     turnovers, fumbles lost, defensive TDs, possession) — verified against the
#     ESPN box score;
#   * epa_lost_turnovers / epa_lost_sacks / epa_lost_penalties, the explosive
#     counts (explosive_plays / _pass / _rush / _rate) and team_targets — no
#     public source publishes these, so they were recomputed independently from
#     the same play-by-play during the spec review.
# ---------------------------------------------------------------------------

def _eff(plays, epa, succ, fd):
    return {'plays': plays, 'epa_per_play': approx(epa, abs=5e-5),
            'success_rate': approx(succ, abs=5e-5), 'first_down_rate': approx(fd, abs=5e-5)}


GOLD = {
    'BUF': {
        **_eff(56, 0.2780, 0.4107, 0.3571),
        **{f'pass_{k}': v for k, v in _eff(37, 0.5557, 0.4595, 0.4324).items()},
        **{f'rush_{k}': v for k, v in _eff(19, -0.2628, 0.3158, 0.2105).items()},
        'early_plays': 45, 'early_epa_per_play': approx(0.3013, abs=5e-5), 'early_success_rate': approx(0.4222, abs=5e-5),
        'late_plays': 10, 'late_epa_per_play': approx(0.2955, abs=5e-5), 'late_success_rate': approx(0.4000, abs=5e-5),
        'explosive_plays': 8, 'explosive_pass': 5, 'explosive_rush': 3, 'explosive_rate': approx(8 / 56, abs=1e-9),
        'epa_lost_turnovers': approx(0.00, abs=0.005), 'epa_lost_sacks': approx(-3.27, abs=0.005),
        'epa_lost_penalties': approx(-8.52, abs=0.005),
        'first_downs': 20, 'first_downs_pass': 13, 'first_downs_rush': 5, 'first_downs_penalty': 2,
        'third_down_att': 9, 'third_down_conv': 3, 'fourth_down_att': 1, 'fourth_down_conv': 0,
        'total_plays': 52, 'total_yards': 409, 'total_drives': 12, 'yards_per_play': approx(7.9, abs=0.05),
        'net_passing_yards': 323, 'completions': 20, 'attempts': 29, 'yards_per_pass': approx(10.4, abs=0.05),
        'interceptions': 0, 'sacks': 2, 'sack_yards': 11,
        'rushing_yards': 86, 'rushing_attempts': 21, 'yards_per_rush': approx(4.1, abs=0.05),
        'red_zone_trips': 3, 'red_zone_tds': 1, 'penalties': 10, 'penalty_yards': 85,
        'turnovers': 0, 'fumbles_lost': 0, 'def_st_tds': 0, 'time_of_possession_seconds': 23 * 60 + 43,
        'team_targets': 28,
    },
    'HOU': {
        **_eff(79, 0.0713, 0.4810, 0.3165),
        **{f'pass_{k}': v for k, v in _eff(48, 0.0977, 0.5208, 0.3333).items()},
        **{f'rush_{k}': v for k, v in _eff(31, 0.0303, 0.4194, 0.2903).items()},
        'early_plays': 59, 'early_epa_per_play': approx(0.1003, abs=5e-5), 'early_success_rate': approx(0.4746, abs=5e-5),
        'late_plays': 20, 'late_epa_per_play': approx(-0.0144, abs=5e-5), 'late_success_rate': approx(0.5000, abs=5e-5),
        'explosive_plays': 8, 'explosive_pass': 4, 'explosive_rush': 4, 'explosive_rate': approx(8 / 79, abs=1e-9),
        'epa_lost_turnovers': approx(-7.00, abs=0.005), 'epa_lost_sacks': approx(-8.66, abs=0.005),
        'epa_lost_penalties': approx(-9.69, abs=0.005),
        'first_downs': 26, 'first_downs_pass': 11, 'first_downs_rush': 10, 'first_downs_penalty': 5,
        'third_down_att': 16, 'third_down_conv': 7, 'fourth_down_att': 2, 'fourth_down_conv': 2,
        'total_plays': 73, 'total_yards': 381, 'total_drives': 11, 'yards_per_play': approx(5.2, abs=0.05),
        'net_passing_yards': 257, 'completions': 26, 'attempts': 38, 'yards_per_pass': approx(6.3, abs=0.05),
        'interceptions': 0, 'sacks': 3, 'sack_yards': 17,
        'rushing_yards': 124, 'rushing_attempts': 32, 'yards_per_rush': approx(3.9, abs=0.05),
        'red_zone_trips': 5, 'red_zone_tds': 4, 'penalties': 7, 'penalty_yards': 106,
        'turnovers': 2, 'fumbles_lost': 2, 'def_st_tds': 0, 'time_of_possession_seconds': 36 * 60 + 17,
        'team_targets': 37,
    },
}


class TestGoldenBufHou:
    def test_every_stored_column_has_a_golden_value(self):
        """An error in a column without an assertion would be invisible (spec §11)."""
        from ingest import TEAM_GAME_STATS_COLS
        assert set(GOLD['BUF']) == set(TEAM_GAME_STATS_COLS) - set(KEY_COLS)
        assert set(GOLD['HOU']) == set(GOLD['BUF'])

    @pytest.mark.parametrize('team', ['BUF', 'HOU'])
    @pytest.mark.parametrize('column', sorted(GOLD['BUF']))
    def test_golden(self, team_game_rows, team, column):
        row = team_game_row(team_game_rows, BUF_HOU, team)
        assert row[column] == GOLD[team][column], f"{team}.{column}"

    def test_keys(self, team_game_rows):
        buf = team_game_row(team_game_rows, BUF_HOU, 'BUF')
        hou = team_game_row(team_game_rows, BUF_HOU, 'HOU')
        assert (buf['season'], buf['week'], buf['opponent_id'], buf['home_away']) == (2026, 1, 'HOU', 'away')
        assert (hou['season'], hou['week'], hou['opponent_id'], hou['home_away']) == (2026, 1, 'BUF', 'home')

    def test_three_play_counts_disagree_on_purpose(self, team_game_rows):
        """Efficiency plays 56, total plays 52, rush plays 19 beside 21 attempts (spec §12)."""
        buf = team_game_row(team_game_rows, BUF_HOU, 'BUF')
        assert (buf['plays'], buf['total_plays'], buf['rush_plays'], buf['rushing_attempts']) == (56, 52, 19, 21)

    def test_the_wrong_penalty_formulas_are_not_what_we_store(self, team_game_rows):
        """Summing every flag in the game gives BUF +1.17; skipping the sign flip +2.39 (spec §4)."""
        buf = team_game_row(team_game_rows, BUF_HOU, 'BUF')
        assert buf['epa_lost_penalties'] != approx(1.17, abs=0.05)
        assert buf['epa_lost_penalties'] != approx(2.39, abs=0.05)

    def test_possession_sums_to_sixty_minutes(self, team_game_rows):
        rows = team_game_rows[team_game_rows['game_id'] == BUF_HOU]
        assert rows['time_of_possession_seconds'].sum() == 3600

    def test_early_plus_late_is_one_short_for_buf(self, team_game_rows):
        """BUF's failed 2-point pass is in the efficiency set but has no down (spec §4)."""
        buf = team_game_row(team_game_rows, BUF_HOU, 'BUF')
        hou = team_game_row(team_game_rows, BUF_HOU, 'HOU')
        assert buf['early_plays'] + buf['late_plays'] == buf['plays'] - 1
        assert hou['early_plays'] + hou['late_plays'] == hou['plays']


class TestGoldenOtherGames:
    def test_overtime_possession_sums_to_68_26(self, team_game_rows):
        rows = team_game_rows[team_game_rows['game_id'] == NO_DET]
        assert len(rows) == 2
        assert rows['time_of_possession_seconds'].sum() == 68 * 60 + 26

    def test_defensive_touchdowns_and_turnovers_tb_cin(self, team_game_rows):
        """A defensive TD each way — TB's is a pick-six (play 2805, Trotter 38 yards),
        CIN's a strip-sack fumble return (play 545, Knight 27 yards). TB turned it over
        4 times, CIN once (spec §8's +3 margin)."""
        tb = team_game_row(team_game_rows, TB_CIN, 'TB')
        cin = team_game_row(team_game_rows, TB_CIN, 'CIN')
        assert (tb['def_st_tds'], cin['def_st_tds']) == (1, 1)
        assert (tb['turnovers'], cin['turnovers']) == (4, 1)
        assert (tb['home_away'], cin['home_away']) == ('away', 'home')

    def test_output_shape(self, team_game_rows):
        from ingest import TEAM_GAME_STATS_COLS
        assert list(team_game_rows.columns) == TEAM_GAME_STATS_COLS
        assert len(team_game_rows) == 6
        assert team_game_rows.groupby('game_id').size().to_dict() == {g: 2 for g in FIXTURE_GAMES}
        assert not team_game_rows.isna().any().any()


class TestPartialDriveClock:
    """time_of_possession_seconds is NULL only when EVERY drive is unreadable. When
    only some are, the sum is silently short — so the aggregator logs a warning
    naming the game and team (spec §4 time of possession)."""

    def test_warns_when_only_some_drives_have_a_readable_clock(self, raw, caplog):
        from ingest import aggregate_team_game_stats
        plays = raw.game(raw.play(drive=1.0, drive_time_of_possession='2:30'),
                         raw.play(drive=2.0, drive_time_of_possession='junk'))
        with caplog.at_level('WARNING', logger='ingest'):
            out = aggregate_team_game_stats(plays, 2026)
        kc = team_game_row(out, '2026_01_KC_BUF', 'KC')
        assert kc['total_drives'] == 2
        assert kc['time_of_possession_seconds'] == 150   # the readable drive only
        assert '2026_01_KC_BUF' in caplog.text
        assert 'KC' in caplog.text
        assert '1 of 2' in caplog.text

    def test_no_warning_when_every_drive_has_a_clock(self, raw, caplog):
        from ingest import aggregate_team_game_stats
        plays = raw.game(raw.play(drive=1.0, drive_time_of_possession='2:30'),
                         raw.play(drive=2.0, drive_time_of_possession='1:00'))
        with caplog.at_level('WARNING', logger='ingest'):
            aggregate_team_game_stats(plays, 2026)
        assert 'drive_time_of_possession' not in caplog.text

    def test_no_warning_when_no_drive_has_a_clock(self, raw, caplog):
        """Every drive unreadable is the NULL case, already visible in the stored row."""
        from ingest import aggregate_team_game_stats
        plays = raw.game(raw.play(drive=1.0, drive_time_of_possession=None),
                         raw.play(drive=2.0, drive_time_of_possession='junk'))
        with caplog.at_level('WARNING', logger='ingest'):
            out = aggregate_team_game_stats(plays, 2026)
        assert team_game_row(out, '2026_01_KC_BUF', 'KC')['time_of_possession_seconds'] is None
        assert 'drive_time_of_possession' not in caplog.text


class TestNullWeek:
    """week NaN on every row of a game must not crash the whole aggregate — a
    corrupted/malformed game should be dropped and logged, never abort the
    entire season's ingest (chaos report CRASH finding, IntCastingNaNError at
    ingest.py's frame['week'].astype(int))."""

    def test_game_with_every_row_null_week_is_dropped_and_logged(self, raw, caplog):
        from ingest import aggregate_team_game_stats
        good = (raw.play(game_id='2026_01_KC_BUF', week=1),
                raw.rush(4.0, game_id='2026_01_KC_BUF', week=1))
        bad = (raw.play(game_id='2026_01_NYJ_NE', home_team='NE', away_team='NYJ',
                        posteam='NYJ', defteam='NE', week=math.nan),
               raw.rush(4.0, game_id='2026_01_NYJ_NE', home_team='NE', away_team='NYJ',
                        posteam='NYJ', defteam='NE', week=math.nan))
        plays = raw.game(*good, *bad)
        with caplog.at_level('WARNING', logger='ingest'):
            out = aggregate_team_game_stats(plays, 2026)
        # The good game still produces its two rows.
        assert set(out['game_id']) == {'2026_01_KC_BUF'}
        assert len(out) == 2
        assert out['week'].eq(1).all()
        # The bad game is named in a warning, not silently dropped.
        assert '2026_01_NYJ_NE' in caplog.text

    def test_only_the_bad_game_is_dropped_when_mixed_with_more_good_games(self, raw, caplog):
        """A single malformed game must not take any other game down with it."""
        from ingest import aggregate_team_game_stats
        plays = raw.game(
            raw.play(game_id='2026_01_KC_BUF', week=1),
            raw.rush(4.0, game_id='2026_01_KC_BUF', week=1),
            raw.play(game_id='2026_01_NYJ_NE', home_team='NE', away_team='NYJ',
                     posteam='NYJ', defteam='NE', week=math.nan),
            raw.rush(4.0, game_id='2026_01_NYJ_NE', home_team='NE', away_team='NYJ',
                     posteam='NYJ', defteam='NE', week=math.nan),
            raw.play(game_id='2026_01_SF_LA', home_team='LA', away_team='SF',
                     posteam='SF', defteam='LA', week=1),
            raw.rush(4.0, game_id='2026_01_SF_LA', home_team='LA', away_team='SF',
                     posteam='SF', defteam='LA', week=1),
        )
        with caplog.at_level('WARNING', logger='ingest'):
            out = aggregate_team_game_stats(plays, 2026)
        assert set(out['game_id']) == {'2026_01_KC_BUF', '2026_01_SF_LA'}
        assert len(out) == 4


# ---------------------------------------------------------------------------
# Synthetic games — every tricky case in spec §11
# ---------------------------------------------------------------------------

def _one(raw, *frames, season=2026):
    """Aggregate a synthetic game and return KC's row (the away team in the defaults)."""
    from ingest import aggregate_team_game_stats
    out = aggregate_team_game_stats(raw.game(*frames), season)
    return team_game_row(out, out['game_id'].iloc[0], 'KC')


class TestEfficiencySet:
    def test_kneel_is_not_an_efficiency_play_but_is_a_rushing_attempt(self, raw):
        row = _one(raw, raw.play(), raw.rush(3.0), raw.kneel())
        assert row['plays'] == 2
        assert row['rush_plays'] == 1
        assert row['rushing_attempts'] == 2  # ESPN counts the kneel as a carry
        assert row['rushing_yards'] == 2     # 3 - 1

    def test_two_point_try_is_kept_and_has_no_down(self, raw):
        """2-pt stays in the efficiency set; early + late come up one short (spec §4)."""
        two_pt = raw.play(two_point_attempt=1.0, down=float('nan'), yardline_100=2.0, complete_pass=0.0,
                          yards_gained=0.0, passing_yards=float('nan'), epa=-0.95, success=0.0)
        row = _one(raw, raw.play(down=1.0), raw.play(down=3.0), two_pt)
        assert row['plays'] == 3
        assert row['early_plays'] + row['late_plays'] == 2
        # ...but official counts exclude it
        assert row['attempts'] == 2
        assert row['completions'] == 2
        assert row['team_targets'] == 2
        assert row['total_plays'] == 2

    def test_penalty_wiped_pass_counts_for_epa_but_never_explodes(self, raw):
        """nflverse keeps pass = 1 on a wiped pass, with EPA from the flag and 0 yards."""
        wiped = raw.no_play(**{'pass': 1.0}, complete_pass=0.0, yards_gained=0.0, epa=-0.8, success=0.0)
        row = _one(raw, raw.play(yards_gained=25.0, passing_yards=25.0), wiped)
        assert row['plays'] == 2
        assert row['explosive_plays'] == 1
        assert row['attempts'] == 1
        assert row['penalties'] == 1

    def test_success_and_first_down_rates(self, raw):
        row = _one(raw, raw.play(epa=0.4, success=1.0, first_down=1.0, first_down_pass=1.0),
                   raw.play(epa=-0.4, success=0.0), raw.rush(2.0, epa=-0.1, success=0.0), raw.rush(12.0, epa=0.9, success=1.0, first_down=1.0, first_down_rush=1.0))
        assert row['success_rate'] == approx(0.5)
        assert row['first_down_rate'] == approx(0.5)
        assert row['pass_success_rate'] == approx(0.5)
        assert row['rush_first_down_rate'] == approx(0.5)
        assert row['epa_per_play'] == approx(0.2)

    def test_early_and_late_downs(self, raw):
        row = _one(raw, raw.play(down=1.0, epa=0.1), raw.play(down=2.0, epa=0.3), raw.play(down=3.0, epa=-0.5), raw.play(down=4.0, epa=0.9))
        assert (row['early_plays'], row['late_plays']) == (2, 2)
        assert row['early_epa_per_play'] == approx(0.2)
        assert row['late_epa_per_play'] == approx(0.2)


class TestExplosives:
    def test_thresholds(self, raw):
        row = _one(raw,
                   raw.play(yards_gained=20.0, passing_yards=20.0),   # explosive pass
                   raw.play(yards_gained=19.0, passing_yards=19.0),   # not
                   raw.play(yards_gained=30.0, passing_yards=30.0, complete_pass=0.0),  # incomplete: not
                   raw.rush(10.0),                                    # explosive rush
                   raw.rush(9.0))                                     # not
        assert (row['explosive_pass'], row['explosive_rush'], row['explosive_plays']) == (1, 1, 2)
        assert row['explosive_rate'] == approx(2 / 5)

    def test_scramble_is_an_explosive_run_but_a_pass_play(self, raw):
        """pass = 1, rush = 0 on scrambles: EPA sits in the pass split, the 10+ yards in explosive_rush."""
        row = _one(raw, raw.scramble(12.0, epa=1.1), raw.play(epa=0.3))
        assert (row['pass_plays'], row['rush_plays']) == (2, 0)
        assert row['pass_epa_per_play'] == approx(0.7)
        assert (row['explosive_rush'], row['explosive_pass']) == (1, 0)
        assert row['rushing_attempts'] == 1   # a scramble is a carry in the official count
        assert row['attempts'] == 1           # ...and not a pass attempt
        assert row['team_targets'] == 1


class TestTurnovers:
    def test_interception_and_own_lost_fumble(self, raw):
        pick = raw.play(interception=1.0, complete_pass=0.0, epa=-4.0, success=0.0, passing_yards=float('nan'), yards_gained=0.0)
        lost = raw.rush(2.0, fumble=1.0, fumble_lost=1.0, fumbled_1_team='KC', fumbled_1_player_id='RB1', epa=-3.0, success=0.0)
        row = _one(raw, pick, lost, raw.play())
        assert (row['turnovers'], row['interceptions'], row['fumbles_lost']) == (2, 1, 1)
        assert row['epa_lost_turnovers'] == approx(-7.0)

    def test_pick_the_defence_fumbles_back_is_one_turnover(self, raw):
        """interception AND fumble_lost on one row, but BUF (the defence) fumbled: 1, not 2 (spec §4)."""
        play = raw.play(interception=1.0, complete_pass=0.0, fumble=1.0, fumble_lost=1.0, fumbled_1_team='BUF',
                        epa=-2.5, success=0.0, passing_yards=float('nan'), yards_gained=0.0)
        row = _one(raw, play)
        assert (row['turnovers'], row['interceptions'], row['fumbles_lost']) == (1, 1, 0)
        assert row['epa_lost_turnovers'] == approx(-2.5)  # counted once

    def test_defensive_fumble_the_offence_recovers_is_not_a_giveaway(self, raw):
        """fumble_lost = 1 with fumbled_1_team = the defence: nothing for the offence (spec §4)."""
        play = raw.play(fumble=1.0, fumble_lost=1.0, fumbled_1_team='BUF', epa=0.9)
        row = _one(raw, play)
        assert (row['turnovers'], row['fumbles_lost']) == (0, 0)
        assert row['epa_lost_turnovers'] == 0.0

    def test_fumble_recovered_by_the_offence_itself_is_not_a_turnover(self, raw):
        play = raw.rush(3.0, fumble=1.0, fumble_lost=0.0, fumbled_1_team='KC', fumbled_1_player_id='RB1', epa=-0.7)
        row = _one(raw, play)
        assert (row['turnovers'], row['fumbles_lost']) == (0, 0)

    def test_strip_sack_counts_in_both_cost_rows(self, raw):
        """A strip-sack is a sack AND a turnover; the overlap is intended (spec §4)."""
        strip = raw.sack(9.0, fumble=1.0, fumble_lost=1.0, fumbled_1_team='KC', fumbled_1_player_id='QB1', epa=-5.0)
        row = _one(raw, strip, raw.play())
        assert (row['sacks'], row['sack_yards'], row['turnovers']) == (1, 9, 1)
        assert row['epa_lost_sacks'] == approx(-5.0)
        assert row['epa_lost_turnovers'] == approx(-5.0)
        assert row['net_passing_yards'] == 8 - 9
        assert row['total_yards'] == 8 - 9

    # Spec §4's other documented limitation, 2025_14_PHI_LAC (a pick plus a SEPARATE
    # lost fumble on one snap counts 1), has no test on purpose: the second fumble is
    # recorded only in fumbled_2_team, a column neither the aggregator nor the fixture
    # carries, so the only row a test could build is the one above — identical input,
    # opposite assertion. It is documented in spec §4 and in _team_game_costs.

    @pytest.mark.xfail(strict=True, reason='spec section 4 keys turnovers by posteam, so a punt the '
                       'RECEIVING team muffs (2026_01_CHI_CAR) is credited to nobody; ESPN charges the receiver')
    def test_muffed_punt_charged_to_the_receiving_team(self, raw):
        from ingest import aggregate_team_game_stats
        muff = raw.kick('punt', posteam='KC', defteam='BUF', fumble=1.0, fumble_lost=1.0, fumbled_1_team='BUF', epa=2.0)
        out = aggregate_team_game_stats(raw.game(raw.play(), muff), 2026)
        assert team_game_row(out, '2026_01_KC_BUF', 'BUF')['turnovers'] == 1


class TestPenalties:
    def test_own_flags_only_with_the_sign_flip(self, raw):
        """Offence flag: its EPA counts as is. Defence flag: the EPA is the opponent's gain, so subtract.
        The opponent's flags are theirs (spec §4)."""
        own_offence = raw.no_play(penalty_team='KC', penalty_yards=10.0, epa=-1.2)
        own_defence = raw.no_play(posteam='BUF', defteam='KC', penalty_team='KC', penalty_yards=15.0, epa=0.8)
        theirs = raw.no_play(penalty_team='BUF', penalty_yards=5.0, epa=0.4)
        row = _one(raw, raw.play(), own_offence, own_defence, theirs)
        assert (row['penalties'], row['penalty_yards']) == (2, 25)
        assert row['epa_lost_penalties'] == approx(-1.2 - 0.8)

    def test_penalty_first_down_lives_on_the_no_play_row(self, raw):
        """A defensive flag that moves the chains is first_down_penalty on a no_play row."""
        dpi = raw.no_play(penalty_team='BUF', penalty_yards=22.0, epa=1.5, first_down=1.0, first_down_penalty=1.0)
        row = _one(raw, raw.play(first_down=1.0, first_down_pass=1.0), dpi)
        assert (row['first_downs'], row['first_downs_pass'], row['first_downs_penalty']) == (2, 1, 1)

    def test_first_downs_are_the_sum_of_parts(self, raw):
        """One play can be a rush AND a penalty first down; only the sum reaches ESPN (spec §4)."""
        both = raw.rush(6.0, first_down=1.0, first_down_rush=1.0, first_down_penalty=1.0, penalty=1.0,
                        penalty_team='BUF', penalty_yards=5.0)
        row = _one(raw, both)
        assert row['first_downs'] == 2


class TestTraditional:
    def test_passing_rushing_and_totals(self, raw):
        row = _one(raw,
                   raw.play(yards_gained=12.0, passing_yards=12.0),
                   raw.play(complete_pass=0.0, yards_gained=0.0, passing_yards=float('nan'), epa=-0.4, success=0.0),
                   raw.sack(6.0),
                   raw.rush(5.0), raw.rush(-2.0))
        assert (row['completions'], row['attempts'], row['sacks'], row['sack_yards']) == (1, 2, 1, 6)
        assert row['net_passing_yards'] == 12 - 6
        assert row['yards_per_pass'] == approx(6 / 3)   # net passing / (attempts + sacks)
        assert (row['rushing_attempts'], row['rushing_yards']) == (2, 3)
        assert row['yards_per_rush'] == approx(1.5)
        assert row['total_plays'] == 2 + 1 + 2
        assert row['total_yards'] == 12 - 6 + 3
        assert row['yards_per_play'] == approx(9 / 5)

    def test_two_point_try_sack_is_excluded_from_sacks_and_yards(self, raw):
        """Spec §4 Total Yards: "2-pt excluded" — official box scores don't count
        2-point plays in team stats at all, sacks included. A sack on the try must
        not add to sacks, sack_yards, net_passing_yards or total_yards."""
        two_pt_sack = raw.sack(4.0, two_point_attempt=1.0, down=float('nan'), yardline_100=2.0)
        row = _one(raw, raw.play(yards_gained=12.0, passing_yards=12.0), raw.sack(6.0), two_pt_sack)
        assert (row['sacks'], row['sack_yards']) == (1, 6)
        assert row['net_passing_yards'] == 12 - 6
        assert row['total_yards'] == 12 - 6

    def test_lateral_keeps_every_passing_yard_in_the_team_total(self, raw):
        """A real lateral: 2026_01_BUF_HOU play 385 — Allen to Coleman for 1, lateral to
        Shakir for 10. nflverse records passing_yards 11 and yards_gained 11 but
        receiving_yards only 1, so the receiver's line is 10 short of the team's
        (spec §10.3). team_game_stats reads passing_yards, never receiving_yards, so the
        play must land as ONE completion worth 11 passing yards — not one worth 1, not
        two targets, and not a rush."""
        row = _one(raw, raw.play(air_yards=4.0, yards_gained=11.0, passing_yards=11.0,
                                 receiver_player_id='WR1'))
        assert (row['completions'], row['attempts'], row['team_targets']) == (1, 1, 1)
        assert (row['net_passing_yards'], row['total_yards']) == (11, 11)
        assert (row['rushing_attempts'], row['rushing_yards']) == (0, 0)

    def test_the_real_lateral_is_inside_the_golden_passing_total(self, pbp_fixture, team_game_rows):
        """The same play, from the fixture. `receiving_yards` is deliberately not a
        fixture column (the aggregator never reads it), so the proof that the team keeps
        all 11 is BUF's stored 323 net passing yards: 313 if the receiver's 1 were used,
        and 20 completions rather than 21 (spec §10.3)."""
        play = pbp_fixture[(pbp_fixture['game_id'] == BUF_HOU) & (pbp_fixture['play_id'] == 385)]
        assert len(play) == 1
        assert play['complete_pass'].iloc[0] == 1
        assert play['passing_yards'].iloc[0] == 11 and play['yards_gained'].iloc[0] == 11
        buf = team_game_row(team_game_rows, BUF_HOU, 'BUF')
        assert buf['net_passing_yards'] == 323
        assert buf['completions'] == 20

    def test_safety_is_a_run_tackled_in_the_offence_s_own_end_zone(self, raw):
        """A real safety: the ball is on the KC 2 (yardline_100 98) and the carrier is
        dropped in the end zone. The 2 points belong to the defence and are not a
        team_game_stats column, so what must be true is what is NOT credited — no TD, no
        turnover — while the drive and its clock still count. nflverse's `safety` flag is
        not a column this aggregator reads, so the fixture does not carry it."""
        row = _one(raw, raw.rush(-2.0, drive=1.0, yardline_100=98.0, epa=-2.6, success=0.0,
                                 drive_time_of_possession='2:30'))
        assert (row['rushing_attempts'], row['rushing_yards']) == (1, -2)
        assert (row['total_plays'], row['total_yards']) == (1, -2)
        assert (row['def_st_tds'], row['turnovers'], row['fumbles_lost']) == (0, 0, 0)
        assert (row['total_drives'], row['time_of_possession_seconds']) == (1, 150)

    def test_third_and_fourth_down_exclude_no_play_rows(self, raw):
        """Attempts are snaps from scrimmage on that down; a wiped play is not one (spec §4)."""
        row = _one(raw,
                   raw.play(down=3.0, first_down=1.0, first_down_pass=1.0),
                   raw.play(down=3.0, complete_pass=0.0, yards_gained=0.0, epa=-0.6, success=0.0),
                   raw.no_play(down=3.0),
                   raw.kneel(down=3.0),
                   raw.rush(1.0, down=4.0, first_down=1.0, first_down_rush=1.0),
                   raw.kick('punt', down=4.0))
        assert (row['third_down_att'], row['third_down_conv']) == (3, 1)
        assert (row['fourth_down_att'], row['fourth_down_conv']) == (1, 1)

    def test_touchdown_is_a_conversion(self, raw):
        td = raw.play(down=3.0, yards_gained=15.0, passing_yards=15.0, pass_touchdown=1.0, td_team='KC', first_down=1.0, first_down_pass=1.0)
        row = _one(raw, td)
        assert (row['third_down_att'], row['third_down_conv']) == (1, 1)


class TestRedZone:
    def test_trip_and_touchdown_are_drive_level(self, raw):
        row = _one(raw,
                   raw.play(drive=1.0, yardline_100=40.0),
                   raw.play(drive=1.0, yardline_100=18.0),
                   raw.rush(2.0, drive=1.0, yardline_100=4.0, rush_touchdown=1.0, td_team='KC', first_down=1.0, first_down_rush=1.0),
                   raw.kick('extra_point', drive=1.0, yardline_100=15.0),
                   raw.play(drive=2.0, yardline_100=19.0),
                   raw.play(drive=2.0, yardline_100=12.0, complete_pass=0.0, yards_gained=0.0),
                   raw.kick('field_goal', drive=2.0, yardline_100=12.0),
                   raw.play(drive=3.0, yardline_100=60.0))
        assert (row['red_zone_trips'], row['red_zone_tds']) == (2, 1)

    def test_extra_point_from_the_15_is_not_a_trip(self, raw):
        """Play-level counting gives BUF 6 trips because XPs snap from the 15 (spec §4)."""
        row = _one(raw, raw.play(drive=1.0, yardline_100=45.0, yards_gained=45.0, passing_yards=45.0, pass_touchdown=1.0, td_team='KC'),
                   raw.kick('extra_point', drive=1.0, yardline_100=15.0))
        assert row['red_zone_trips'] == 0

    def test_red_zone_pick_six_is_not_credited_to_the_offence(self, raw):
        pick_six = raw.play(drive=1.0, yardline_100=10.0, interception=1.0, complete_pass=0.0, yards_gained=0.0,
                            passing_yards=float('nan'), epa=-9.0, success=0.0, td_team='BUF')
        row = _one(raw, raw.play(drive=1.0, yardline_100=30.0), pick_six)
        assert (row['red_zone_trips'], row['red_zone_tds']) == (1, 0)
        assert row['turnovers'] == 1

    def test_two_point_try_is_not_a_trip(self, raw):
        two_pt = raw.play(drive=1.0, two_point_attempt=1.0, down=float('nan'), yardline_100=2.0, complete_pass=0.0, yards_gained=0.0, passing_yards=float('nan'))
        row = _one(raw, raw.play(drive=1.0, yardline_100=35.0, yards_gained=35.0, passing_yards=35.0, pass_touchdown=1.0, td_team='KC'), two_pt)
        assert row['red_zone_trips'] == 0


class TestDrivesAndPossession:
    def test_drive_without_a_scrimmage_play_still_owns_its_clock(self, raw):
        """TEN drive 6 in week 1 is a kickoff then a turnover on the return (spec §4)."""
        row = _one(raw,
                   raw.kick('kickoff', drive=1.0, drive_time_of_possession='0:05'),
                   raw.kick('kickoff', drive=2.0, drive_time_of_possession='0:10'),
                   raw.play(drive=2.0, drive_time_of_possession='0:10'),
                   raw.play(drive=2.0, drive_time_of_possession='0:10'))
        assert row['total_drives'] == 2
        assert row['time_of_possession_seconds'] == 15

    def test_rows_with_a_null_drive_are_ignored(self, raw):
        """4 week-1 rows have a posteam but no drive (XPs after a defensive TD, END GAME)."""
        row = _one(raw, raw.play(drive=1.0, drive_time_of_possession='1:00'),
                   raw.kick('extra_point', drive=float('nan'), drive_time_of_possession=None))
        assert row['total_drives'] == 1
        assert row['time_of_possession_seconds'] == 60

    def test_possession_is_null_when_no_drive_has_a_clock(self, raw):
        row = _one(raw, raw.play(drive=1.0, drive_time_of_possession=None), raw.play(drive=2.0, drive_time_of_possession='junk'))
        assert row['total_drives'] == 2
        assert row['time_of_possession_seconds'] is None

    def test_overtime_clock_is_just_more_seconds(self, raw):
        row = _one(raw, raw.play(drive=1.0, drive_time_of_possession='36:51'), raw.play(drive=2.0, drive_time_of_possession='31:35'))
        assert row['time_of_possession_seconds'] == 68 * 60 + 26


class TestDefensiveAndSpecialTeamsTouchdowns:
    def test_pick_six_goes_to_the_defence(self, raw):
        from ingest import aggregate_team_game_stats
        pick_six = raw.play(interception=1.0, complete_pass=0.0, yards_gained=0.0, passing_yards=float('nan'), epa=-8.0, success=0.0, td_team='BUF')
        out = aggregate_team_game_stats(raw.game(pick_six), 2026)
        assert team_game_row(out, '2026_01_KC_BUF', 'BUF')['def_st_tds'] == 1
        assert team_game_row(out, '2026_01_KC_BUF', 'KC')['def_st_tds'] == 0

    def test_kickoff_return_touchdown_counts_even_though_posteam_is_the_returner(self, raw):
        """nflverse puts the RECEIVING team in posteam on kickoffs, so td_team == posteam there."""
        row = _one(raw, raw.kick('kickoff', posteam='KC', defteam='BUF', td_team='KC', epa=6.0, yards_gained=100.0))
        assert row['def_st_tds'] == 1

    def test_offensive_touchdown_is_not_counted(self, raw):
        row = _one(raw, raw.play(yards_gained=30.0, passing_yards=30.0, pass_touchdown=1.0, td_team='KC'))
        assert row['def_st_tds'] == 0


class TestTargets:
    def test_team_targets_match_the_receiver_aggregator_set(self, raw):
        """A receiver on a non-sack, non-scramble pass attempt, 2-pt excluded (spec §5)."""
        row = _one(raw,
                   raw.play(receiver_player_id='WR1'),
                   raw.play(receiver_player_id='TE1', complete_pass=0.0, yards_gained=0.0),
                   raw.play(receiver_player_id=None, complete_pass=0.0, yards_gained=0.0),   # throwaway
                   raw.sack(5.0, receiver_player_id=None),
                   raw.scramble(8.0),
                   raw.play(receiver_player_id='WR1', two_point_attempt=1.0, down=float('nan'), yardline_100=2.0, complete_pass=0.0, yards_gained=0.0))
        assert row['team_targets'] == 2


class TestNullsAndEmptyInputs:
    def test_zero_pass_attempts_leave_pass_rates_null(self, raw):
        row = _one(raw, raw.rush(4.0), raw.rush(6.0))
        assert row['pass_plays'] == 0
        for col in ('pass_epa_per_play', 'pass_success_rate', 'pass_first_down_rate', 'yards_per_pass'):
            assert row[col] is None, col
        assert (row['attempts'], row['completions'], row['team_targets'], row['net_passing_yards']) == (0, 0, 0, 0)
        assert row['rush_epa_per_play'] is not None

    def test_zero_rush_attempts_leave_rush_rates_null(self, raw):
        row = _one(raw, raw.play(), raw.play())
        assert row['rush_plays'] == 0
        for col in ('rush_epa_per_play', 'rush_success_rate', 'rush_first_down_rate', 'yards_per_rush'):
            assert row[col] is None, col
        assert (row['rushing_attempts'], row['rushing_yards']) == (0, 0)

    def test_team_that_never_had_the_ball_still_gets_a_row(self, raw):
        from ingest import aggregate_team_game_stats, TEAM_GAME_STATS_INT_COLS, TEAM_GAME_STATS_RATE_COLS
        out = aggregate_team_game_stats(raw.game(raw.play(), raw.rush(3.0)), 2026)
        buf = team_game_row(out, '2026_01_KC_BUF', 'BUF')
        assert (buf['opponent_id'], buf['home_away'], buf['week']) == ('KC', 'home', 1)
        for col in TEAM_GAME_STATS_INT_COLS:
            assert buf[col] == 0, col
        for col in TEAM_GAME_STATS_RATE_COLS:
            assert buf[col] is None, col
        assert buf['time_of_possession_seconds'] == 0
        assert buf['epa_lost_turnovers'] == 0.0

    def test_no_plays_yet_returns_an_empty_frame_with_the_columns(self, raw):
        from ingest import aggregate_team_game_stats, TEAM_GAME_STATS_COLS
        empty = raw.game(raw.play()).iloc[0:0]
        out = aggregate_team_game_stats(empty, 2026)
        assert len(out) == 0
        assert list(out.columns) == TEAM_GAME_STATS_COLS
        assert len(aggregate_team_game_stats(pd.DataFrame(), 2026)) == 0

    def test_playoff_rows_are_skipped(self, raw):
        from ingest import aggregate_team_game_stats
        post = raw.play(game_id='2026_19_KC_BUF', week=19, season_type='POST')
        out = aggregate_team_game_stats(raw.game(post, raw.play()), 2026)
        assert out['game_id'].tolist() == ['2026_01_KC_BUF', '2026_01_KC_BUF']

    def test_nulls_in_flag_columns_do_not_crash(self, raw):
        """Game-start rows have NaN in nearly every column."""
        blank = raw.play(play_type=None, posteam=None, defteam=None, down=float('nan'), drive=float('nan'),
                         **{'pass': 0.0}, pass_attempt=float('nan'), rush_attempt=float('nan'), sack=float('nan'),
                         complete_pass=float('nan'), two_point_attempt=float('nan'), kickoff_attempt=float('nan'),
                         first_down=float('nan'), epa=-0.0, yards_gained=float('nan'), yardline_100=float('nan'),
                         drive_time_of_possession=None, passer_player_id=None, receiver_player_id=None)
        row = _one(raw, blank, raw.play(), raw.rush(5.0))
        assert row['plays'] == 2
        assert row['total_drives'] == 1

    def test_season_agnostic(self, raw):
        """A 2025 game gives the same shape; season and week come from the call and the rows."""
        row = _one(raw, raw.play(game_id='2025_07_KC_BUF', season=2025, week=7), raw.rush(4.0, game_id='2025_07_KC_BUF', season=2025, week=7), season=2025)
        assert (row['season'], row['week'], row['game_id']) == (2025, 7, '2025_07_KC_BUF')
        assert row['plays'] == 2

    def test_rows_are_sorted_by_game_then_away_home(self, raw):
        from ingest import aggregate_team_game_stats
        second = raw.play(game_id='2026_01_SF_LA', home_team='LA', away_team='SF', posteam='SF', defteam='LA')
        out = aggregate_team_game_stats(raw.game(second, raw.play()), 2026)
        assert list(zip(out['game_id'], out['team_id'])) == [
            ('2026_01_KC_BUF', 'KC'), ('2026_01_KC_BUF', 'BUF'), ('2026_01_SF_LA', 'SF'), ('2026_01_SF_LA', 'LA')]
