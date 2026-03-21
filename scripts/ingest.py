#!/usr/bin/env python3
"""nflverse → Supabase ETL pipeline for Yards Per Pass.

Downloads play-by-play and roster data from nflverse GitHub releases,
aggregates team and QB season stats, and upserts into Supabase PostgreSQL.
"""

import argparse
import logging
import os
import sys
import time
from datetime import datetime, timezone
from functools import wraps

import pandas as pd
import psycopg2
from psycopg2.extras import execute_values
from dotenv import load_dotenv

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("ingest")


class DataQualityError(ValueError):
    """Raised when downloaded data fails sanity checks. Do not retry."""
    pass


def retry(max_retries=3, delay=5, backoff=2):
    """Retry decorator with exponential backoff for network calls."""
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            retries = 0
            current_delay = delay
            while True:
                try:
                    return func(*args, **kwargs)
                except DataQualityError:
                    raise  # Fast-fail: bad data won't fix itself on retry
                except Exception as e:
                    retries += 1
                    if retries > max_retries:
                        raise
                    log.warning("Retry %d/%d after error: %s", retries, max_retries, e)
                    time.sleep(current_delay)
                    current_delay *= backoff
        return wrapper
    return decorator

load_dotenv()

# --- Constants ---
FIRST_SEASON = 2020

def _detect_current_season() -> int:
    """Auto-detect NFL season from date. Season starts in September."""
    now = datetime.now()
    return now.year if now.month >= 9 else now.year - 1

CURRENT_SEASON = _detect_current_season()
PBP_URL = "https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_{season}.parquet"
ROSTER_URL = "https://github.com/nflverse/nflverse-data/releases/download/weekly_rosters/roster_weekly_{season}.parquet"
PARTICIPATION_URL = "https://github.com/nflverse/nflverse-data/releases/download/pbp_participation/pbp_participation_{season}.parquet"

REQUIRED_ROSTER_COLS = ['gsis_id', 'position']

REQUIRED_PBP_COLS = [
    'play_type', 'season_type', 'two_point_attempt', 'epa', 'success',
    'posteam', 'defteam', 'pass_attempt', 'rush_attempt', 'qb_dropback',
    'passer_player_id', 'passer_player_name', 'rusher_player_id', 'rusher_player_name',
    'complete_pass', 'sack', 'qb_scramble', 'air_yards', 'yards_gained',
    'cpoe', 'passing_yards', 'pass_touchdown', 'interception',
    'rush_touchdown', 'rushing_yards', 'game_id', 'season', 'week',
    'home_team', 'away_team', 'result',
    'fumble', 'fumble_lost', 'fumbled_1_player_id',
    'receiver_player_id', 'receiver_player_name',
    'receiving_yards', 'yards_after_catch',
    'total_home_score', 'total_away_score',
]

# --- Run gap mapping ---
GAP_MAP = {
    ('left', 'end'): 'LE',
    ('left', 'tackle'): 'LT',
    ('left', 'guard'): 'LG',
    ('middle', None): 'M',
    ('middle', 'guard'): 'M',
    ('middle', 'tackle'): 'M',
    ('right', 'guard'): 'RG',
    ('right', 'tackle'): 'RT',
    ('right', 'end'): 'RE',
}


def map_run_gap(run_location, run_gap):
    """Map nflverse run_location + run_gap to one of 7 gap labels."""
    return GAP_MAP.get((run_location, run_gap))


def passer_rating(comp: int, att: int, yds: int, td: int, ints: int) -> float:
    """NFL passer rating formula. Returns 0-158.3 scale."""
    if att == 0:
        return 0.0
    a = max(0.0, min(((comp / att) - 0.3) * 5, 2.375))
    b = max(0.0, min(((yds / att) - 3) * 0.25, 2.375))
    c = max(0.0, min((td / att) * 20, 2.375))
    d = max(0.0, min(2.375 - ((ints / att) * 25), 2.375))
    return round(((a + b + c + d) / 6) * 100, 1)


def make_slug(name: str) -> str:
    """Convert 'Patrick Mahomes' to 'patrick-mahomes'."""
    import re
    slug = name.lower().strip()
    slug = re.sub(r"[^a-z0-9\s-]", "", slug)
    slug = re.sub(r"\s+", "-", slug)
    slug = re.sub(r"-+", "-", slug)
    return slug.strip("-")


@retry(max_retries=3, delay=5)
def download_pbp(season: int) -> pd.DataFrame:
    """Download play-by-play Parquet from nflverse."""
    url = PBP_URL.format(season=season)
    log.info("Downloading PBP for %d...", season)
    df = pd.read_parquet(url)
    if len(df) < 1000:
        raise DataQualityError(f"PBP data for {season} suspiciously small ({len(df)} rows) — expected 40,000+. Aborting.")
    missing = [c for c in REQUIRED_PBP_COLS if c not in df.columns]
    if missing:
        raise ValueError(f"Missing columns in PBP data: {missing}")
    return df


@retry(max_retries=3, delay=5)
def download_roster(season: int) -> pd.DataFrame:
    """Download roster Parquet from nflverse."""
    url = ROSTER_URL.format(season=season)
    log.info("Downloading roster for %d...", season)
    df = pd.read_parquet(url)
    if len(df) < 100:
        raise DataQualityError(f"Roster data for {season} suspiciously small ({len(df)} rows) — expected 1,500+. Aborting.")
    missing = [c for c in REQUIRED_ROSTER_COLS if c not in df.columns]
    if missing:
        raise ValueError(f"Missing columns in roster data: {missing}")
    return df


def download_participation(season: int) -> pd.DataFrame | None:
    """Download participation data from nflverse. Returns None if unavailable."""
    url = PARTICIPATION_URL.format(season=season)
    log.info("Downloading participation data for %d...", season)
    try:
        df = pd.read_parquet(url)
        if len(df) < 1000:
            log.warning("Participation data for %d suspiciously small (%d rows)", season, len(df))
            return None
        log.info("Loaded %d participation rows for %d", len(df), season)
        return df
    except Exception as e:
        log.warning("Could not download participation data for %d: %s", season, e)
        return None


def filter_plays(pbp: pd.DataFrame) -> pd.DataFrame:
    """Filter to relevant plays: pass/run/kneel, regular season, no two-point attempts.
    Includes qb_kneel so rushing stats match PFR (kneeldowns count as carries)."""
    mask = (
        pbp['play_type'].isin(['pass', 'run', 'qb_kneel']) &
        (pbp['season_type'] == 'REG') &
        (pbp['two_point_attempt'] != 1)
    )
    filtered = pbp[mask].copy()
    log.info("Filtered to %s plays (from %s raw)", f"{len(filtered):,}", f"{len(pbp):,}")
    return filtered


def aggregate_team_stats(plays: pd.DataFrame, pbp: pd.DataFrame, season: int) -> pd.DataFrame:
    """Aggregate team-level season stats from filtered plays."""
    # Offensive stats
    off = plays.groupby('posteam').agg(
        off_epa_play=('epa', 'mean'),
        off_success_rate=('success', 'mean'),
        plays=('game_id', 'count'),
    ).reset_index().rename(columns={'posteam': 'team_id'})

    # Pass/rush splits
    pass_plays = plays[plays['pass_attempt'] == 1]
    rush_plays = plays[plays['rush_attempt'] == 1]

    off_pass = pass_plays.groupby('posteam').agg(
        off_pass_epa=('epa', 'mean'),
    ).reset_index().rename(columns={'posteam': 'team_id'})

    off_rush = rush_plays.groupby('posteam').agg(
        off_rush_epa=('epa', 'mean'),
    ).reset_index().rename(columns={'posteam': 'team_id'})

    # Pass rate: actual pass attempts (excluding sacks) / total plays
    # nflverse sets pass_attempt=1 on sacks, so we exclude sacks for true attempts
    pass_rate = plays.groupby('posteam').apply(
        lambda x: ((x['pass_attempt'] == 1) & (x['sack'] != 1)).sum() / max(len(x), 1),
        include_groups=False
    ).reset_index().rename(columns={'posteam': 'team_id', 0: 'pass_rate'})

    # Defensive stats
    def_ = plays.groupby('defteam').agg(
        def_epa_play=('epa', 'mean'),
        def_success_rate=('success', 'mean'),
    ).reset_index().rename(columns={'defteam': 'team_id'})

    def_pass = pass_plays.groupby('defteam').agg(
        def_pass_epa=('epa', 'mean'),
    ).reset_index().rename(columns={'defteam': 'team_id'})

    def_rush = rush_plays.groupby('defteam').agg(
        def_rush_epa=('epa', 'mean'),
    ).reset_index().rename(columns={'defteam': 'team_id'})

    # Win/loss records from game results (use unfiltered pbp to ensure all games counted)
    game_results = (
        pbp[pbp['season_type'] == 'REG']
        .groupby('game_id')
        .first()[['home_team', 'away_team', 'result']]
        .dropna(subset=['result'])
        .reset_index()
    )

    home = game_results[['home_team', 'result']].rename(columns={'home_team': 'team_id'})
    home['wins'] = (home['result'] > 0).astype(int)
    home['losses'] = (home['result'] < 0).astype(int)
    home['ties'] = (home['result'] == 0).astype(int)

    away = game_results[['away_team', 'result']].rename(columns={'away_team': 'team_id'})
    away['wins'] = (away['result'] < 0).astype(int)
    away['losses'] = (away['result'] > 0).astype(int)
    away['ties'] = (away['result'] == 0).astype(int)

    records = pd.concat([
        home[['team_id', 'wins', 'losses', 'ties']],
        away[['team_id', 'wins', 'losses', 'ties']],
    ]).groupby('team_id').sum().reset_index()

    # Turnover stats: takeaways (defensive forced turnovers) and giveaways (offensive turnovers)
    int_by_def = plays[plays['interception'] == 1].groupby('defteam').size()
    fum_by_def = plays[plays['fumble_lost'] == 1].groupby('defteam').size()
    takeaways = (int_by_def.add(fum_by_def, fill_value=0)).reset_index()
    takeaways.columns = ['team_id', 'takeaways']
    takeaways['takeaways'] = takeaways['takeaways'].astype(int)

    int_by_off = plays[plays['interception'] == 1].groupby('posteam').size()
    fum_by_off = plays[plays['fumble_lost'] == 1].groupby('posteam').size()
    giveaways = (int_by_off.add(fum_by_off, fill_value=0)).reset_index()
    giveaways.columns = ['team_id', 'giveaways']
    giveaways['giveaways'] = giveaways['giveaways'].astype(int)

    # Merge all
    team_stats = (
        off.merge(off_pass, on='team_id', how='left')
        .merge(off_rush, on='team_id', how='left')
        .merge(pass_rate, on='team_id', how='left')
        .merge(def_, on='team_id', how='left')
        .merge(def_pass, on='team_id', how='left')
        .merge(def_rush, on='team_id', how='left')
        .merge(records, on='team_id', how='left')
        .merge(takeaways, on='team_id', how='left')
        .merge(giveaways, on='team_id', how='left')
    )
    team_stats['takeaways'] = team_stats['takeaways'].fillna(0).astype(int)
    team_stats['giveaways'] = team_stats['giveaways'].fillna(0).astype(int)
    team_stats['turnover_diff'] = team_stats['takeaways'] - team_stats['giveaways']
    team_stats['season'] = season

    log.info("Aggregated stats for %d teams", len(team_stats))
    return team_stats


