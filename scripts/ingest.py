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

REQUIRED_ROSTER_COLS = ['gsis_id', 'position']

REQUIRED_PBP_COLS = [
    'play_type', 'season_type', 'two_point_attempt', 'epa', 'success',
    'posteam', 'defteam', 'pass_attempt', 'rush_attempt', 'qb_dropback',
    'passer_player_id', 'passer_player_name', 'rusher_player_id', 'rusher_player_name',
    'complete_pass', 'sack', 'qb_scramble', 'air_yards', 'yards_gained',
    'cpoe', 'passing_yards', 'pass_touchdown', 'interception',
    'rush_touchdown', 'rushing_yards', 'game_id', 'season', 'week',
    'home_team', 'away_team', 'result',
]


def passer_rating(comp: int, att: int, yds: int, td: int, ints: int) -> float:
    """NFL passer rating formula. Returns 0-158.3 scale."""
    if att == 0:
        return 0.0
    a = max(0.0, min(((comp / att) - 0.3) * 5, 2.375))
    b = max(0.0, min(((yds / att) - 3) * 0.25, 2.375))
    c = max(0.0, min((td / att) * 20, 2.375))
    d = max(0.0, min(2.375 - ((ints / att) * 25), 2.375))
    return round(((a + b + c + d) / 6) * 100, 1)


@retry(max_retries=3, delay=5)
def download_pbp(season: int) -> pd.DataFrame:
    """Download play-by-play Parquet from nflverse."""
    url = PBP_URL.format(season=season)
    log.info("Downloading PBP for %d...", season)
    df = pd.read_parquet(url)
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
    missing = [c for c in REQUIRED_ROSTER_COLS if c not in df.columns]
    if missing:
        raise ValueError(f"Missing columns in roster data: {missing}")
    return df


def filter_plays(pbp: pd.DataFrame) -> pd.DataFrame:
    """Filter to relevant plays: pass/run, regular season, no two-point attempts."""
    mask = (
        pbp['play_type'].isin(['pass', 'run']) &
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

    # Pass rate: pass attempts / (pass attempts + rush attempts)
    pass_rate = plays.groupby('posteam').apply(
        lambda x: x['pass_attempt'].sum() / max(x['pass_attempt'].sum() + x['rush_attempt'].sum(), 1),
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

    # Merge all
    team_stats = (
        off.merge(off_pass, on='team_id', how='left')
        .merge(off_rush, on='team_id', how='left')
        .merge(pass_rate, on='team_id', how='left')
        .merge(def_, on='team_id', how='left')
        .merge(def_pass, on='team_id', how='left')
        .merge(def_rush, on='team_id', how='left')
        .merge(records, on='team_id', how='left')
    )
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
        adot=('air_yards', lambda x: x.dropna().mean()),
        touchdowns=('pass_touchdown', 'sum'),
        interceptions=('interception', 'sum'),
        games=('game_id', 'nunique'),
        success_rate_raw=('success', lambda x: x.dropna().mean()),
    ).reset_index().rename(columns={'passer_player_id': 'player_id'})

    # QB success rate: exclude sacks (OL failure, not QB decision), stored as percentage
    non_sack_dropbacks = dropbacks[dropbacks['sack'] != 1]
    sack_excl_success = non_sack_dropbacks.groupby('passer_player_id')['success'].apply(
        lambda x: x.dropna().mean() * 100
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

    # --- Designed rush stats (QB runs where qb_dropback == 0) ---
    designed_rushes = plays[
        (plays['rusher_player_id'].isin(qb_ids)) &
        (plays['qb_dropback'] == 0)
    ].copy()

    rush_stats = designed_rushes.groupby('rusher_player_id').agg(
        rush_attempts=('epa', 'count'),
        rush_epa_sum=('epa', 'sum'),
        rush_yards=('rushing_yards', 'sum'),
        rush_tds=('rush_touchdown', 'sum'),
    ).reset_index().rename(columns={'rusher_player_id': 'player_id'})

    # Scramble stats: qb_dropback==1, qb_scramble==1
    # These are NOT counted in designed rush stats above, so we must add them
    scramble_plays = dropbacks[dropbacks['qb_scramble'] == 1]
    scramble_agg = scramble_plays.groupby('passer_player_id').agg(
        scramble_count=('epa', 'count'),
        scramble_epa_sum=('epa', 'sum'),
        scramble_td_count=('rush_touchdown', 'sum'),
        scramble_yard_count=('rushing_yards', lambda s: s.fillna(0).sum()),
    ).reset_index().rename(columns={'passer_player_id': 'player_id'})

    # Merge dropback + rush + scramble stats
    qb_stats = qb_drop.merge(rush_stats, on='player_id', how='left')
    qb_stats = qb_stats.merge(scramble_agg, on='player_id', how='left')
    qb_stats['designed_rush_count'] = qb_stats['rush_attempts'].fillna(0).astype(int)
    qb_stats['designed_rush_epa'] = qb_stats['rush_epa_sum'].fillna(0)
    qb_stats['rush_yards'] = qb_stats['rush_yards'].fillna(0).astype(int)
    qb_stats['rush_tds'] = qb_stats['rush_tds'].fillna(0).astype(int)

    # Add scramble count, EPA, TDs, and yards into rush totals
    scr_count = qb_stats['scramble_count'].fillna(0).astype(int)
    scr_epa = qb_stats['scramble_epa_sum'].fillna(0)
    qb_stats['rush_attempts'] = qb_stats['designed_rush_count'] + scr_count
    qb_stats['rush_epa_sum'] = qb_stats['designed_rush_epa'] + scr_epa
    qb_stats['rush_tds'] = qb_stats['rush_tds'] + qb_stats['scramble_td_count'].fillna(0).astype(int)
    qb_stats['rush_yards'] = qb_stats['rush_yards'] + qb_stats['scramble_yard_count'].fillna(0).astype(int)

    # EPA per play (total: passing + designed rushing — scrambles already in dropback EPA)
    total_plays = qb_stats['dropback_count'] + qb_stats['designed_rush_count']
    total_epa = qb_stats['dropback_epa_sum'] + qb_stats['designed_rush_epa']
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
    ]
    result = qb_stats[cols].copy()

    # Filter to only roster QBs (removes trick-play passers like WRs/punters)
    result = result[result['player_id'].isin(qb_ids)].copy()

    log.info("Aggregated stats for %d QBs", len(result))
    return result


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


def validate_data(team_stats: pd.DataFrame, qb_stats: pd.DataFrame):
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
    plays = filter_plays(pbp)

    team_stats = aggregate_team_stats(plays, pbp, season)
    qb_stats = aggregate_qb_stats(plays, roster, season)
    through_week = int(plays['week'].max())

    validate_data(team_stats, qb_stats)

    if dry_run:
        log.info("[DRY RUN] Would upsert: %d team rows, %d QB rows, through_week=%d",
                 len(team_stats), len(qb_stats), through_week)
        return

    try:
        upsert_teams(conn, team_stats)
        upsert_team_stats(conn, team_stats)
        upsert_qb_stats(conn, qb_stats)
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