def aggregate_qb_stats(plays: pd.DataFrame, roster: pd.DataFrame, season: int) -> pd.DataFrame:
    """Aggregate QB season stats from filtered plays."""
    # Identify QB player IDs from roster
    qb_ids = set(roster[roster['position'] == 'QB']['gsis_id'].dropna().unique())

    # --- Dropback stats (qb_dropback == 1) ---
    dropbacks = plays[plays['qb_dropback'] == 1].copy()

    # Fix scramble attribution: on scrambles, passer_player_id and passer_player_name
    # are often NULL but rusher_player_id/name have the QB. Use fillna() to preserve
    # valid passer IDs while backfilling only where missing (avoids overwriting valid
    # data if rusher_player_id is NaN on rare scrambles ~5-10/season).
    scramble_mask = dropbacks['qb_scramble'] == 1
    dropbacks.loc[scramble_mask, 'passer_player_id'] = (
        dropbacks.loc[scramble_mask, 'passer_player_id'].fillna(
            dropbacks.loc[scramble_mask, 'rusher_player_id']
        )
    )
    dropbacks.loc[scramble_mask, 'passer_player_name'] = (
        dropbacks.loc[scramble_mask, 'passer_player_name'].fillna(
            dropbacks.loc[scramble_mask, 'rusher_player_name']
        )
    )

    qb_drop = dropbacks.groupby('passer_player_id').agg(
        player_name=('passer_player_name', 'first'),
        dropback_count=('game_id', 'count'),  # Total dropbacks (for display and epa_per_play calc)
        dropback_epa_sum=('epa', 'sum'),
        dropback_epa_mean=('epa', 'mean'),  # EPA/DB: mean() correctly skips NaN in both num & denom
        completions=('complete_pass', 'sum'),
        sacks=('sack', 'sum'),
        scrambles=('qb_scramble', 'sum'),
        cpoe=('cpoe', lambda x: x.dropna().mean()),
        touchdowns=('pass_touchdown', 'sum'),
        interceptions=('interception', 'sum'),
        games=('game_id', 'nunique'),
        success_rate_raw=('success', lambda x: x.dropna().mean()),
    ).reset_index().rename(columns={'passer_player_id': 'player_id'})

    # aDOT: compute on true pass attempts only (exclude sacks and scrambles)
    # Scrambles can have pass_attempt=1 in nflverse but air_yards is meaningless
    adot_plays = dropbacks[
        (dropbacks['pass_attempt'] == 1) &
        (dropbacks['sack'] != 1) &
        (dropbacks['qb_scramble'] != 1)
    ]
    adot_stats = adot_plays.groupby('passer_player_id')['air_yards'].apply(
        lambda x: x.dropna().mean()
    ).reset_index().rename(columns={'passer_player_id': 'player_id', 'air_yards': 'adot'})
    qb_drop = qb_drop.merge(adot_stats, on='player_id', how='left')

    # QB success rate: exclude sacks (OL failure, not QB decision), stored as decimal 0-1
    non_sack_dropbacks = dropbacks[dropbacks['sack'] != 1]
    sack_excl_success = non_sack_dropbacks.groupby('passer_player_id')['success'].apply(
        lambda x: x.dropna().mean()
    ).reset_index().rename(columns={'passer_player_id': 'player_id', 'success': 'success_rate'})
    qb_drop = qb_drop.merge(sack_excl_success, on='player_id', how='left')
    qb_drop.drop(columns=['success_rate_raw'], inplace=True)

    # Pass attempts: nflverse sets pass_attempt=1 on sacks too, so we must exclude them
    # PFR-style attempts = completions + incompletions + INTs (no sacks, no scrambles)
    true_passes = dropbacks[(dropbacks['pass_attempt'] == 1) & (dropbacks['sack'] != 1)]
    pass_attempts = true_passes.groupby('passer_player_id').size().reset_index(name='attempts')
    pass_attempts.rename(columns={'passer_player_id': 'player_id'}, inplace=True)
    qb_drop = qb_drop.merge(pass_attempts, on='player_id', how='left')
    qb_drop['attempts'] = qb_drop['attempts'].fillna(0).astype(int)

    # Passing yards: use nflverse passing_yards column on true pass attempts only
    # Exclude sacks (pass_attempt==1 on sacks in nflverse) and scrambles
    actual_passes = dropbacks[(dropbacks['pass_attempt'] == 1) & (dropbacks['sack'] != 1)]
    pass_yards = actual_passes.groupby('passer_player_id')['passing_yards'].apply(
        lambda s: s.fillna(0).sum()
    )
    pass_yards = pass_yards.reset_index().rename(
        columns={'passer_player_id': 'player_id', 'passing_yards': 'passing_yards'}
    )
    qb_drop = qb_drop.merge(pass_yards, on='player_id', how='left')
    qb_drop['passing_yards'] = qb_drop['passing_yards'].fillna(0).astype(int)

    # Sack yards lost: on sack plays, yards_gained is negative (yards lost)
    sack_plays = dropbacks[dropbacks['sack'] == 1]
    sack_yards = sack_plays.groupby('passer_player_id')['yards_gained'].apply(
        lambda s: s.fillna(0).sum()
    ).reset_index().rename(
        columns={'passer_player_id': 'player_id', 'yards_gained': 'sack_yards_lost'}
    )
    # sack_yards_lost is negative (e.g., -7 means 7 yards lost), so we use abs() in formula
    qb_drop = qb_drop.merge(sack_yards, on='player_id', how='left')
    qb_drop['sack_yards_lost'] = qb_drop['sack_yards_lost'].fillna(0)

    # Derived passing stats
    qb_drop['completion_pct'] = qb_drop.apply(
        lambda r: (r['completions'] / r['attempts'] * 100) if r['attempts'] > 0 else 0.0, axis=1
    )
    qb_drop['ypa'] = qb_drop.apply(
        lambda r: r['passing_yards'] / r['attempts'] if r['attempts'] > 0 else 0.0, axis=1
    )
    qb_drop['epa_per_db'] = qb_drop['dropback_epa_mean']  # mean() handles NaN correctly (skips in both num & denom)

    # ANY/A: Adjusted Net Yards per Attempt = (yards + 20*TD - 45*INT + sack_yards_lost) / (att + sacks)
    # sack_yards_lost is already negative, so adding it subtracts the yards lost
    qb_drop['any_a'] = qb_drop.apply(
        lambda r: (r['passing_yards'] + 20 * r['touchdowns'] - 45 * r['interceptions'] + r['sack_yards_lost']) / (r['attempts'] + r['sacks'])
        if (r['attempts'] + r['sacks']) > 0 else 0.0, axis=1
    )

    # Passer rating from season totals
    qb_drop['passer_rating'] = qb_drop.apply(
        lambda r: passer_rating(
            int(r['completions']), int(r['attempts']),
            int(r['passing_yards']), int(r['touchdowns']), int(r['interceptions'])
        ), axis=1
    )

    # --- Rush stats: ALL QB rushing plays (designed + scrambles) via rush_attempt ---
    # nflverse sets rush_attempt=1 on both designed runs AND scrambles.
    # Grouping by rusher_player_id captures everything in one pass.
    # filter_plays() already excludes kneeldowns (play_type not in ['pass','run']).
    qb_rushes = plays[
        (plays['rush_attempt'] == 1) &
        (plays['rusher_player_id'].isin(qb_ids))
    ]
    rush_stats = qb_rushes.groupby('rusher_player_id').agg(
        rush_attempts=('epa', 'count'),
        rush_epa_sum=('epa', 'sum'),
        rush_yards=('yards_gained', lambda s: s.fillna(0).sum()),  # yards_gained matches PFR
        rush_tds=('rush_touchdown', 'sum'),
    ).reset_index().rename(columns={'rusher_player_id': 'player_id'})

    qb_stats = qb_drop.merge(rush_stats, on='player_id', how='left')
    qb_stats['rush_attempts'] = qb_stats['rush_attempts'].fillna(0).astype(int)
    qb_stats['rush_epa_sum'] = qb_stats['rush_epa_sum'].fillna(0)
    qb_stats['rush_yards'] = qb_stats['rush_yards'].fillna(0).astype(int)
    qb_stats['rush_tds'] = qb_stats['rush_tds'].fillna(0).astype(int)

    # --- Fumble stats: attribute via fumbled_1_player_id (not passer/rusher grouping) ---
    # Critical: the `fumble` column marks ANY fumble on the play (including WR/RB).
    # Using passer_player_id grouping would wrongly charge receiver fumbles to the QB.
    all_qb_plays = pd.concat([dropbacks, qb_rushes])
    qb_fumble_plays = all_qb_plays[
        all_qb_plays['fumbled_1_player_id'].isin(qb_ids)
    ]
    if len(qb_fumble_plays) > 0:
        fumble_stats = qb_fumble_plays.groupby('fumbled_1_player_id').agg(
            fumbles=('fumble', 'sum'),
            fumbles_lost=('fumble_lost', 'sum'),
        ).reset_index().rename(columns={'fumbled_1_player_id': 'player_id'})
    else:
        fumble_stats = pd.DataFrame(columns=['player_id', 'fumbles', 'fumbles_lost'])
    qb_stats = qb_stats.merge(fumble_stats, on='player_id', how='left')
    qb_stats['fumbles'] = qb_stats['fumbles'].fillna(0).astype(int)
    qb_stats['fumbles_lost'] = qb_stats['fumbles_lost'].fillna(0).astype(int)

    # EPA per play (total: dropbacks + non-scramble rushes to avoid double-counting)
    # Scrambles are in BOTH dropbacks (qb_dropback=1) and rushes (rush_attempt=1),
    # so total plays = dropbacks + (rush_attempts - scrambles)
    scramble_count = plays[
        (plays['qb_scramble'] == 1) & (plays['rusher_player_id'].isin(qb_ids))
    ].groupby('rusher_player_id').size().reset_index(name='scramble_count').rename(columns={'rusher_player_id': 'player_id'})
    qb_stats = qb_stats.merge(scramble_count, on='player_id', how='left')
    qb_stats['scramble_count'] = qb_stats['scramble_count'].fillna(0).astype(int)
    designed_rush_count = qb_stats['rush_attempts'] - qb_stats['scramble_count']
    total_plays = qb_stats['dropback_count'] + designed_rush_count
    total_epa = qb_stats['dropback_epa_sum'] + (qb_stats['rush_epa_sum'] - plays[
        (plays['qb_scramble'] == 1) & (plays['rusher_player_id'].isin(qb_ids))
    ].groupby('rusher_player_id')['epa'].sum().reindex(qb_stats['player_id']).fillna(0).values)
    qb_stats['epa_per_play'] = total_epa / total_plays.replace(0, float('nan'))

    # Rush EPA per play (designed rushes + scrambles)
    qb_stats['rush_epa_per_play'] = qb_stats.apply(
        lambda r: r['rush_epa_sum'] / r['rush_attempts'] if r['rush_attempts'] > 0 else None,
        axis=1
    )

    # Multi-team QBs: team with most pass attempts
    team_att = dropbacks.groupby(['passer_player_id', 'posteam']).size().reset_index(name='n')
    team_att = team_att.sort_values('n', ascending=False).drop_duplicates('passer_player_id')
    team_map = dict(zip(team_att['passer_player_id'], team_att['posteam']))
    qb_stats['team_id'] = qb_stats['player_id'].map(team_map)

    qb_stats['season'] = season
    qb_stats = qb_stats.rename(columns={'dropback_count': 'dropbacks'})

    # Convert sack_yards_lost to positive int for display (e.g., -150 → 150)
    qb_stats['sack_yards_lost'] = qb_stats['sack_yards_lost'].fillna(0).abs().astype(int)

    # Select final columns
    cols = [
        'player_id', 'player_name', 'team_id', 'season', 'games',
        'completions', 'attempts', 'dropbacks', 'epa_per_db', 'epa_per_play',
        'cpoe', 'completion_pct', 'success_rate', 'passing_yards',
        'touchdowns', 'interceptions', 'sacks', 'sack_yards_lost', 'adot', 'ypa', 'passer_rating',
        'any_a', 'rush_attempts', 'rush_yards', 'rush_tds', 'rush_epa_per_play',
        'fumbles', 'fumbles_lost',
    ]
    result = qb_stats[cols].copy()

    # Filter to only roster QBs (removes trick-play passers like WRs/punters)
    result = result[result['player_id'].isin(qb_ids)].copy()

    log.info("Aggregated stats for %d QBs", len(result))
    return result


def aggregate_rb_gap_stats(plays: pd.DataFrame, season: int) -> pd.DataFrame:
    """Aggregate rushing stats by player x team x gap for designed runs."""
    for col in ('run_location', 'run_gap'):
        if col not in plays.columns:
            log.warning("Column '%s' not found in PBP data — skipping gap stats", col)
            return pd.DataFrame(columns=[
                'player_id', 'player_name', 'team_id', 'season', 'gap',
                'carries', 'epa_per_carry', 'yards_per_carry',
                'success_rate', 'stuff_rate', 'explosive_rate',
            ])

    rushes = plays[
        (plays['rush_attempt'] == 1) &
        (plays['qb_scramble'] != 1)
    ].copy()

    rushes['gap'] = rushes.apply(
        lambda r: map_run_gap(
            r['run_location'] if pd.notna(r['run_location']) else None,
            r['run_gap'] if pd.notna(r['run_gap']) else None,
        ),
        axis=1,
    )
    rushes = rushes[rushes['gap'].notna()]
    rushes = rushes[rushes['rusher_player_id'].notna()]

    if rushes.empty:
        return pd.DataFrame(columns=[
            'player_id', 'player_name', 'team_id', 'season', 'gap',
            'carries', 'epa_per_carry', 'yards_per_carry',
            'success_rate', 'stuff_rate', 'explosive_rate',
        ])

    # Get most common player name per player_id (handles name spelling variations)
    name_map = rushes.groupby('rusher_player_id')['rusher_player_name'].agg(
        lambda x: x.mode().iloc[0] if len(x.mode()) > 0 else x.iloc[0]
    ).to_dict()

    grouped = rushes.groupby(
        ['rusher_player_id', 'posteam', 'gap']
    ).agg(
        carries=('epa', 'count'),
        epa_per_carry=('epa', 'mean'),
        yards_per_carry=('yards_gained', 'mean'),
        success_rate=('success', 'mean'),
        stuff_rate=('yards_gained', lambda x: (x <= 0).mean()),
        explosive_rate=('yards_gained', lambda x: (x >= 10).mean()),
    ).reset_index()

    grouped['player_name'] = grouped['rusher_player_id'].map(name_map)
    grouped = grouped.rename(columns={
        'rusher_player_id': 'player_id',
        'posteam': 'team_id',
    })
    grouped['season'] = season

    return grouped[['player_id', 'player_name', 'team_id', 'season', 'gap',
                     'carries', 'epa_per_carry', 'yards_per_carry',
                     'success_rate', 'stuff_rate', 'explosive_rate']]


def aggregate_def_gap_stats(plays: pd.DataFrame, season: int) -> pd.DataFrame:
    """Aggregate defensive rushing stats by team x gap."""
    for col in ('run_location', 'run_gap', 'defteam'):
        if col not in plays.columns:
            log.warning("Column '%s' not found — skipping def gap stats", col)
            return pd.DataFrame(columns=[
                'team_id', 'season', 'gap', 'carries_faced',
                'def_epa_per_carry', 'def_yards_per_carry',
                'def_success_rate', 'def_stuff_rate', 'def_explosive_rate',
            ])

    rushes = plays[
        (plays['rush_attempt'] == 1) &
        (plays['qb_scramble'] != 1)
    ].copy()

    rushes['gap'] = rushes.apply(
        lambda r: map_run_gap(
            r['run_location'] if pd.notna(r['run_location']) else None,
            r['run_gap'] if pd.notna(r['run_gap']) else None,
        ),
        axis=1,
    )
    rushes = rushes[rushes['gap'].notna()]
    rushes = rushes[rushes['defteam'].notna()]

    if rushes.empty:
        return pd.DataFrame(columns=[
            'team_id', 'season', 'gap', 'carries_faced',
            'def_epa_per_carry', 'def_yards_per_carry',
            'def_success_rate', 'def_stuff_rate', 'def_explosive_rate',
        ])

    grouped = rushes.groupby(['defteam', 'gap']).agg(
        carries_faced=('epa', 'count'),
        def_epa_per_carry=('epa', 'mean'),
        def_yards_per_carry=('yards_gained', 'mean'),
        def_success_rate=('success', 'mean'),
        def_stuff_rate=('yards_gained', lambda x: (x <= 0).mean()),
        def_explosive_rate=('yards_gained', lambda x: (x >= 10).mean()),
    ).reset_index()

    grouped = grouped.rename(columns={'defteam': 'team_id'})
    grouped['season'] = season

    return grouped[['team_id', 'season', 'gap', 'carries_faced',
                     'def_epa_per_carry', 'def_yards_per_carry',
                     'def_success_rate', 'def_stuff_rate', 'def_explosive_rate']]


def aggregate_receiver_stats(plays: pd.DataFrame, roster: pd.DataFrame, season: int, participation: pd.DataFrame = None) -> pd.DataFrame:
    """Aggregate receiver season stats from filtered plays."""
    # Filter to target plays: receiver exists, pass attempt, not a sack or scramble
    target_plays = plays[
        (plays['receiver_player_id'].notna()) &
        (plays['pass_attempt'] == 1) &
        (plays['sack'] != 1) &
        (plays['qb_scramble'] != 1)
    ].copy()

    if target_plays.empty:
        return pd.DataFrame()

    # Group by receiver
    rec = target_plays.groupby('receiver_player_id').agg(
        player_name=('receiver_player_name', 'first'),
        targets=('game_id', 'count'),
        receptions=('complete_pass', 'sum'),
        receiving_yards=('receiving_yards', lambda x: x.dropna().sum()),
        epa_per_target=('epa', 'mean'),
        yac=('yards_after_catch', lambda x: x.dropna().sum()),
        air_yards=('air_yards', lambda x: x.dropna().sum()),
        games=('game_id', 'nunique'),
    ).reset_index().rename(columns={'receiver_player_id': 'player_id'})

    # Receiving TDs: only on completed passes
    completed = target_plays[target_plays['complete_pass'] == 1]
    td_counts = completed.groupby('receiver_player_id')['pass_touchdown'].sum().reset_index()
    td_counts.columns = ['player_id', 'receiving_tds']
    rec = rec.merge(td_counts, on='player_id', how='left')
    rec['receiving_tds'] = rec['receiving_tds'].fillna(0).astype(int)

    # Derived rate stats
    rec['catch_rate'] = rec['receptions'] / rec['targets']
    rec['yards_per_target'] = rec['receiving_yards'] / rec['targets']
    rec['yards_per_reception'] = rec.apply(
        lambda r: r['receiving_yards'] / r['receptions'] if r['receptions'] > 0 else float('nan'), axis=1
    )
    rec['yac_per_reception'] = rec.apply(
        lambda r: r['yac'] / r['receptions'] if r['receptions'] > 0 else float('nan'), axis=1
    )
    rec['air_yards_per_target'] = rec['air_yards'] / rec['targets']

    # Team assignment: team with most targets
    team_counts = target_plays.groupby(['receiver_player_id', 'posteam']).size().reset_index(name='cnt')
    team_primary = team_counts.sort_values('cnt', ascending=False).drop_duplicates('receiver_player_id')
    team_primary = team_primary[['receiver_player_id', 'posteam']].rename(
        columns={'receiver_player_id': 'player_id', 'posteam': 'team_id'}
    )
    rec = rec.merge(team_primary, on='player_id', how='left')

    # Target share: player's primary-team targets / team total targets
    # For traded players, only count targets on their primary team
    team_total_targets = target_plays.groupby('posteam').size().to_dict()
    player_team_targets = target_plays.groupby(['receiver_player_id', 'posteam']).size().reset_index(name='team_tgt')
    player_team_targets.columns = ['player_id', 'team_id', 'primary_team_targets']
    rec = rec.merge(player_team_targets, on=['player_id', 'team_id'], how='left')
    rec['target_share'] = rec.apply(
        lambda r: r['primary_team_targets'] / team_total_targets.get(r['team_id'], 1)
        if pd.notna(r.get('primary_team_targets')) else 0, axis=1
    )
    rec.drop(columns=['primary_team_targets'], inplace=True)

    # Position from roster (mode = most frequent)
    pos_lookup = roster.groupby('gsis_id')['position'].agg(
        lambda x: x.mode().iloc[0] if len(x.mode()) > 0 else 'WR'
    ).to_dict()
    rec['position'] = rec['player_id'].map(pos_lookup).fillna('WR')

    # Filter to skill positions only (exclude OL, DL, QB — QBs appear in
    # offense_players on every snap, inflating routes_run/total_snaps)
    rec = rec[rec['position'].isin(['WR', 'TE', 'RB', 'FB'])]

    # Fumbles: search full plays DataFrame for receiver player IDs
    receiver_ids = set(rec['player_id'])
    fumble_plays = plays[plays['fumbled_1_player_id'].isin(receiver_ids)]
    fumble_counts = fumble_plays.groupby('fumbled_1_player_id').agg(
        fumbles=('fumble', 'sum'),
        fumbles_lost=('fumble_lost', 'sum'),
    ).reset_index().rename(columns={'fumbled_1_player_id': 'player_id'})
    rec = rec.merge(fumble_counts, on='player_id', how='left')
    rec['fumbles'] = rec['fumbles'].fillna(0).astype(int)
    rec['fumbles_lost'] = rec['fumbles_lost'].fillna(0).astype(int)

    # Add season, convert types
    rec['season'] = season
    rec['receptions'] = rec['receptions'].astype(int)
    rec['receiving_yards'] = rec['receiving_yards'].fillna(0).astype(int)

    # Routes run from participation data (if available)
    if participation is not None and not participation.empty:
        # Filter PBP to pass plays (same criteria as targets but without receiver check)
        pass_plays = plays[
            (plays['pass_attempt'] == 1) &
            (plays['sack'] != 1) &
            (plays['qb_scramble'] != 1)
        ][['game_id', 'play_id']].drop_duplicates()

        # Participation data is one row per play with semicolon-delimited offense_players.
        # Explode to one row per player per play, then join to pass plays.
        part_cols = participation[['nflverse_game_id', 'play_id', 'offense_players']].copy()
        part_cols = part_cols.dropna(subset=['offense_players'])
        part_exploded = part_cols.assign(
            player_id=part_cols['offense_players'].str.split(';')
        ).explode('player_id')
        part_exploded['player_id'] = part_exploded['player_id'].str.strip()
        part_exploded = part_exploded[part_exploded['player_id'] != '']  # filter empty strings from trailing semicolons
        part_exploded = part_exploded.drop_duplicates(['nflverse_game_id', 'play_id', 'player_id'])  # guard against duplicate rows

        # --- SNAP COUNTS: count offensive plays per player (pass + run only) ---
        # Filter to actual offensive plays (exclude kickoffs, punts, FGs, kneeldowns, spikes, penalties)
        offensive_plays = plays[plays['play_type'].isin(['pass', 'run'])][['game_id', 'play_id', 'posteam']].drop_duplicates()
        # Join to plays for team context (participation data has no team column)
        snaps_with_team = part_exploded.merge(
            offensive_plays,
            left_on=['nflverse_game_id', 'play_id'],
            right_on=['game_id', 'play_id'],
            how='inner'
        )
        # Composite key for unique plays (play_id resets per game in nflverse)
        snaps_with_team['game_play'] = snaps_with_team['game_id'] + '_' + snaps_with_team['play_id'].astype(str)
        # Total snaps per player (ALL teams combined — used for route_participation_rate)
        player_total_snaps = snaps_with_team.groupby('player_id')['game_play'].nunique().reset_index(name='total_snaps')
        # Snaps per player per team (used for snap_share with primary team)
        player_team_snaps = snaps_with_team.groupby(['player_id', 'posteam'])['game_play'].nunique().reset_index(name='primary_team_snaps')
        # Team total offensive snaps (denominator for snap_share)
        team_total_snaps = snaps_with_team.groupby('posteam')['game_play'].nunique().to_dict()

        # --- ROUTE PARTICIPATION: dropback plays per player / team total dropbacks ---
        # Industry formula: "when the team passes, is this player on the field?"
        dropback_plays = plays[plays['qb_dropback'] == 1][['game_id', 'play_id']].drop_duplicates()
        snaps_on_dropbacks = snaps_with_team.merge(
            dropback_plays, on=['game_id', 'play_id'], how='inner'
        )
        snaps_on_dropbacks['game_play'] = snaps_on_dropbacks['game_id'] + '_' + snaps_on_dropbacks['play_id'].astype(str)
        # Player dropback snaps per team (for primary-team route participation)
        player_dropback_snaps = snaps_on_dropbacks.groupby(['player_id', 'posteam'])['game_play'].nunique().reset_index(name='dropback_snaps')
        # Team total dropback plays (denominator)
        team_total_dropbacks = snaps_on_dropbacks.groupby('posteam')['game_play'].nunique().to_dict()

        # Join to pass plays to find who was on field during pass plays
        routes = part_exploded.merge(
            pass_plays,
            left_on=['nflverse_game_id', 'play_id'],
            right_on=['game_id', 'play_id'],
            how='inner'
        )

        # Count routes per player
        routes_per_player = routes.groupby('player_id').size().reset_index(name='routes_run')

        rec = rec.merge(routes_per_player, on='player_id', how='left')
        rec['routes_run'] = rec['routes_run'].fillna(0).astype(int)

        # Merge total snaps (all teams combined) for route_participation_rate
        rec = rec.merge(player_total_snaps, on='player_id', how='left')
        rec['total_snaps'] = rec['total_snaps'].fillna(0).astype(int)

        # Merge primary-team snaps for snap_share
        rec = rec.merge(
            player_team_snaps,
            left_on=['player_id', 'team_id'],
            right_on=['player_id', 'posteam'],
            how='left'
        )
        rec.drop(columns=['posteam'], inplace=True, errors='ignore')
        rec['primary_team_snaps'] = rec['primary_team_snaps'].fillna(0).astype(int)
        rec['snap_share'] = rec.apply(
            lambda r: r['primary_team_snaps'] / team_total_snaps[r['team_id']]
            if r['primary_team_snaps'] > 0 and r['team_id'] in team_total_snaps else float('nan'), axis=1
        )
        rec.drop(columns=['primary_team_snaps'], inplace=True)

        # Validate bounds
        bad_snap = rec[rec['snap_share'] > 1.0]
        if not bad_snap.empty:
            log.warning("snap_share > 1.0 for %d players: %s", len(bad_snap), bad_snap['player_name'].tolist()[:5])

        # Sanity check: warn if participation join produced suspiciously few routes
        total_routes = rec['routes_run'].sum()
        if total_routes < 10000:
            log.warning("Low route count (%d total) — participation data may not have matched PBP game IDs", total_routes)
    else:
        rec['routes_run'] = 0
        rec['total_snaps'] = 0
        rec['snap_share'] = float('nan')

    # Derived route metrics
    rec['yards_per_route_run'] = rec.apply(
        lambda r: r['receiving_yards'] / r['routes_run'] if r['routes_run'] > 0 else float('nan'), axis=1
    )
    rec['targets_per_route_run'] = rec.apply(
        lambda r: r['targets'] / r['routes_run'] if r['routes_run'] > 0 else float('nan'), axis=1
    )
    # Route participation = dropback snaps on primary team / team total dropbacks
    # Industry formula: "when the team passes, is this player on the field?"
    if participation is not None and not participation.empty:
        rec = rec.merge(
            player_dropback_snaps,
            left_on=['player_id', 'team_id'],
            right_on=['player_id', 'posteam'],
            how='left'
        )
        rec.drop(columns=['posteam'], inplace=True, errors='ignore')
        rec['dropback_snaps'] = rec['dropback_snaps'].fillna(0).astype(int)
        rec['route_participation_rate'] = rec.apply(
            lambda r: r['dropback_snaps'] / team_total_dropbacks[r['team_id']]
            if r['dropback_snaps'] > 0 and r['team_id'] in team_total_dropbacks else float('nan'), axis=1
        )
        rec.drop(columns=['dropback_snaps'], inplace=True)
    else:
        rec['route_participation_rate'] = float('nan')

    # Validate route participation bounds
    bad_route = rec[rec['route_participation_rate'] > 1.0]
    if not bad_route.empty:
        log.warning("route_participation_rate > 1.0 for %d players: %s", len(bad_route), bad_route['player_name'].tolist()[:5])

    # Select final columns
    cols = [
        'player_id', 'player_name', 'position', 'team_id', 'season', 'games',
        'targets', 'receptions', 'receiving_yards', 'receiving_tds',
        'catch_rate', 'yards_per_target', 'yards_per_reception',
        'epa_per_target', 'yac', 'yac_per_reception',
        'air_yards', 'air_yards_per_target', 'target_share',
        'routes_run', 'yards_per_route_run', 'targets_per_route_run',
        'total_snaps', 'snap_share', 'route_participation_rate',
        'fumbles', 'fumbles_lost',
    ]
    return rec[cols]


SITUATIONS = {
    'all': lambda df: df,
    'early': lambda df: df[df['down'].isin([1, 2])],
    'short_yardage': lambda df: df[(df['down'].isin([3, 4])) & (df['ydstogo'] <= 2)],
    'passing': lambda df: df[
        ((df['down'] == 2) & (df['ydstogo'] >= 7)) |
        ((df['down'] == 3) & (df['ydstogo'] >= 5))
    ],
}

FIELD_ZONES = {
    'all': lambda df: df,
    'redzone': lambda df: df[df['yardline_100'] <= 20],
    'goalline': lambda df: df[df['yardline_100'] <= 5],
}


def aggregate_rb_gap_stats_weekly(plays: pd.DataFrame, season: int) -> pd.DataFrame:
    """Aggregate rushing stats by player x team x gap x week x situation x field_zone."""
    for col in ('run_location', 'run_gap', 'week', 'down', 'ydstogo', 'yardline_100'):
        if col not in plays.columns:
            log.warning("Column '%s' not found — skipping weekly gap stats", col)
            return pd.DataFrame()

    rushes = plays[
        (plays['rush_attempt'] == 1) &
        (plays['qb_scramble'] != 1)
    ].copy()

    rushes['gap'] = rushes.apply(
        lambda r: map_run_gap(
            r['run_location'] if pd.notna(r['run_location']) else None,
            r['run_gap'] if pd.notna(r['run_gap']) else None,
        ),
        axis=1,
    )
    rushes = rushes[rushes['gap'].notna()]
    rushes = rushes[rushes['rusher_player_id'].notna()]

    if rushes.empty:
        return pd.DataFrame()

    # Get most common player name per player_id
    name_map = rushes.groupby('rusher_player_id')['rusher_player_name'].agg(
        lambda x: x.mode().iloc[0] if len(x.mode()) > 0 else x.iloc[0]
    ).to_dict()

    all_results = []
    for sit_name, sit_filter in SITUATIONS.items():
        for fz_name, fz_filter in FIELD_ZONES.items():
            subset = fz_filter(sit_filter(rushes))
            if subset.empty:
                continue

            grouped = subset.groupby(
                ['rusher_player_id', 'posteam', 'week', 'gap']
            ).agg(
                carries=('epa', 'count'),
                epa_per_carry=('epa', 'mean'),
                yards_per_carry=('yards_gained', 'mean'),
                success_rate=('success', 'mean'),
                stuff_rate=('yards_gained', lambda x: (x <= 0).mean()),
                explosive_rate=('yards_gained', lambda x: (x >= 10).mean()),
            ).reset_index()

            grouped['player_name'] = grouped['rusher_player_id'].map(name_map)
            grouped['situation'] = sit_name
            grouped['field_zone'] = fz_name
            grouped['season'] = season
            grouped = grouped.rename(columns={
                'rusher_player_id': 'player_id',
                'posteam': 'team_id',
            })
            all_results.append(grouped)

    if not all_results:
        return pd.DataFrame()

    return pd.concat(all_results, ignore_index=True)


@retry(max_retries=2, delay=3)
def upsert_teams(conn, teams_df: pd.DataFrame):
    """Seed ALL known teams for FK integrity — includes historical abbreviations."""
    TEAM_NAMES = {
        'ARI': ('Arizona Cardinals', 'NFC West', 'NFC', '#97233F', '#000000'),
        'ATL': ('Atlanta Falcons', 'NFC South', 'NFC', '#A71930', '#000000'),
        'BAL': ('Baltimore Ravens', 'AFC North', 'AFC', '#241773', '#000000'),
        'BUF': ('Buffalo Bills', 'AFC East', 'AFC', '#00338D', '#C60C30'),
        'CAR': ('Carolina Panthers', 'NFC South', 'NFC', '#0085CA', '#101820'),
        'CHI': ('Chicago Bears', 'NFC North', 'NFC', '#0B162A', '#C83803'),
        'CIN': ('Cincinnati Bengals', 'AFC North', 'AFC', '#FB4F14', '#000000'),
        'CLE': ('Cleveland Browns', 'AFC North', 'AFC', '#311D00', '#FF3C00'),
        'DAL': ('Dallas Cowboys', 'NFC East', 'NFC', '#041E42', '#869397'),
        'DEN': ('Denver Broncos', 'AFC West', 'AFC', '#FB4F14', '#002244'),
        'DET': ('Detroit Lions', 'NFC North', 'NFC', '#0076B6', '#B0B7BC'),
        'GB': ('Green Bay Packers', 'NFC North', 'NFC', '#203731', '#FFB612'),
        'HOU': ('Houston Texans', 'AFC South', 'AFC', '#03202F', '#A71930'),
        'IND': ('Indianapolis Colts', 'AFC South', 'AFC', '#002C5F', '#A2AAAD'),
        'JAX': ('Jacksonville Jaguars', 'AFC South', 'AFC', '#006778', '#9F792C'),
        'KC': ('Kansas City Chiefs', 'AFC West', 'AFC', '#E31837', '#FFB81C'),
        'LAC': ('Los Angeles Chargers', 'AFC West', 'AFC', '#0080C6', '#FFC20E'),
        'LAR': ('Los Angeles Rams', 'NFC West', 'NFC', '#003594', '#FFA300'),
        'LV': ('Las Vegas Raiders', 'AFC West', 'AFC', '#000000', '#A5ACAF'),
        'MIA': ('Miami Dolphins', 'AFC East', 'AFC', '#008E97', '#FC4C02'),
        'MIN': ('Minnesota Vikings', 'NFC North', 'NFC', '#4F2683', '#FFC62F'),
        'NE': ('New England Patriots', 'AFC East', 'AFC', '#002244', '#C60C30'),
        'NO': ('New Orleans Saints', 'NFC South', 'NFC', '#D3BC8D', '#101820'),
        'NYG': ('New York Giants', 'NFC East', 'NFC', '#0B2265', '#A71930'),
        'NYJ': ('New York Jets', 'AFC East', 'AFC', '#125740', '#000000'),
        'PHI': ('Philadelphia Eagles', 'NFC East', 'NFC', '#004C54', '#A5ACAF'),
        'PIT': ('Pittsburgh Steelers', 'AFC North', 'AFC', '#FFB612', '#101820'),
        'SEA': ('Seattle Seahawks', 'NFC West', 'NFC', '#002244', '#69BE28'),
        'SF': ('San Francisco 49ers', 'NFC West', 'NFC', '#AA0000', '#B3995D'),
        'TB': ('Tampa Bay Buccaneers', 'NFC South', 'NFC', '#D50A0A', '#FF7900'),
        'TEN': ('Tennessee Titans', 'AFC South', 'AFC', '#0C2340', '#4B92DB'),
        'WAS': ('Washington Commanders', 'NFC East', 'NFC', '#5A1414', '#FFB612'),
        # Historical abbreviations (nflverse uses these for pre-relocation seasons)
        'LA': ('Los Angeles Rams', 'NFC West', 'NFC', '#003594', '#FFA300'),
        'OAK': ('Oakland Raiders', 'AFC West', 'AFC', '#000000', '#A5ACAF'),
        'SD': ('San Diego Chargers', 'AFC West', 'AFC', '#002A5E', '#FFC20E'),
        'STL': ('St. Louis Rams', 'NFC West', 'NFC', '#002244', '#B3995D'),
    }
    # Seed all known teams unconditionally (not just current season's teams)
    rows = [
        (tid, name, div, conf, pc, sc)
        for tid, (name, div, conf, pc, sc) in TEAM_NAMES.items()
    ]
    if rows:
        with conn.cursor() as cur:
            execute_values(
                cur,
                """INSERT INTO teams (id, name, division, conference, primary_color, secondary_color)
                   VALUES %s
                   ON CONFLICT (id) DO UPDATE SET
                     name = EXCLUDED.name,
                     division = EXCLUDED.division,
                     conference = EXCLUDED.conference,
                     primary_color = EXCLUDED.primary_color,
                     secondary_color = EXCLUDED.secondary_color""",
                rows,
            )
        log.info("Upserted %d teams", len(rows))


@retry(max_retries=2, delay=3)
def upsert_team_stats(conn, df: pd.DataFrame):
    """Upsert team season stats."""
    cols = [
        'team_id', 'season', 'off_epa_play', 'def_epa_play',
        'off_pass_epa', 'off_rush_epa', 'def_pass_epa', 'def_rush_epa',
        'off_success_rate', 'def_success_rate', 'pass_rate', 'plays',
        'wins', 'losses', 'ties',
        'takeaways', 'giveaways', 'turnover_diff',
    ]
    # Replace NaN with None for SQL NULL (avoid PostgreSQL NaN in NUMERIC columns)
    clean_df = df[cols].where(df[cols].notna(), None)
    rows = [tuple(r) for _, r in clean_df.iterrows()]
    col_names = ', '.join(cols)
    update_set = ', '.join(f"{c} = EXCLUDED.{c}" for c in cols if c not in ('team_id', 'season'))

    with conn.cursor() as cur:
        execute_values(
            cur,
            f"""INSERT INTO team_season_stats ({col_names})
                VALUES %s
                ON CONFLICT (team_id, season) DO UPDATE SET {update_set}""",
            rows,
        )
    log.info("Upserted %d team season rows", len(rows))


@retry(max_retries=2, delay=3)
def upsert_qb_stats(conn, df: pd.DataFrame):
    """Upsert QB season stats."""
    cols = [
        'player_id', 'player_name', 'team_id', 'season', 'games',
        'completions', 'attempts', 'dropbacks', 'epa_per_db', 'epa_per_play',
        'cpoe', 'completion_pct', 'success_rate', 'passing_yards',
        'touchdowns', 'interceptions', 'sacks', 'sack_yards_lost', 'adot', 'ypa', 'passer_rating',
        'any_a', 'rush_attempts', 'rush_yards', 'rush_tds', 'rush_epa_per_play',
        'fumbles', 'fumbles_lost',
    ]
    # Replace NaN with None for SQL NULL
    clean_df = df[cols].where(df[cols].notna(), None)
    rows = [tuple(r) for _, r in clean_df.iterrows()]
    col_names = ', '.join(cols)
    update_set = ', '.join(f"{c} = EXCLUDED.{c}" for c in cols if c not in ('player_id', 'season'))

    with conn.cursor() as cur:
        execute_values(
            cur,
            f"""INSERT INTO qb_season_stats ({col_names})
                VALUES %s
                ON CONFLICT (player_id, season) DO UPDATE SET {update_set}""",
            rows,
        )
    log.info("Upserted %d QB season rows", len(rows))


def ensure_team_season_stats_columns(conn):
    """Add new columns to team_season_stats (idempotent). NOT inside @retry."""
    with conn.cursor() as cur:
        for col, typ in [('takeaways', 'INT'), ('giveaways', 'INT'), ('turnover_diff', 'INT')]:
            cur.execute(f"ALTER TABLE team_season_stats ADD COLUMN IF NOT EXISTS {col} {typ};")
    conn.commit()
    log.info("Ensured team_season_stats has takeaways/giveaways/turnover_diff columns")


def ensure_rb_gap_tables(conn):
    """Create rb_gap_stats table if it doesn't exist. Called once, NOT inside @retry."""
    with conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS rb_gap_stats (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                player_id TEXT NOT NULL,
                player_name TEXT NOT NULL,
                team_id TEXT NOT NULL REFERENCES teams(id),
                season INT NOT NULL,
                gap TEXT NOT NULL,
                carries INT NOT NULL,
                epa_per_carry NUMERIC,
                yards_per_carry NUMERIC,
                success_rate NUMERIC,
                stuff_rate NUMERIC,
                explosive_rate NUMERIC,
                UNIQUE (player_id, team_id, season, gap)
            )
        """)
        cur.execute("""
            DO $$ BEGIN
                ALTER TABLE rb_gap_stats ENABLE ROW LEVEL SECURITY;
            EXCEPTION WHEN others THEN NULL;
            END $$
        """)
        cur.execute("""
            DO $$ BEGIN
                CREATE POLICY "public_read" ON rb_gap_stats FOR SELECT USING (true);
            EXCEPTION WHEN duplicate_object THEN NULL;
            END $$
        """)
    conn.commit()
    log.info("Ensured rb_gap_stats table exists with RLS")


@retry(max_retries=2, delay=3)
def upsert_rb_gap_stats(conn, df: pd.DataFrame):
    """Upsert RB gap stats into rb_gap_stats table."""
    if df.empty:
        log.info("No RB gap stats to upsert")
        return

    cols = ['player_id', 'player_name', 'team_id', 'season', 'gap',
            'carries', 'epa_per_carry', 'yards_per_carry',
            'success_rate', 'stuff_rate', 'explosive_rate']
    clean_df = df[cols].where(df[cols].notna(), None)
    rows = [tuple(r) for _, r in clean_df.iterrows()]
    col_names = ', '.join(cols)
    update_set = ', '.join(
        f"{c} = EXCLUDED.{c}" for c in cols
        if c not in ('player_id', 'team_id', 'season', 'gap')
    )

    with conn.cursor() as cur:
        execute_values(
            cur,
            f"INSERT INTO rb_gap_stats ({col_names}) VALUES %s "
            f"ON CONFLICT (player_id, team_id, season, gap) DO UPDATE SET {update_set}",
            rows,
        )
    log.info("Upserted %d RB gap stat rows", len(rows))


def ensure_def_gap_tables(conn):
    """Create def_gap_stats table if it doesn't exist. NOT inside @retry."""
    with conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS def_gap_stats (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                team_id TEXT NOT NULL REFERENCES teams(id),
                season INT NOT NULL,
                gap TEXT NOT NULL,
                carries_faced INT NOT NULL,
                def_epa_per_carry NUMERIC,
                def_yards_per_carry NUMERIC,
                def_success_rate NUMERIC,
                def_stuff_rate NUMERIC,
                def_explosive_rate NUMERIC,
                UNIQUE (team_id, season, gap)
            )
        """)
        cur.execute("""DO $$ BEGIN ALTER TABLE def_gap_stats ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN others THEN NULL; END $$""")
        cur.execute("""DO $$ BEGIN CREATE POLICY "public_read" ON def_gap_stats FOR SELECT USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$""")
    conn.commit()
    log.info("Ensured def_gap_stats table exists with RLS")


def ensure_receiver_stats_table(conn):
    """Create receiver_season_stats table if it doesn't exist. NOT @retry."""
    with conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS receiver_season_stats (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                player_id TEXT NOT NULL,
                player_name TEXT NOT NULL,
                position TEXT NOT NULL,
                team_id TEXT REFERENCES teams(id),
                season INTEGER NOT NULL,
                games INTEGER,
                targets INTEGER,
                receptions INTEGER,
                receiving_yards INTEGER,
                receiving_tds INTEGER,
                catch_rate NUMERIC,
                yards_per_target NUMERIC,
                yards_per_reception NUMERIC,
                epa_per_target NUMERIC,
                yac NUMERIC,
                yac_per_reception NUMERIC,
                air_yards NUMERIC,
                air_yards_per_target NUMERIC,
                target_share NUMERIC,
                fumbles INTEGER,
                fumbles_lost INTEGER,
                UNIQUE(player_id, season)
            );
            CREATE INDEX IF NOT EXISTS idx_receiver_season ON receiver_season_stats(season);
            CREATE INDEX IF NOT EXISTS idx_receiver_player ON receiver_season_stats(player_id);
            CREATE INDEX IF NOT EXISTS idx_receiver_team ON receiver_season_stats(team_id, season);
        """)
        # Add route columns (idempotent for existing tables)
        for col, typ in [('routes_run', 'INTEGER'), ('yards_per_route_run', 'NUMERIC'), ('targets_per_route_run', 'NUMERIC'),
                         ('total_snaps', 'INTEGER'), ('snap_share', 'NUMERIC'), ('route_participation_rate', 'NUMERIC')]:
            cur.execute(f"ALTER TABLE receiver_season_stats ADD COLUMN IF NOT EXISTS {col} {typ};")
        # RLS (wrapped in exception blocks for idempotent re-runs)
        cur.execute("""
            DO $$ BEGIN
                ALTER TABLE receiver_season_stats ENABLE ROW LEVEL SECURITY;
            EXCEPTION WHEN others THEN NULL;
            END $$;
        """)
        cur.execute("""
            DO $$ BEGIN
                CREATE POLICY "public_read" ON receiver_season_stats FOR SELECT USING (true);
            EXCEPTION WHEN duplicate_object THEN NULL;
            END $$;
        """)
    conn.commit()
    log.info("Ensured receiver_season_stats table exists")


@retry(max_retries=2, delay=3)
def upsert_receiver_stats(conn, df: pd.DataFrame):
    """Upsert receiver season stats."""
    if df.empty:
        log.info("No receiver stats to upsert (empty DataFrame)")
        return
    cols = [
        'player_id', 'player_name', 'position', 'team_id', 'season', 'games',
        'targets', 'receptions', 'receiving_yards', 'receiving_tds',
        'catch_rate', 'yards_per_target', 'yards_per_reception',
        'epa_per_target', 'yac', 'yac_per_reception',
        'air_yards', 'air_yards_per_target', 'target_share',
        'routes_run', 'yards_per_route_run', 'targets_per_route_run',
        'total_snaps', 'snap_share', 'route_participation_rate',
        'fumbles', 'fumbles_lost',
    ]
    clean_df = df[cols].where(df[cols].notna(), None)
    rows = [tuple(r) for _, r in clean_df.iterrows()]
    col_names = ', '.join(cols)
    update_set = ', '.join(f"{c} = EXCLUDED.{c}" for c in cols if c not in ('player_id', 'season'))

    with conn.cursor() as cur:
        execute_values(
            cur,
            f"""INSERT INTO receiver_season_stats ({col_names})
                VALUES %s
                ON CONFLICT (player_id, season) DO UPDATE SET {update_set}""",
            rows,
        )
    log.info("Upserted %d receiver season rows", len(rows))


@retry(max_retries=2, delay=3)
def upsert_def_gap_stats(conn, df: pd.DataFrame):
    """Upsert defensive gap stats into def_gap_stats table."""
    if df.empty:
        log.info("No def gap stats to upsert")
        return

    cols = ['team_id', 'season', 'gap', 'carries_faced',
            'def_epa_per_carry', 'def_yards_per_carry',
            'def_success_rate', 'def_stuff_rate', 'def_explosive_rate']
    clean_df = df[cols].where(df[cols].notna(), None)
    rows = [tuple(r) for _, r in clean_df.iterrows()]
    col_names = ', '.join(cols)
    update_set = ', '.join(
        f"{c} = EXCLUDED.{c}" for c in cols
        if c not in ('team_id', 'season', 'gap')
    )

    with conn.cursor() as cur:
        execute_values(
            cur,
            f"INSERT INTO def_gap_stats ({col_names}) VALUES %s "
            f"ON CONFLICT (team_id, season, gap) DO UPDATE SET {update_set}",
            rows,
        )
    log.info("Upserted %d def gap stat rows", len(rows))


def ensure_rb_gap_weekly_tables(conn):
    """Create rb_gap_stats_weekly table if it doesn't exist. NOT inside @retry."""
    with conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS rb_gap_stats_weekly (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                player_id TEXT NOT NULL,
                player_name TEXT NOT NULL,
                team_id TEXT NOT NULL REFERENCES teams(id),
                season INT NOT NULL,
                week INT NOT NULL,
                gap TEXT NOT NULL,
                situation TEXT NOT NULL DEFAULT 'all',
                field_zone TEXT NOT NULL DEFAULT 'all',
                carries INT NOT NULL,
                epa_per_carry NUMERIC,
                yards_per_carry NUMERIC,
                success_rate NUMERIC,
                stuff_rate NUMERIC,
                explosive_rate NUMERIC,
                UNIQUE (player_id, team_id, season, week, gap, situation, field_zone)
            )
        """)
        cur.execute("""
            DO $$ BEGIN
                ALTER TABLE rb_gap_stats_weekly ENABLE ROW LEVEL SECURITY;
            EXCEPTION WHEN others THEN NULL;
            END $$
        """)
        cur.execute("""
            DO $$ BEGIN
                CREATE POLICY "public_read" ON rb_gap_stats_weekly FOR SELECT USING (true);
            EXCEPTION WHEN duplicate_object THEN NULL;
            END $$
        """)
    conn.commit()
    log.info("Ensured rb_gap_stats_weekly table exists with RLS")


@retry(max_retries=2, delay=3)
def upsert_rb_gap_stats_weekly(conn, df: pd.DataFrame):
    """Upsert weekly RB gap stats."""
    if df.empty:
        log.info("No weekly RB gap stats to upsert")
        return

    cols = ['player_id', 'player_name', 'team_id', 'season', 'week', 'gap',
            'situation', 'field_zone', 'carries', 'epa_per_carry', 'yards_per_carry',
            'success_rate', 'stuff_rate', 'explosive_rate']
    clean_df = df[cols].where(df[cols].notna(), None)
    rows = [tuple(r) for _, r in clean_df.iterrows()]
    col_names = ', '.join(cols)
    conflict_cols = 'player_id, team_id, season, week, gap, situation, field_zone'
    update_set = ', '.join(
        f"{c} = EXCLUDED.{c}" for c in cols
        if c not in ('player_id', 'team_id', 'season', 'week', 'gap', 'situation', 'field_zone')
    )

    with conn.cursor() as cur:
        execute_values(
            cur,
            f"INSERT INTO rb_gap_stats_weekly ({col_names}) VALUES %s "
            f"ON CONFLICT ({conflict_cols}) DO UPDATE SET {update_set}",
            rows,
        )
    log.info("Upserted %d weekly RB gap stat rows", len(rows))


# --- Weekly stats tables (game logs) ---

def _derive_game_context(plays: pd.DataFrame) -> pd.DataFrame:
    """Derive per-game context (opponent, home/away, score, result) from PBP plays.

    Returns DataFrame with columns: game_id, posteam, opponent_id, home_away,
    team_score, opponent_score, result.
    """
    # Get unique game+team combos
    game_teams = plays[['game_id', 'posteam', 'defteam', 'home_team', 'away_team',
                         'total_home_score', 'total_away_score']].copy()

    # Final scores: max of running score columns per game
    final_scores = game_teams.groupby('game_id').agg(
        home_score=('total_home_score', 'max'),
        away_score=('total_away_score', 'max'),
        home_team=('home_team', 'first'),
        away_team=('away_team', 'first'),
    ).reset_index()

    # Build context per (game_id, posteam)
    game_team_context = game_teams[['game_id', 'posteam', 'defteam']].drop_duplicates()
    # Take the most common defteam per game+posteam (should be unique but guard it)
    game_team_context = game_team_context.groupby(['game_id', 'posteam']).agg(
        opponent_id=('defteam', 'first')
    ).reset_index()

    game_team_context = game_team_context.merge(final_scores, on='game_id', how='left')

    # home_away
    game_team_context['home_away'] = game_team_context.apply(
        lambda r: 'home' if r['posteam'] == r['home_team'] else 'away', axis=1
    )

    # team_score / opponent_score
    game_team_context['team_score'] = game_team_context.apply(
        lambda r: int(r['home_score']) if r['home_away'] == 'home' else int(r['away_score']), axis=1
    )
    game_team_context['opponent_score'] = game_team_context.apply(
        lambda r: int(r['away_score']) if r['home_away'] == 'home' else int(r['home_score']), axis=1
    )

    # result
    game_team_context['result'] = game_team_context.apply(
        lambda r: 'W' if r['team_score'] > r['opponent_score']
        else ('L' if r['team_score'] < r['opponent_score'] else 'T'), axis=1
    )

    return game_team_context[['game_id', 'posteam', 'opponent_id', 'home_away',
                               'team_score', 'opponent_score', 'result']]


def _get_game_week_map(plays: pd.DataFrame) -> dict:
    """Return dict mapping game_id -> week."""
    return plays.groupby('game_id')['week'].first().to_dict()


def aggregate_qb_weekly_stats(plays: pd.DataFrame, roster: pd.DataFrame, season: int) -> pd.DataFrame:
    """Aggregate QB weekly (game-log) stats from filtered plays."""
    qb_ids = set(roster[roster['position'] == 'QB']['gsis_id'].dropna().unique())

    # --- Dropback stats ---
    dropbacks = plays[plays['qb_dropback'] == 1].copy()

    # Fix scramble attribution (same as season-level)
    scramble_mask = dropbacks['qb_scramble'] == 1
    dropbacks.loc[scramble_mask, 'passer_player_id'] = (
        dropbacks.loc[scramble_mask, 'passer_player_id'].fillna(
            dropbacks.loc[scramble_mask, 'rusher_player_id']
        )
    )

    # Filter to roster QBs early for weekly
    dropbacks = dropbacks[dropbacks['passer_player_id'].isin(qb_ids)]

    if dropbacks.empty:
        return pd.DataFrame()

    # Game-week map
    game_week = _get_game_week_map(plays)
    game_context = _derive_game_context(plays)

    # True pass attempts (exclude sacks)
    true_passes = dropbacks[(dropbacks['pass_attempt'] == 1) & (dropbacks['sack'] != 1)]

    # Group dropbacks by passer + game
    qb_game = dropbacks.groupby(['passer_player_id', 'game_id', 'posteam']).agg(
        epa_per_dropback=('epa', 'mean'),
        sacks=('sack', 'sum'),
        cpoe=('cpoe', lambda x: x.dropna().mean()),
        success_rate=('success', lambda x: x.dropna().mean()),
    ).reset_index()

    # True pass attempts per game
    pass_att = true_passes.groupby(['passer_player_id', 'game_id']).agg(
        completions=('complete_pass', 'sum'),
        attempts=('game_id', 'count'),
        passing_yards=('passing_yards', lambda s: s.fillna(0).sum()),
        touchdowns=('pass_touchdown', 'sum'),
        interceptions=('interception', 'sum'),
    ).reset_index()

    qb_game = qb_game.merge(pass_att, on=['passer_player_id', 'game_id'], how='left')
    for col in ['completions', 'attempts', 'passing_yards', 'touchdowns', 'interceptions']:
        qb_game[col] = qb_game[col].fillna(0).astype(int)

    # aDOT per game
    adot_plays = dropbacks[
        (dropbacks['pass_attempt'] == 1) &
        (dropbacks['sack'] != 1) &
        (dropbacks['qb_scramble'] != 1)
    ]
    adot_game = adot_plays.groupby(['passer_player_id', 'game_id'])['air_yards'].apply(
        lambda x: x.dropna().mean()
    ).reset_index().rename(columns={'air_yards': 'adot'})
    qb_game = qb_game.merge(adot_game, on=['passer_player_id', 'game_id'], how='left')

    # Passer rating & YPA
    qb_game['passer_rating'] = qb_game.apply(
        lambda r: passer_rating(
            int(r['completions']), int(r['attempts']),
            int(r['passing_yards']), int(r['touchdowns']), int(r['interceptions'])
        ), axis=1
    )
    qb_game['ypa'] = qb_game.apply(
        lambda r: r['passing_yards'] / r['attempts'] if r['attempts'] > 0 else 0.0, axis=1
    )

    # --- Rush stats per game (designed runs + scrambles) ---
    designed_rushes = plays[
        (plays['rusher_player_id'].isin(qb_ids)) &
        (plays['qb_dropback'] == 0)
    ].copy()

    rush_game = designed_rushes.groupby(['rusher_player_id', 'game_id']).agg(
        rush_attempts=('epa', 'count'),
        rush_yards=('rushing_yards', lambda s: s.fillna(0).sum()),
        rush_tds=('rush_touchdown', 'sum'),
    ).reset_index().rename(columns={'rusher_player_id': 'passer_player_id'})

    # Scramble rush stats per game
    scramble_plays = dropbacks[dropbacks['qb_scramble'] == 1]
    scramble_game = scramble_plays.groupby(['passer_player_id', 'game_id']).agg(
        scr_count=('epa', 'count'),
        scr_yards=('rushing_yards', lambda s: s.fillna(0).sum()),
        scr_tds=('rush_touchdown', 'sum'),
    ).reset_index()

    qb_game = qb_game.merge(rush_game, on=['passer_player_id', 'game_id'], how='left')
    qb_game = qb_game.merge(scramble_game, on=['passer_player_id', 'game_id'], how='left')

    for col in ['rush_attempts', 'rush_yards', 'rush_tds', 'scr_count', 'scr_yards', 'scr_tds']:
        qb_game[col] = qb_game[col].fillna(0).astype(int)

    qb_game['rush_attempts'] = qb_game['rush_attempts'] + qb_game['scr_count']
    qb_game['rush_yards'] = qb_game['rush_yards'] + qb_game['scr_yards']
    qb_game['rush_tds'] = qb_game['rush_tds'] + qb_game['scr_tds']

    # --- Fumbles per game ---
    all_qb_plays = pd.concat([dropbacks, designed_rushes])
    qb_fumble_plays = all_qb_plays[all_qb_plays['fumbled_1_player_id'].isin(qb_ids)]
    if not qb_fumble_plays.empty:
        fumble_game = qb_fumble_plays.groupby(['fumbled_1_player_id', 'game_id']).agg(
            fumbles=('fumble', 'sum'),
            fumbles_lost=('fumble_lost', 'sum'),
        ).reset_index().rename(columns={'fumbled_1_player_id': 'passer_player_id'})
    else:
        fumble_game = pd.DataFrame(columns=['passer_player_id', 'game_id', 'fumbles', 'fumbles_lost'])
    qb_game = qb_game.merge(fumble_game, on=['passer_player_id', 'game_id'], how='left')
    qb_game['fumbles'] = qb_game['fumbles'].fillna(0).astype(int)
    qb_game['fumbles_lost'] = qb_game['fumbles_lost'].fillna(0).astype(int)

    # Add week from game_id
    qb_game['week'] = qb_game['game_id'].map(game_week)

    # Merge game context
    qb_game = qb_game.merge(
        game_context,
        left_on=['game_id', 'posteam'],
        right_on=['game_id', 'posteam'],
        how='left'
    )

    # Rename and select
    qb_game = qb_game.rename(columns={
        'passer_player_id': 'player_id',
        'posteam': 'team_id',
    })
    qb_game['season'] = season

    cols = [
        'player_id', 'season', 'week', 'team_id', 'opponent_id', 'home_away',
        'result', 'team_score', 'opponent_score',
        'completions', 'attempts', 'passing_yards', 'touchdowns', 'interceptions',
        'sacks', 'epa_per_dropback', 'cpoe', 'success_rate', 'adot',
        'passer_rating', 'ypa',
        'rush_attempts', 'rush_yards', 'rush_tds',
        'fumbles', 'fumbles_lost',
    ]
    result = qb_game[cols].copy()

    log.info("Aggregated weekly stats for %d QB game rows", len(result))
    return result


def aggregate_receiver_weekly_stats(plays: pd.DataFrame, roster: pd.DataFrame, season: int,
                                     participation: pd.DataFrame = None) -> pd.DataFrame:
    """Aggregate receiver weekly (game-log) stats from filtered plays."""
    # Filter to target plays
    target_plays = plays[
        (plays['receiver_player_id'].notna()) &
        (plays['pass_attempt'] == 1) &
        (plays['sack'] != 1) &
        (plays['qb_scramble'] != 1)
    ].copy()

    if target_plays.empty:
        return pd.DataFrame()

    # Position lookup
    pos_lookup = roster.groupby('gsis_id')['position'].agg(
        lambda x: x.mode().iloc[0] if len(x.mode()) > 0 else 'WR'
    ).to_dict()

    game_week = _get_game_week_map(plays)
    game_context = _derive_game_context(plays)

    # Group by receiver + game
    rec = target_plays.groupby(['receiver_player_id', 'game_id', 'posteam']).agg(
        targets=('game_id', 'count'),
        receptions=('complete_pass', 'sum'),
        receiving_yards=('receiving_yards', lambda x: x.dropna().sum()),
        epa_per_target=('epa', 'mean'),
        yac=('yards_after_catch', lambda x: x.dropna().sum()),
        air_yards=('air_yards', lambda x: x.dropna().sum()),
        adot=('air_yards', lambda x: x.dropna().mean()),
    ).reset_index().rename(columns={'receiver_player_id': 'player_id', 'posteam': 'team_id'})

    # TDs on completions only
    completed = target_plays[target_plays['complete_pass'] == 1]
    td_game = completed.groupby(['receiver_player_id', 'game_id'])['pass_touchdown'].sum().reset_index()
    td_game.columns = ['player_id', 'game_id', 'receiving_tds']
    rec = rec.merge(td_game, on=['player_id', 'game_id'], how='left')
    rec['receiving_tds'] = rec['receiving_tds'].fillna(0).astype(int)

    # Derived rates
    rec['receptions'] = rec['receptions'].astype(int)
    rec['receiving_yards'] = rec['receiving_yards'].fillna(0).astype(int)
    rec['catch_rate'] = rec['receptions'] / rec['targets']
    rec['yac_per_reception'] = rec.apply(
        lambda r: r['yac'] / r['receptions'] if r['receptions'] > 0 else float('nan'), axis=1
    )

    # Filter to skill positions
    rec['position'] = rec['player_id'].map(pos_lookup).fillna('WR')
    rec = rec[rec['position'].isin(['WR', 'TE', 'RB', 'FB'])]

    # Routes run from participation (per game)
    if participation is not None and not participation.empty:
        pass_plays_ids = plays[
            (plays['pass_attempt'] == 1) &
            (plays['sack'] != 1) &
            (plays['qb_scramble'] != 1)
        ][['game_id', 'play_id']].drop_duplicates()

        part_cols = participation[['nflverse_game_id', 'play_id', 'offense_players']].copy()
        part_cols = part_cols.dropna(subset=['offense_players'])
        part_exploded = part_cols.assign(
            player_id=part_cols['offense_players'].str.split(';')
        ).explode('player_id')
        part_exploded['player_id'] = part_exploded['player_id'].str.strip()
        part_exploded = part_exploded[part_exploded['player_id'] != '']
        part_exploded = part_exploded.drop_duplicates(['nflverse_game_id', 'play_id', 'player_id'])

        routes = part_exploded.merge(
            pass_plays_ids,
            left_on=['nflverse_game_id', 'play_id'],
            right_on=['game_id', 'play_id'],
            how='inner'
        )
        routes_per_game = routes.groupby(['player_id', 'nflverse_game_id']).size().reset_index(name='routes_run')
        routes_per_game = routes_per_game.rename(columns={'nflverse_game_id': 'game_id'})

        rec = rec.merge(routes_per_game, on=['player_id', 'game_id'], how='left')
        rec['routes_run'] = rec['routes_run'].fillna(0).astype(int)
    else:
        rec['routes_run'] = 0

    rec['yards_per_route_run'] = rec.apply(
        lambda r: r['receiving_yards'] / r['routes_run'] if r['routes_run'] > 0 else float('nan'), axis=1
    )

    # Add week and game context
    rec['week'] = rec['game_id'].map(game_week)
    rec = rec.merge(
        game_context,
        left_on=['game_id', 'team_id'],
        right_on=['game_id', 'posteam'],
        how='left'
    )
    rec.drop(columns=['posteam'], inplace=True, errors='ignore')

    rec['season'] = season

    cols = [
        'player_id', 'season', 'week', 'team_id', 'opponent_id', 'home_away',
        'result', 'team_score', 'opponent_score',
        'targets', 'receptions', 'receiving_yards', 'receiving_tds',
        'epa_per_target', 'catch_rate',
        'yac', 'yac_per_reception', 'adot', 'air_yards',
        'routes_run', 'yards_per_route_run',
    ]
    result = rec[cols].copy()

    log.info("Aggregated weekly stats for %d receiver game rows", len(result))
    return result


def aggregate_rb_weekly_stats(plays: pd.DataFrame, roster: pd.DataFrame, season: int) -> pd.DataFrame:
    """Aggregate RB weekly (game-log) stats from filtered plays."""
    # Filter to RB/FB from roster
    rb_ids = set(roster[roster['position'].isin(['RB', 'FB'])]['gsis_id'].dropna().unique())

    # Rush plays: designed runs by RBs (exclude scrambles)
    rushes = plays[
        (plays['rush_attempt'] == 1) &
        (plays['qb_scramble'] != 1) &
        (plays['rusher_player_id'].isin(rb_ids))
    ].copy()

    game_week = _get_game_week_map(plays)
    game_context = _derive_game_context(plays)

    if rushes.empty and plays[plays['receiver_player_id'].isin(rb_ids)].empty:
        return pd.DataFrame()

    # Group rush stats by rusher + game
    if not rushes.empty:
        rush_game = rushes.groupby(['rusher_player_id', 'game_id', 'posteam']).agg(
            carries=('epa', 'count'),
            rushing_yards=('rushing_yards', lambda s: s.fillna(0).sum()),
            rushing_tds=('rush_touchdown', 'sum'),
            epa_per_carry=('epa', 'mean'),
            success_rate=('success', lambda x: x.dropna().mean()),
            yards_per_carry=('yards_gained', 'mean'),
            stuff_rate=('yards_gained', lambda x: (x <= 0).mean()),
            explosive_rate=('yards_gained', lambda x: (x >= 10).mean()),
        ).reset_index().rename(columns={'rusher_player_id': 'player_id', 'posteam': 'team_id'})
    else:
        rush_game = pd.DataFrame(columns=[
            'player_id', 'game_id', 'team_id', 'carries', 'rushing_yards', 'rushing_tds',
            'epa_per_carry', 'success_rate', 'yards_per_carry', 'stuff_rate', 'explosive_rate',
        ])

    # Receiving stats for RBs
    rb_targets = plays[
        (plays['receiver_player_id'].isin(rb_ids)) &
        (plays['pass_attempt'] == 1) &
        (plays['sack'] != 1) &
        (plays['qb_scramble'] != 1)
    ].copy()

    if not rb_targets.empty:
        recv_game = rb_targets.groupby(['receiver_player_id', 'game_id']).agg(
            targets=('game_id', 'count'),
            receptions=('complete_pass', 'sum'),
            receiving_yards=('receiving_yards', lambda x: x.dropna().sum()),
        ).reset_index().rename(columns={'receiver_player_id': 'player_id'})

        completed = rb_targets[rb_targets['complete_pass'] == 1]
        recv_td = completed.groupby(['receiver_player_id', 'game_id'])['pass_touchdown'].sum().reset_index()
        recv_td.columns = ['player_id', 'game_id', 'receiving_tds']
        recv_game = recv_game.merge(recv_td, on=['player_id', 'game_id'], how='left')
        recv_game['receiving_tds'] = recv_game['receiving_tds'].fillna(0).astype(int)
        recv_game['receptions'] = recv_game['receptions'].astype(int)
        recv_game['receiving_yards'] = recv_game['receiving_yards'].fillna(0).astype(int)
    else:
        recv_game = pd.DataFrame(columns=['player_id', 'game_id', 'targets', 'receptions',
                                           'receiving_yards', 'receiving_tds'])

    # Merge rush + receiving
    if rush_game.empty and recv_game.empty:
        return pd.DataFrame()

    if not rush_game.empty and not recv_game.empty:
        rb_game = rush_game.merge(recv_game, on=['player_id', 'game_id'], how='outer')
    elif not rush_game.empty:
        rb_game = rush_game.copy()
        for col in ['targets', 'receptions', 'receiving_yards', 'receiving_tds']:
            rb_game[col] = 0
    else:
        rb_game = recv_game.copy()
        # Need team_id from plays for receive-only games
        team_map_recv = rb_targets.groupby('receiver_player_id')['posteam'].first().to_dict()
        rb_game['team_id'] = rb_game['player_id'].map(team_map_recv)
        for col in ['carries', 'rushing_yards', 'rushing_tds', 'epa_per_carry',
                     'success_rate', 'yards_per_carry', 'stuff_rate', 'explosive_rate']:
            rb_game[col] = 0

    # Fill NaN for receiving cols on rush-only games and vice versa
    for col in ['targets', 'receptions', 'receiving_yards', 'receiving_tds']:
        rb_game[col] = rb_game[col].fillna(0).astype(int)
    for col in ['carries', 'rushing_yards', 'rushing_tds']:
        rb_game[col] = rb_game[col].fillna(0).astype(int)
    for col in ['epa_per_carry', 'success_rate', 'yards_per_carry', 'stuff_rate', 'explosive_rate']:
        rb_game[col] = rb_game[col].fillna(float('nan'))

    # Fumbles per game
    all_rb_plays = pd.concat([rushes, rb_targets]) if not rb_targets.empty else rushes
    fumble_plays = all_rb_plays[all_rb_plays['fumbled_1_player_id'].isin(rb_ids)]
    if not fumble_plays.empty:
        fumble_game = fumble_plays.groupby(['fumbled_1_player_id', 'game_id']).agg(
            fumbles=('fumble', 'sum'),
            fumbles_lost=('fumble_lost', 'sum'),
        ).reset_index().rename(columns={'fumbled_1_player_id': 'player_id'})
    else:
        fumble_game = pd.DataFrame(columns=['player_id', 'game_id', 'fumbles', 'fumbles_lost'])
    rb_game = rb_game.merge(fumble_game, on=['player_id', 'game_id'], how='left')
    rb_game['fumbles'] = rb_game['fumbles'].fillna(0).astype(int)
    rb_game['fumbles_lost'] = rb_game['fumbles_lost'].fillna(0).astype(int)

    # Fill team_id for receive-only games if still NaN
    if rb_game['team_id'].isna().any():
        # Get team from receiving plays
        recv_teams = rb_targets.groupby(['receiver_player_id', 'game_id'])['posteam'].first().reset_index()
        recv_teams.columns = ['player_id', 'game_id', 'team_id_recv']
        rb_game = rb_game.merge(recv_teams, on=['player_id', 'game_id'], how='left')
        rb_game['team_id'] = rb_game['team_id'].fillna(rb_game.get('team_id_recv'))
        rb_game.drop(columns=['team_id_recv'], inplace=True, errors='ignore')

    # Add week and game context
    rb_game['week'] = rb_game['game_id'].map(game_week)
    rb_game = rb_game.merge(
        game_context,
        left_on=['game_id', 'team_id'],
        right_on=['game_id', 'posteam'],
        how='left'
    )
    rb_game.drop(columns=['posteam'], inplace=True, errors='ignore')

    rb_game['season'] = season

    cols = [
        'player_id', 'season', 'week', 'team_id', 'opponent_id', 'home_away',
        'result', 'team_score', 'opponent_score',
        'carries', 'rushing_yards', 'rushing_tds',
        'epa_per_carry', 'success_rate', 'yards_per_carry',
        'stuff_rate', 'explosive_rate',
        'targets', 'receptions', 'receiving_yards', 'receiving_tds',
        'fumbles', 'fumbles_lost',
    ]
    result = rb_game[cols].copy()

    log.info("Aggregated weekly stats for %d RB game rows", len(result))
    return result


def ensure_qb_weekly_stats_table(conn):
    """Create qb_weekly_stats table if it doesn't exist. NOT @retry."""
    with conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS qb_weekly_stats (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                player_id TEXT NOT NULL,
                season INT NOT NULL,
                week INT NOT NULL,
                team_id TEXT REFERENCES teams(id),
                opponent_id TEXT REFERENCES teams(id),
                home_away TEXT,
                result TEXT,
                team_score INT,
                opponent_score INT,
                completions INT,
                attempts INT,
                passing_yards INT,
                touchdowns INT,
                interceptions INT,
                sacks INT,
                epa_per_dropback NUMERIC,
                cpoe NUMERIC,
                success_rate NUMERIC,
                adot NUMERIC,
                passer_rating NUMERIC,
                ypa NUMERIC,
                rush_attempts INT,
                rush_yards INT,
                rush_tds INT,
                fumbles INT,
                fumbles_lost INT,
                UNIQUE (player_id, season, week)
            );
            CREATE INDEX IF NOT EXISTS idx_qb_weekly_team_season ON qb_weekly_stats(team_id, season);
        """)
        cur.execute("""
            DO $$ BEGIN
                ALTER TABLE qb_weekly_stats ENABLE ROW LEVEL SECURITY;
            EXCEPTION WHEN others THEN NULL;
            END $$;
        """)
        cur.execute("""
            DO $$ BEGIN
                CREATE POLICY "public_read" ON qb_weekly_stats FOR SELECT USING (true);
            EXCEPTION WHEN duplicate_object THEN NULL;
            END $$;
        """)
    conn.commit()
    log.info("Ensured qb_weekly_stats table exists with RLS")


def ensure_receiver_weekly_stats_table(conn):
    """Create receiver_weekly_stats table if it doesn't exist. NOT @retry."""
    with conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS receiver_weekly_stats (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                player_id TEXT NOT NULL,
                season INT NOT NULL,
                week INT NOT NULL,
                team_id TEXT REFERENCES teams(id),
                opponent_id TEXT REFERENCES teams(id),
                home_away TEXT,
                result TEXT,
                team_score INT,
                opponent_score INT,
                targets INT,
                receptions INT,
                receiving_yards INT,
                receiving_tds INT,
                epa_per_target NUMERIC,
                catch_rate NUMERIC,
                yac NUMERIC,
                yac_per_reception NUMERIC,
                adot NUMERIC,
                air_yards NUMERIC,
                routes_run INT,
                yards_per_route_run NUMERIC,
                UNIQUE (player_id, season, week)
            );
            CREATE INDEX IF NOT EXISTS idx_receiver_weekly_team_season ON receiver_weekly_stats(team_id, season);
        """)
        cur.execute("""
            DO $$ BEGIN
                ALTER TABLE receiver_weekly_stats ENABLE ROW LEVEL SECURITY;
            EXCEPTION WHEN others THEN NULL;
            END $$;
        """)
        cur.execute("""
            DO $$ BEGIN
                CREATE POLICY "public_read" ON receiver_weekly_stats FOR SELECT USING (true);
            EXCEPTION WHEN duplicate_object THEN NULL;
            END $$;
        """)
    conn.commit()
    log.info("Ensured receiver_weekly_stats table exists with RLS")


def ensure_rb_weekly_stats_table(conn):
    """Create rb_weekly_stats table if it doesn't exist. NOT @retry."""
    with conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS rb_weekly_stats (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                player_id TEXT NOT NULL,
                season INT NOT NULL,
                week INT NOT NULL,
                team_id TEXT REFERENCES teams(id),
                opponent_id TEXT REFERENCES teams(id),
                home_away TEXT,
                result TEXT,
                team_score INT,
                opponent_score INT,
                carries INT,
                rushing_yards INT,
                rushing_tds INT,
                epa_per_carry NUMERIC,
                success_rate NUMERIC,
                yards_per_carry NUMERIC,
                stuff_rate NUMERIC,
                explosive_rate NUMERIC,
                targets INT,
                receptions INT,
                receiving_yards INT,
                receiving_tds INT,
                fumbles INT,
                fumbles_lost INT,
                UNIQUE (player_id, season, week)
            );
            CREATE INDEX IF NOT EXISTS idx_rb_weekly_team_season ON rb_weekly_stats(team_id, season);
        """)
        cur.execute("""
            DO $$ BEGIN
                ALTER TABLE rb_weekly_stats ENABLE ROW LEVEL SECURITY;
            EXCEPTION WHEN others THEN NULL;
            END $$;
        """)
        cur.execute("""
            DO $$ BEGIN
                CREATE POLICY "public_read" ON rb_weekly_stats FOR SELECT USING (true);
            EXCEPTION WHEN duplicate_object THEN NULL;
            END $$;
        """)
    conn.commit()
    log.info("Ensured rb_weekly_stats table exists with RLS")


@retry(max_retries=2, delay=3)
def upsert_qb_weekly_stats(conn, df: pd.DataFrame):
    """Upsert QB weekly stats."""
    if df.empty:
        log.info("No QB weekly stats to upsert (empty DataFrame)")
        return
    cols = [
        'player_id', 'season', 'week', 'team_id', 'opponent_id', 'home_away',
        'result', 'team_score', 'opponent_score',
        'completions', 'attempts', 'passing_yards', 'touchdowns', 'interceptions',
        'sacks', 'epa_per_dropback', 'cpoe', 'success_rate', 'adot',
        'passer_rating', 'ypa',
        'rush_attempts', 'rush_yards', 'rush_tds',
        'fumbles', 'fumbles_lost',
    ]
    clean_df = df[cols].where(df[cols].notna(), None)
    rows = [tuple(r) for _, r in clean_df.iterrows()]
    col_names = ', '.join(cols)
    update_set = ', '.join(f"{c} = EXCLUDED.{c}" for c in cols if c not in ('player_id', 'season', 'week'))

    with conn.cursor() as cur:
        execute_values(
            cur,
            f"""INSERT INTO qb_weekly_stats ({col_names})
                VALUES %s
                ON CONFLICT (player_id, season, week) DO UPDATE SET {update_set}""",
            rows,
        )
    log.info("Upserted %d QB weekly stat rows", len(rows))


@retry(max_retries=2, delay=3)
def upsert_receiver_weekly_stats(conn, df: pd.DataFrame):
    """Upsert receiver weekly stats."""
    if df.empty:
        log.info("No receiver weekly stats to upsert (empty DataFrame)")
        return
    cols = [
        'player_id', 'season', 'week', 'team_id', 'opponent_id', 'home_away',
        'result', 'team_score', 'opponent_score',
        'targets', 'receptions', 'receiving_yards', 'receiving_tds',
        'epa_per_target', 'catch_rate',
        'yac', 'yac_per_reception', 'adot', 'air_yards',
        'routes_run', 'yards_per_route_run',
    ]
    clean_df = df[cols].where(df[cols].notna(), None)
    rows = [tuple(r) for _, r in clean_df.iterrows()]
    col_names = ', '.join(cols)
    update_set = ', '.join(f"{c} = EXCLUDED.{c}" for c in cols if c not in ('player_id', 'season', 'week'))

    with conn.cursor() as cur:
        execute_values(
            cur,
            f"""INSERT INTO receiver_weekly_stats ({col_names})
                VALUES %s
                ON CONFLICT (player_id, season, week) DO UPDATE SET {update_set}""",
            rows,
        )
    log.info("Upserted %d receiver weekly stat rows", len(rows))


@retry(max_retries=2, delay=3)
def upsert_rb_weekly_stats(conn, df: pd.DataFrame):
    """Upsert RB weekly stats."""
    if df.empty:
        log.info("No RB weekly stats to upsert (empty DataFrame)")
        return
    cols = [
        'player_id', 'season', 'week', 'team_id', 'opponent_id', 'home_away',
        'result', 'team_score', 'opponent_score',
        'carries', 'rushing_yards', 'rushing_tds',
        'epa_per_carry', 'success_rate', 'yards_per_carry',
        'stuff_rate', 'explosive_rate',
        'targets', 'receptions', 'receiving_yards', 'receiving_tds',
        'fumbles', 'fumbles_lost',
    ]
    clean_df = df[cols].where(df[cols].notna(), None)
    rows = [tuple(r) for _, r in clean_df.iterrows()]
    col_names = ', '.join(cols)
    update_set = ', '.join(f"{c} = EXCLUDED.{c}" for c in cols if c not in ('player_id', 'season', 'week'))

    with conn.cursor() as cur:
        execute_values(
            cur,
            f"""INSERT INTO rb_weekly_stats ({col_names})
                VALUES %s
                ON CONFLICT (player_id, season, week) DO UPDATE SET {update_set}""",
            rows,
        )
    log.info("Upserted %d RB weekly stat rows", len(rows))


# --- Player slugs ---

def ensure_player_slugs_table(conn):
    """Create player_slugs table if it doesn't exist. NOT @retry."""
    with conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS player_slugs (
                player_id TEXT PRIMARY KEY,
                slug TEXT NOT NULL UNIQUE,
                player_name TEXT NOT NULL,
                position TEXT,
                current_team_id TEXT REFERENCES teams(id),
                created_at TIMESTAMPTZ DEFAULT now(),
                updated_at TIMESTAMPTZ DEFAULT now()
            );
            CREATE INDEX IF NOT EXISTS idx_player_slugs_slug ON player_slugs(slug);
            CREATE INDEX IF NOT EXISTS idx_player_slugs_team ON player_slugs(current_team_id);
        """)
        # RLS (wrapped in exception blocks for idempotent re-runs)
        cur.execute("""
            DO $$ BEGIN
                ALTER TABLE player_slugs ENABLE ROW LEVEL SECURITY;
            EXCEPTION WHEN others THEN NULL;
            END $$;
        """)
        cur.execute("""
            DO $$ BEGIN
                CREATE POLICY "public_read" ON player_slugs FOR SELECT USING (true);
            EXCEPTION WHEN duplicate_object THEN NULL;
            END $$;
        """)
    conn.commit()
    log.info("Ensured player_slugs table exists")


def generate_player_slugs(qb_stats, receiver_stats, rb_gap_stats, roster, conn):
    """Collect all unique players, generate slugs with collision handling.

    Existing slugs are NEVER changed (immutability). Only new players get slugs.
    Collisions (e.g. two Josh Allens) are resolved by appending team abbreviation.
    """
    # Collect all unique (player_id, player_name, team) from stat DataFrames
    players = {}  # player_id -> (player_name, team_id)
    for df, name_col, team_col in [
        (qb_stats, 'player_name', 'team_id'),
        (receiver_stats, 'player_name', 'team_id'),
        (rb_gap_stats, 'player_name', 'team_id'),
    ]:
        if df is None or df.empty:
            continue
        for _, row in df.iterrows():
            pid = row.get('player_id')
            pname = row.get(name_col)
            team = row.get(team_col)
            if pid and pname and pid not in players:
                players[pid] = (pname, team)

    if not players:
        log.info("No players found for slug generation")
        return pd.DataFrame(columns=['player_id', 'slug', 'player_name', 'position', 'current_team_id'])

    # Build position lookup from roster
    pos_map = {}
    if roster is not None and not roster.empty:
        for _, row in roster.iterrows():
            gsis_id = row.get('gsis_id')
            pos = row.get('position')
            if gsis_id and pos:
                pos_map[gsis_id] = pos

    # Load existing slugs from DB (immutability — never change them)
    existing_slugs = {}  # player_id -> slug
    existing_slug_values = set()  # all slug strings in use
    if conn is not None:
        with conn.cursor() as cur:
            cur.execute("SELECT player_id, slug FROM player_slugs")
            for pid, slug in cur.fetchall():
                existing_slugs[pid] = slug
                existing_slug_values.add(slug)

    # Filter to NEW players only
    new_players = {pid: info for pid, info in players.items() if pid not in existing_slugs}
    if not new_players:
        log.info("No new players need slugs (%d already exist)", len(existing_slugs))
        # Still return full set for upsert (name/position/team updates)
        rows = []
        for pid, (pname, team) in players.items():
            rows.append({
                'player_id': pid,
                'slug': existing_slugs[pid],
                'player_name': pname,
                'position': pos_map.get(pid),
                'current_team_id': team,
            })
        return pd.DataFrame(rows)

    # Generate slugs for new players, detecting collisions
    # First pass: group new players by base slug
    slug_groups = {}  # base_slug -> [(player_id, player_name, team_id), ...]
    for pid, (pname, team) in new_players.items():
        base = make_slug(pname)
        slug_groups.setdefault(base, []).append((pid, pname, team))

    new_slug_map = {}  # player_id -> slug
    for base_slug, group in slug_groups.items():
        if len(group) == 1 and base_slug not in existing_slug_values:
            # No collision — use base slug
            pid, pname, team = group[0]
            new_slug_map[pid] = base_slug
            existing_slug_values.add(base_slug)
        else:
            # Collision: disambiguate with team abbreviation, then position if still colliding
            for pid, pname, team in group:
                team_suffix = team.lower() if team else "unknown"
                disambiguated = f"{base_slug}-{team_suffix}"
                if disambiguated in existing_slug_values:
                    # Same team collision — append position
                    pos = pos_map.get(pid, "").lower() or "x"
                    disambiguated = f"{base_slug}-{team_suffix}-{pos}"
                if disambiguated in existing_slug_values:
                    # Still colliding — append player_id suffix
                    disambiguated = f"{base_slug}-{pid[-4:]}"
                new_slug_map[pid] = disambiguated
                existing_slug_values.add(disambiguated)

    # Build result DataFrame for ALL players (existing + new)
    rows = []
    for pid, (pname, team) in players.items():
        slug = existing_slugs.get(pid) or new_slug_map.get(pid)
        if slug:
            rows.append({
                'player_id': pid,
                'slug': slug,
                'player_name': pname,
                'position': pos_map.get(pid),
                'current_team_id': team,
            })

    log.info("Generated %d new slugs (%d total players)", len(new_slug_map), len(rows))
    return pd.DataFrame(rows)


@retry(max_retries=2, delay=3)
def upsert_player_slugs(conn, df: pd.DataFrame):
    """Upsert player slugs. ON CONFLICT updates name/position/team but NEVER slug."""
    if df.empty:
        log.info("No player slugs to upsert (empty DataFrame)")
        return

    cols = ['player_id', 'slug', 'player_name', 'position', 'current_team_id']
    clean_df = df[cols].where(df[cols].notna(), None)
    rows = [tuple(r) for _, r in clean_df.iterrows()]
    col_names = ', '.join(cols)
    # Never update slug — only update name, position, team
    update_set = ', '.join(
        f"{c} = EXCLUDED.{c}" for c in ['player_name', 'position', 'current_team_id']
    )
    update_set += ", updated_at = now()"

    with conn.cursor() as cur:
        execute_values(
            cur,
            f"""INSERT INTO player_slugs ({col_names})
                VALUES %s
                ON CONFLICT (player_id) DO UPDATE SET {update_set}""",
            rows,
        )
    log.info("Upserted %d player slug rows", len(rows))


def cleanup_stale_rows(conn, season: int, team_ids: list, player_ids: list, rb_gap_player_ids: list = None, rb_gap_weekly_player_ids: list = None, def_gap_team_ids: list = None, receiver_player_ids: list = None, qb_weekly_player_ids: list = None, receiver_weekly_player_ids: list = None, rb_weekly_player_ids: list = None):
    """Delete rows for this season that are no longer in the current dataset.

    Called AFTER upserts succeed, BEFORE commit. Not retried — if it fails,
    the entire transaction rolls back via process_season's except block.
    """
    with conn.cursor() as cur:
        cur.execute(
            "DELETE FROM team_season_stats WHERE season = %s AND team_id != ALL(%s)",
            (season, team_ids),
        )
        if cur.rowcount > 0:
            log.info("Cleaned up %d stale team_season_stats rows", cur.rowcount)

        cur.execute(
            "DELETE FROM qb_season_stats WHERE season = %s AND player_id != ALL(%s)",
            (season, player_ids),
        )
        if cur.rowcount > 0:
            log.info("Cleaned up %d stale qb_season_stats rows", cur.rowcount)

        if rb_gap_player_ids is not None:
            cur.execute(
                "DELETE FROM rb_gap_stats WHERE season = %s AND player_id != ALL(%s)",
                (season, rb_gap_player_ids),
            )
            if cur.rowcount > 0:
                log.info("Cleaned up %d stale rb_gap_stats rows", cur.rowcount)

        if rb_gap_weekly_player_ids is not None:
            cur.execute(
                "DELETE FROM rb_gap_stats_weekly WHERE season = %s AND player_id != ALL(%s)",
                (season, rb_gap_weekly_player_ids),
            )
            if cur.rowcount > 0:
                log.info("Cleaned up %d stale rb_gap_stats_weekly rows", cur.rowcount)

        if def_gap_team_ids is not None:
            cur.execute(
                "DELETE FROM def_gap_stats WHERE season = %s AND team_id != ALL(%s)",
                (season, def_gap_team_ids),
            )
            if cur.rowcount > 0:
                log.info("Cleaned up %d stale def_gap_stats rows", cur.rowcount)

        if receiver_player_ids is not None and len(receiver_player_ids) > 0:
            cur.execute(
                "DELETE FROM receiver_season_stats WHERE season = %s AND player_id != ALL(%s)",
                (season, receiver_player_ids),
            )
            if cur.rowcount > 0:
                log.info("Cleaned up %d stale receiver_season_stats rows", cur.rowcount)

        if qb_weekly_player_ids is not None and len(qb_weekly_player_ids) > 0:
            cur.execute(
                "DELETE FROM qb_weekly_stats WHERE season = %s AND player_id != ALL(%s)",
                (season, qb_weekly_player_ids),
            )
            if cur.rowcount > 0:
                log.info("Cleaned up %d stale qb_weekly_stats rows", cur.rowcount)

        if receiver_weekly_player_ids is not None and len(receiver_weekly_player_ids) > 0:
            cur.execute(
                "DELETE FROM receiver_weekly_stats WHERE season = %s AND player_id != ALL(%s)",
                (season, receiver_weekly_player_ids),
            )
            if cur.rowcount > 0:
                log.info("Cleaned up %d stale receiver_weekly_stats rows", cur.rowcount)

        if rb_weekly_player_ids is not None and len(rb_weekly_player_ids) > 0:
            cur.execute(
                "DELETE FROM rb_weekly_stats WHERE season = %s AND player_id != ALL(%s)",
                (season, rb_weekly_player_ids),
            )
            if cur.rowcount > 0:
                log.info("Cleaned up %d stale rb_weekly_stats rows", cur.rowcount)


@retry(max_retries=2, delay=3)
def update_freshness(conn, season: int, through_week: int):
    """Update the data_freshness table (one row per season)."""
    with conn.cursor() as cur:
        cur.execute(
            """INSERT INTO data_freshness (season, last_updated, through_week)
               VALUES (%s, %s, %s)
               ON CONFLICT (season) DO UPDATE SET
                 last_updated = EXCLUDED.last_updated,
                 through_week = EXCLUDED.through_week""",
            (season, datetime.now(timezone.utc), through_week),
        )
    log.info("Updated freshness: season=%d, through_week=%d", season, through_week)


def validate_data(team_stats: pd.DataFrame, qb_stats: pd.DataFrame, receiver_stats: pd.DataFrame = None):
    """Sanity-check aggregated stats before writing to DB. Raises ValueError on failure."""
    errors = []

    # Team-level checks
    if (team_stats['off_epa_play'].dropna().abs() > 1.0).any():
        errors.append("Team off_epa_play outside [-1.0, 1.0]")
    if (team_stats['def_epa_play'].dropna().abs() > 1.0).any():
        errors.append("Team def_epa_play outside [-1.0, 1.0]")

    # QB-level checks
    comp_pct = qb_stats['completion_pct'].dropna()
    if (comp_pct < 0).any() or (comp_pct > 100).any():
        errors.append("QB completion_pct outside [0, 100]")

    pr = qb_stats['passer_rating'].dropna()
    if (pr < 0).any() or (pr > 158.4).any():
        errors.append("QB passer_rating outside [0, 158.3]")

    epa_db = qb_stats['epa_per_db'].dropna()
    if (epa_db.abs() > 5.0).any():
        errors.append("QB epa_per_db outside [-5.0, 5.0]")

    if receiver_stats is not None and not receiver_stats.empty:
        bad_catch = receiver_stats[(receiver_stats['catch_rate'] < 0) | (receiver_stats['catch_rate'] > 1)]
        if len(bad_catch) > 0:
            log.warning("Found %d receivers with catch_rate outside [0,1]", len(bad_catch))
        bad_ypr = receiver_stats[receiver_stats['yards_per_reception'].notna() & (receiver_stats['yards_per_reception'] > 50)]
        if len(bad_ypr) > 0:
            log.warning("Found %d receivers with yards_per_reception > 50", len(bad_ypr))
        bad_ts = receiver_stats[(receiver_stats['target_share'] < 0) | (receiver_stats['target_share'] > 1)]
        if len(bad_ts) > 0:
            log.warning("Found %d receivers with target_share outside [0,1]", len(bad_ts))

    if errors:
        raise ValueError(f"Data validation failed:\n  " + "\n  ".join(errors))
    log.info("Data validation passed")


def process_season(season: int, conn, dry_run: bool = False):
    """Full pipeline for one season."""
    log.info("=" * 50)
    log.info("Processing season %d", season)
    log.info("=" * 50)

    pbp = download_pbp(season)
    roster = download_roster(season)
    participation = download_participation(season)
    plays = filter_plays(pbp)

    team_stats = aggregate_team_stats(plays, pbp, season)
    qb_stats = aggregate_qb_stats(plays, roster, season)
    rb_gap_stats = aggregate_rb_gap_stats(plays, season)
    rb_gap_stats_weekly = aggregate_rb_gap_stats_weekly(plays, season)
    def_gap_stats = aggregate_def_gap_stats(plays, season)
    receiver_stats = aggregate_receiver_stats(plays, roster, season, participation)
    qb_weekly = aggregate_qb_weekly_stats(plays, roster, season)
    receiver_weekly = aggregate_receiver_weekly_stats(plays, roster, season, participation)
    rb_weekly = aggregate_rb_weekly_stats(plays, roster, season)
    through_week = int(plays['week'].max())

    validate_data(team_stats, qb_stats, receiver_stats)

    if dry_run:
        log.info("[DRY RUN] Would upsert: %d team rows, %d QB rows, %d RB gap rows, %d RB gap weekly rows, %d def gap rows, %d receiver rows, through_week=%d",
                 len(team_stats), len(qb_stats), len(rb_gap_stats), len(rb_gap_stats_weekly), len(def_gap_stats), len(receiver_stats), through_week)
        log.info("[DRY RUN] QB weekly: %d rows, Receiver weekly: %d rows, RB weekly: %d rows",
                 len(qb_weekly), len(receiver_weekly), len(rb_weekly))
        log.info("[DRY RUN] Aggregated %d RB gap stat rows", len(rb_gap_stats))
        log.info("[DRY RUN] Aggregated %d RB gap weekly stat rows", len(rb_gap_stats_weekly))
        log.info("[DRY RUN] Def gap: %d rows", len(def_gap_stats))
        # Log sample QBs for verification
        sample_cols = ['player_name', 'team', 'games', 'dropbacks', 'attempts', 'completions',
                       'passing_yards', 'touchdowns', 'interceptions', 'adot', 'fumbles', 'fumbles_lost',
                       'epa_per_play', 'cpoe', 'success_rate', 'rush_epa_per_play']
        avail_cols = [c for c in sample_cols if c in qb_stats.columns]
        top_qbs = qb_stats.nlargest(5, 'dropbacks')
        for _, row in top_qbs.iterrows():
            log.info("[SAMPLE] %s", {c: (round(row[c], 3) if isinstance(row[c], float) else row[c]) for c in avail_cols})
        return

    ensure_team_season_stats_columns(conn)
    ensure_rb_gap_tables(conn)
    ensure_rb_gap_weekly_tables(conn)
    ensure_def_gap_tables(conn)
    ensure_receiver_stats_table(conn)
    ensure_qb_weekly_stats_table(conn)
    ensure_receiver_weekly_stats_table(conn)
    ensure_rb_weekly_stats_table(conn)
    ensure_player_slugs_table(conn)

    try:
        upsert_teams(conn, team_stats)
        upsert_team_stats(conn, team_stats)
        upsert_qb_stats(conn, qb_stats)
        upsert_rb_gap_stats(conn, rb_gap_stats)
        upsert_rb_gap_stats_weekly(conn, rb_gap_stats_weekly)
        upsert_def_gap_stats(conn, def_gap_stats)
        upsert_receiver_stats(conn, receiver_stats)
        upsert_qb_weekly_stats(conn, qb_weekly)
        upsert_receiver_weekly_stats(conn, receiver_weekly)
        upsert_rb_weekly_stats(conn, rb_weekly)
        player_slugs_df = generate_player_slugs(qb_stats, receiver_stats, rb_gap_stats, roster, conn)
        upsert_player_slugs(conn, player_slugs_df)
        cleanup_stale_rows(
            conn, season,
            team_ids=team_stats['team_id'].unique().tolist(),
            player_ids=qb_stats['player_id'].unique().tolist(),
            rb_gap_player_ids=rb_gap_stats['player_id'].unique().tolist() if not rb_gap_stats.empty else [],
            rb_gap_weekly_player_ids=rb_gap_stats_weekly['player_id'].unique().tolist() if not rb_gap_stats_weekly.empty else [],
            def_gap_team_ids=def_gap_stats['team_id'].unique().tolist() if not def_gap_stats.empty else [],
            receiver_player_ids=receiver_stats['player_id'].unique().tolist() if not receiver_stats.empty else [],
            qb_weekly_player_ids=qb_weekly['player_id'].unique().tolist() if not qb_weekly.empty else [],
            receiver_weekly_player_ids=receiver_weekly['player_id'].unique().tolist() if not receiver_weekly.empty else [],
            rb_weekly_player_ids=rb_weekly['player_id'].unique().tolist() if not rb_weekly.empty else [],
        )
        update_freshness(conn, season, through_week)
        conn.commit()
        log.info("Season %d complete (through week %d)", season, through_week)
    except Exception:
        conn.rollback()
        log.error("Season %d FAILED — rolled back all changes", season)
        raise


def main():
    parser = argparse.ArgumentParser(description="nflverse → Supabase ETL for Yards Per Pass")
    parser.add_argument('--season', type=int, help='Process a single season')
    parser.add_argument('--all', action='store_true', help=f'Process all seasons ({FIRST_SEASON}-{CURRENT_SEASON})')
    parser.add_argument('--dry-run', action='store_true', help='Preview without writing to database')
    args = parser.parse_args()

    if not args.season and not args.all:
        parser.error("Specify --season YEAR or --all")

    seasons = list(range(FIRST_SEASON, CURRENT_SEASON + 1)) if args.all else [args.season]

    conn = None
    if not args.dry_run:
        db_url = os.environ.get('DATABASE_URL')
        if not db_url:
            log.error("DATABASE_URL not set. Add it to .env or environment.")
            sys.exit(1)
        conn = psycopg2.connect(db_url, connect_timeout=30)

    try:
        for season in seasons:
            process_season(season, conn, dry_run=args.dry_run)
    finally:
        if conn:
            conn.close()

    log.info("Done!")


if __name__ == '__main__':
    main()
