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
from urllib.error import HTTPError

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


class DataNotYetPublished(Exception):
    """Current season's data isn't on nflverse yet (pre-season or week 1 in progress). Benign skip, not an error."""
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
                except (DataQualityError, DataNotYetPublished):
                    raise  # Fast-fail: bad/absent data won't fix itself on retry
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
SCHEDULES_URL = "https://github.com/nflverse/nflverse-data/releases/download/schedules/games.csv"

# Columns kept from the schedules file (source has ~46; the rest — betting lines,
# stadium, officials — are out of scope).
GAMES_COLS = [
    'game_id', 'season', 'game_type', 'week', 'gameday', 'weekday',
    'gametime', 'home_team', 'away_team', 'home_score', 'away_score',
]

REQUIRED_ROSTER_COLS = ['gsis_id', 'position']

REQUIRED_PBP_COLS = [
    'play_type', 'season_type', 'two_point_attempt', 'epa', 'success',
    'posteam', 'defteam', 'pass_attempt', 'rush_attempt', 'qb_dropback',
    'passer_player_id', 'passer_player_name', 'rusher_player_id', 'rusher_player_name',
    'complete_pass', 'sack', 'qb_scramble', 'air_yards', 'yards_gained',
    'cpoe', 'cp', 'passing_yards', 'pass_touchdown', 'interception',
    'rush_touchdown', 'rushing_yards', 'game_id', 'season', 'week',
    'home_team', 'away_team', 'result',
    'fumble', 'fumble_lost', 'fumbled_1_player_id',
    'receiver_player_id', 'receiver_player_name',
    'receiving_yards', 'yards_after_catch',
    'total_home_score', 'total_away_score',
    # box scores (team_game_stats): read from RAW rows, so they must exist
    'pass', 'rush', 'first_down', 'first_down_pass', 'first_down_rush', 'first_down_penalty',
    'down', 'drive', 'yardline_100', 'td_team', 'kickoff_attempt',
    'penalty', 'penalty_team', 'penalty_yards', 'fumbled_1_team',
    'drive_time_of_possession',
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
    try:
        df = pd.read_parquet(url)
    except (HTTPError, FileNotFoundError) as e:
        # 404 on the current season = file not published yet (season hasn't started). Historical 404s are real failures.
        if season >= CURRENT_SEASON and (isinstance(e, FileNotFoundError) or e.code == 404):
            raise DataNotYetPublished(f"PBP file for {season} not on nflverse yet.") from e
        raise
    if season >= CURRENT_SEASON:
        # Early season: any completed game is worth ingesting, even a single one (~180 rows)
        if len(df) == 0:
            raise DataNotYetPublished(f"PBP file for {season} is published but empty — no games completed yet.")
    elif len(df) < 1000:
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
    try:
        df = pd.read_parquet(url)
    except (HTTPError, FileNotFoundError) as e:
        if season >= CURRENT_SEASON and (isinstance(e, FileNotFoundError) or e.code == 404):
            raise DataNotYetPublished(f"Roster file for {season} not on nflverse yet.") from e
        raise
    if len(df) < 100:
        if season >= CURRENT_SEASON:
            raise DataNotYetPublished(f"Roster for {season} has only {len(df)} rows — not fully published yet.")
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


# One file holds every season, so `--all` must not re-download it per season.
_SCHEDULES_CACHE = None


@retry(max_retries=3, delay=5)
def download_schedules() -> pd.DataFrame:
    """Download the nflverse schedules CSV (all seasons, ~2 MB). Cached per process."""
    global _SCHEDULES_CACHE
    if _SCHEDULES_CACHE is not None:
        return _SCHEDULES_CACHE
    log.info("Downloading schedules...")
    df = pd.read_csv(SCHEDULES_URL)
    if len(df) < 1000:
        raise DataQualityError(f"Schedules file suspiciously small ({len(df)} rows) — expected 7,000+. Aborting.")
    missing = [c for c in GAMES_COLS if c not in df.columns]
    if missing:
        raise ValueError(f"Missing columns in schedules data: {missing}")
    log.info("Loaded %d schedule rows (all seasons)", len(df))
    _SCHEDULES_CACHE = df
    return df


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


def filter_spikes(pbp: pd.DataFrame) -> pd.DataFrame:
    """Regular-season spikes (play_type 'qb_spike'), 2-point tries excluded like
    filter_plays. filter_plays drops them, and nflverse flags a spike
    qb_dropback = 0, so the QB aggregators would never see one. Official stats
    count a spike as an incomplete pass, so aggregate_qb_stats and
    aggregate_qb_weekly_stats add these to pass attempts, and to nothing else."""
    mask = (
        (pbp['play_type'] == 'qb_spike') &
        (pbp['season_type'] == 'REG') &
        (pbp['two_point_attempt'] != 1)
    )
    return pbp[mask].copy()


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


def aggregate_qb_stats(plays: pd.DataFrame, roster: pd.DataFrame, season: int, spikes: pd.DataFrame | None = None) -> pd.DataFrame:
    """Aggregate QB season stats from filtered plays.

    Victory-formation kneeldowns are dropped here (see qb_plays below). This is
    a LOCAL filtered view — the caller's `plays` frame keeps its kneels, because
    the RB and team aggregators need them to match PFR.

    `spikes` (filter_spikes output) adds each QB's spikes to pass attempts,
    and so to Comp%, YPA, TD%, INT%, Sack%, ANY/A and passer rating; they stay
    out of dropbacks, EPA, success rate, CPOE and aDOT.
    """
    # Identify QB player IDs from roster
    qb_ids = set(roster[roster['position'] == 'QB']['gsis_id'].dropna().unique())

    # A kneeldown is worth about -1 EPA and gains a yard or two of loss, and a
    # winning team takes three or four of them a game (~420 league-wide per
    # season). Charging those to the QB costs the QBs who win the most 10-25
    # rushing EPA a season -- Lamar Jackson's real 2023 rush EPA is about +37,
    # stored as +10. They are excluded from every QB number below; the cost is
    # that rush_attempts/rush_yards now diverge slightly from PFR, which counts
    # kneels as carries. Deliberate (see the spec's "Ingest kneel fix").
    qb_plays = plays[plays['play_type'] != 'qb_kneel']

    # --- Dropback stats (qb_dropback == 1) ---
    dropbacks = qb_plays[qb_plays['qb_dropback'] == 1].copy()

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

    # Spikes are official incomplete passes (filter_spikes). Attempts only: they
    # are not dropbacks and carry no usable air yards or cp.
    if spikes is not None and not spikes.empty:
        spike_att = spikes.groupby('passer_player_id').size().reset_index(name='spike_attempts')
        spike_att = spike_att.rename(columns={'passer_player_id': 'player_id'})
        qb_drop = qb_drop.merge(spike_att, on='player_id', how='left')
        qb_drop['attempts'] = qb_drop['attempts'] + qb_drop['spike_attempts'].fillna(0).astype(int)

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
    # filter_plays() KEEPS kneeldowns (rushing stats elsewhere match PFR), so
    # they are excluded here via qb_plays instead.
    qb_rushes = qb_plays[
        (qb_plays['rush_attempt'] == 1) &
        (qb_plays['rusher_player_id'].isin(qb_ids))
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
    # Scrambles are in BOTH dropbacks (qb_dropback = 1) and qb_rushes
    # (rush_attempt = 1), so concatenating those two counted a scramble fumble
    # twice (Mayfield 2026: 4 lost, really 3). Same rule as
    # aggregate_qb_weekly_stats, so the season total matches the Game Log's sum:
    # dropbacks plus the QB's non-dropback carries.
    designed_rushes = qb_plays[(qb_plays['rusher_player_id'].isin(qb_ids)) & (qb_plays['qb_dropback'] == 0)]
    all_qb_plays = pd.concat([dropbacks, designed_rushes])
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
    scramble_count = qb_plays[
        (qb_plays['qb_scramble'] == 1) & (qb_plays['rusher_player_id'].isin(qb_ids))
    ].groupby('rusher_player_id').size().reset_index(name='scramble_count').rename(columns={'rusher_player_id': 'player_id'})
    qb_stats = qb_stats.merge(scramble_count, on='player_id', how='left')
    qb_stats['scramble_count'] = qb_stats['scramble_count'].fillna(0).astype(int)
    designed_rush_count = qb_stats['rush_attempts'] - qb_stats['scramble_count']
    total_plays = qb_stats['dropback_count'] + designed_rush_count
    total_epa = qb_stats['dropback_epa_sum'] + (qb_stats['rush_epa_sum'] - qb_plays[
        (qb_plays['qb_scramble'] == 1) & (qb_plays['rusher_player_id'].isin(qb_ids))
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

    # --- New rate stats (leaderboard overhaul 2026-03-24) ---
    qb_stats['td_pct'] = qb_stats.apply(
        lambda r: r['touchdowns'] / r['attempts'] * 100 if r['attempts'] > 0 else None, axis=1
    )
    qb_stats['int_pct'] = qb_stats.apply(
        lambda r: r['interceptions'] / r['attempts'] * 100 if r['attempts'] > 0 else None, axis=1
    )
    qb_stats['sack_pct'] = qb_stats.apply(
        lambda r: r['sacks'] / (r['attempts'] + r['sacks']) * 100 if (r['attempts'] + r['sacks']) > 0 else None, axis=1
    )
    qb_stats['scramble_pct'] = qb_stats.apply(
        lambda r: r['scrambles'] / r['dropbacks'] * 100 if r['dropbacks'] > 0 else None, axis=1
    )
    # Total EPA: sum of EPA on all dropbacks (use existing dropback_epa_sum, computed with .sum())
    qb_stats['total_epa'] = qb_stats['dropback_epa_sum']

    # Select final columns
    cols = [
        'player_id', 'player_name', 'team_id', 'season', 'games',
        'completions', 'attempts', 'dropbacks', 'epa_per_db', 'epa_per_play',
        'cpoe', 'completion_pct', 'success_rate', 'passing_yards',
        'touchdowns', 'interceptions', 'sacks', 'sack_yards_lost', 'adot', 'ypa', 'passer_rating',
        'any_a', 'rush_attempts', 'rush_yards', 'rush_tds', 'rush_epa_per_play',
        'fumbles', 'fumbles_lost',
        'td_pct', 'int_pct', 'sack_pct', 'scramble_pct', 'total_epa',
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


# ---------- Down x Distance Heatmap ----------

DISTANCE_BINS = [(1, 2, '1-2'), (3, 4, '3-4'), (5, 7, '5-7'), (8, 10, '8-10')]
DISTANCE_BIN_LABELS = ['1-2', '3-4', '5-7', '8-10', '11+']


def map_distance_bin(ydstogo):
    """Map yards-to-go to a distance bucket."""
    if pd.isna(ydstogo):
        return None
    ydstogo = int(ydstogo)
    for lo, hi, label in DISTANCE_BINS:
        if lo <= ydstogo <= hi:
            return label
    return '11+' if ydstogo >= 11 else None


def aggregate_team_down_distance_stats(plays: pd.DataFrame, season: int) -> pd.DataFrame:
    """Aggregate team rushing EPA by down x distance bin.

    Includes NFL-average rows (team_id='NFL') for league context.
    Excludes QB scrambles and kneeldowns.
    """
    cols_needed = ['down', 'ydstogo', 'rush_attempt', 'qb_scramble', 'play_type',
                   'epa', 'yards_gained', 'posteam']
    empty_cols = ['team_id', 'season', 'down', 'distance_bin', 'carries',
                  'epa_per_carry', 'success_rate', 'yards_per_carry',
                  'stuff_rate', 'explosive_rate']
    for col in cols_needed:
        if col not in plays.columns:
            log.warning("Column '%s' missing — skipping down×distance stats", col)
            return pd.DataFrame(columns=empty_cols)

    rushes = plays[
        (plays['rush_attempt'] == 1) &
        (plays['qb_scramble'] != 1) &
        (plays['play_type'] != 'qb_kneel') &
        (plays['down'].notna()) &
        (plays['ydstogo'].notna())
    ].copy()

    if rushes.empty:
        return pd.DataFrame(columns=empty_cols)

    rushes['distance_bin'] = rushes['ydstogo'].apply(map_distance_bin)
    rushes = rushes[rushes['distance_bin'].notna()]
    if rushes.empty:
        return pd.DataFrame(columns=empty_cols)

    def agg_group(df):
        return pd.Series({
            'carries': len(df),
            'epa_per_carry': df['epa'].mean(),
            'success_rate': (df['epa'] > 0).mean(),
            'yards_per_carry': df['yards_gained'].mean(),
            'stuff_rate': (df['yards_gained'] <= 0).mean(),
            'explosive_rate': (df['yards_gained'] >= 10).mean(),
        })

    # Per-team aggregation
    team_grouped = rushes.groupby(['posteam', 'down', 'distance_bin']).apply(
        agg_group, include_groups=False
    ).reset_index()
    team_grouped = team_grouped.rename(columns={'posteam': 'team_id'})
    team_grouped['season'] = season
    team_grouped['down'] = team_grouped['down'].astype(int)

    # NFL-average rows
    nfl_grouped = rushes.groupby(['down', 'distance_bin']).apply(
        agg_group, include_groups=False
    ).reset_index()
    nfl_grouped['team_id'] = 'NFL'
    nfl_grouped['season'] = season
    nfl_grouped['down'] = nfl_grouped['down'].astype(int)

    result = pd.concat([team_grouped, nfl_grouped], ignore_index=True)
    return result[empty_cols]


# ---------- Situational Efficiency ----------

TEAM_SITUATIONS = {
    'all': lambda df: df,
    'early_down': lambda df: df[df['down'].isin([1, 2])],
    'short_yardage': lambda df: df[(df['down'].isin([3, 4])) & (df['ydstogo'] <= 2)],
    'passing_down': lambda df: df[
        ((df['down'] == 2) & (df['ydstogo'] >= 7)) |
        ((df['down'] == 3) & (df['ydstogo'] >= 5))
    ],
    'redzone': lambda df: df[df['yardline_100'] <= 20],
    'goalline': lambda df: df[df['yardline_100'] <= 5],
    'late_close': lambda df: df[
        (df['wp'] >= 0.25) & (df['wp'] <= 0.75) &
        (df['game_seconds_remaining'] <= 900)
    ],
}


def aggregate_team_situational_stats(plays: pd.DataFrame, season: int) -> pd.DataFrame:
    """Aggregate team offensive EPA by game situation (pass+rush split).

    Includes NFL-average rows (team_id='NFL') for league context.
    """
    cols_needed = ['play_type', 'epa', 'posteam', 'down', 'ydstogo',
                   'yardline_100', 'wp', 'game_seconds_remaining']
    empty_cols = ['team_id', 'season', 'situation', 'plays', 'epa_per_play',
                  'success_rate', 'pass_rate', 'rush_epa_per_play',
                  'pass_epa_per_play', 'rush_success_rate', 'pass_success_rate']
    for col in cols_needed:
        if col not in plays.columns:
            log.warning("Column '%s' missing — skipping situational stats", col)
            return pd.DataFrame(columns=empty_cols)

    # Include pass and run plays (exclude kneeldowns for cleaner data)
    off_plays = plays[
        (plays['play_type'].isin(['pass', 'run'])) &
        (plays['epa'].notna()) &
        (plays['posteam'].notna())
    ].copy()

    if off_plays.empty:
        return pd.DataFrame(columns=empty_cols)

    rows = []

    def compute_sit(df, team_id, situation):
        if df.empty:
            return None
        n = len(df)
        passes = df[df['play_type'] == 'pass']
        rushes = df[df['play_type'] == 'run']
        return {
            'team_id': team_id,
            'season': season,
            'situation': situation,
            'plays': n,
            'epa_per_play': df['epa'].mean(),
            'success_rate': (df['epa'] > 0).mean(),
            'pass_rate': len(passes) / n if n > 0 else 0,
            'rush_epa_per_play': rushes['epa'].mean() if len(rushes) > 0 else None,
            'pass_epa_per_play': passes['epa'].mean() if len(passes) > 0 else None,
            'rush_success_rate': (rushes['epa'] > 0).mean() if len(rushes) > 0 else None,
            'pass_success_rate': (passes['epa'] > 0).mean() if len(passes) > 0 else None,
        }

    # Per-team, per-situation
    for team_id in off_plays['posteam'].unique():
        team_df = off_plays[off_plays['posteam'] == team_id]
        for sit_name, sit_filter in TEAM_SITUATIONS.items():
            sit_df = sit_filter(team_df)
            row = compute_sit(sit_df, team_id, sit_name)
            if row:
                rows.append(row)

    # NFL-average rows
    for sit_name, sit_filter in TEAM_SITUATIONS.items():
        sit_df = sit_filter(off_plays)
        row = compute_sit(sit_df, 'NFL', sit_name)
        if row:
            rows.append(row)

    if not rows:
        return pd.DataFrame(columns=empty_cols)

    return pd.DataFrame(rows)[empty_cols]


def aggregate_rb_season_stats(plays: pd.DataFrame, roster: pd.DataFrame, season: int) -> pd.DataFrame:
    """Aggregate RB/FB season rushing stats from filtered plays.

    Excludes QB scrambles (those are QB rushing, not RB).
    Filters to RB/FB positions from roster only.
    """
    # Identify RB/FB player IDs from roster
    rb_ids = set(roster[roster['position'].isin(['RB', 'FB'])]['gsis_id'].dropna().unique())

    # Rush plays: designed runs by RBs (exclude scrambles)
    rushes = plays[
        (plays['rush_attempt'] == 1) &
        (plays['qb_scramble'] != 1) &
        (plays['rusher_player_id'].isin(rb_ids))
    ].copy()

    if rushes.empty:
        return pd.DataFrame()

    # Get most common player name per player_id
    name_map = rushes.groupby('rusher_player_id')['rusher_player_name'].agg(
        lambda x: x.mode().iloc[0] if len(x.mode()) > 0 else x.iloc[0]
    ).to_dict()

    # Group by rusher
    rb = rushes.groupby('rusher_player_id').agg(
        carries=('epa', 'count'),
        rushing_yards=('rushing_yards', lambda s: s.fillna(0).sum()),
        rushing_tds=('rush_touchdown', 'sum'),
        epa_per_carry=('epa', 'mean'),
        total_rushing_epa=('epa', lambda s: s.dropna().sum()),
        success_rate=('success', lambda x: x.dropna().mean()),
        stuff_rate=('yards_gained', lambda x: (x <= 0).mean()),
        explosive_rate=('yards_gained', lambda x: (x >= 10).mean()),
        games=('game_id', 'nunique'),
    ).reset_index().rename(columns={'rusher_player_id': 'player_id'})

    rb['player_name'] = rb['player_id'].map(name_map)
    rb['yards_per_carry'] = rb.apply(
        lambda r: r['rushing_yards'] / r['carries'] if r['carries'] > 0 else float('nan'), axis=1
    )

    # Team assignment: team with most carries
    team_counts = rushes.groupby(['rusher_player_id', 'posteam']).size().reset_index(name='cnt')
    team_primary = team_counts.sort_values('cnt', ascending=False).drop_duplicates('rusher_player_id')
    team_primary = team_primary[['rusher_player_id', 'posteam']].rename(
        columns={'rusher_player_id': 'player_id', 'posteam': 'team_id'}
    )
    rb = rb.merge(team_primary, on='player_id', how='left')

    # Position from roster (mode = most frequent)
    pos_lookup = roster.groupby('gsis_id')['position'].agg(
        lambda x: x.mode().iloc[0] if len(x.mode()) > 0 else 'RB'
    ).to_dict()
    rb['position'] = rb['player_id'].map(pos_lookup).fillna('RB')

    # Fumbles: attribute via fumbled_1_player_id
    fumble_plays = plays[plays['fumbled_1_player_id'].isin(rb_ids)]
    if not fumble_plays.empty:
        fumble_stats = fumble_plays.groupby('fumbled_1_player_id').agg(
            fumbles=('fumble', 'sum'),
            fumbles_lost=('fumble_lost', 'sum'),
        ).reset_index().rename(columns={'fumbled_1_player_id': 'player_id'})
    else:
        fumble_stats = pd.DataFrame(columns=['player_id', 'fumbles', 'fumbles_lost'])
    rb = rb.merge(fumble_stats, on='player_id', how='left')
    rb['fumbles'] = rb['fumbles'].fillna(0).astype(int)
    rb['fumbles_lost'] = rb['fumbles_lost'].fillna(0).astype(int)

    # Receiving stats for RBs
    rec_plays = plays[
        (plays['receiver_player_id'].isin(rb_ids)) &
        (plays['pass_attempt'] == 1) &
        (plays['sack'] != 1) &
        (plays['qb_scramble'] != 1)
    ]
    rec_stats = rec_plays.groupby('receiver_player_id').agg(
        targets=('game_id', 'count'),
        receptions=('complete_pass', 'sum'),
        receiving_yards=('receiving_yards', lambda x: x.fillna(0).sum()),
        receiving_tds=('pass_touchdown', 'sum'),
    ).reset_index().rename(columns={'receiver_player_id': 'player_id'})

    rb = rb.merge(rec_stats, on='player_id', how='left')
    rb['targets'] = rb['targets'].fillna(0).astype(int)
    rb['receptions'] = rb['receptions'].fillna(0).astype(int)
    rb['receiving_yards'] = rb['receiving_yards'].fillna(0).astype(int)
    rb['receiving_tds'] = rb['receiving_tds'].fillna(0).astype(int)

    # Derived touch stats (leaderboard overhaul 2026-03-24)
    rb['total_touches'] = rb['carries'] + rb['receptions']
    rb['touches_per_game'] = rb.apply(
        lambda r: r['total_touches'] / r['games'] if r['games'] > 0 else float('nan'), axis=1
    )

    # Convert types
    rb['season'] = season
    rb['rushing_yards'] = rb['rushing_yards'].fillna(0).astype(int)
    rb['rushing_tds'] = rb['rushing_tds'].fillna(0).astype(int)
    rb['carries'] = rb['carries'].astype(int)

    # Select final columns
    cols = [
        'player_id', 'player_name', 'position', 'team_id', 'season', 'games',
        'carries', 'rushing_yards', 'rushing_tds', 'yards_per_carry',
        'epa_per_carry', 'success_rate', 'stuff_rate', 'explosive_rate',
        'fumbles', 'fumbles_lost',
        'targets', 'receptions', 'receiving_yards', 'receiving_tds',
        'total_touches', 'touches_per_game', 'total_rushing_epa',
    ]
    result = rb[cols].copy()

    log.info("Aggregated season stats for %d RBs", len(result))
    return result


def aggregate_qb_pass_location_stats(plays: pd.DataFrame, roster: pd.DataFrame, season: int) -> pd.DataFrame:
    """Aggregate QB pass attempts by field zone (depth x direction) for heat map."""
    for col in ('pass_location', 'air_yards', 'qb_spike'):
        if col not in plays.columns:
            log.warning("Column '%s' not found in PBP data — skipping pass location stats", col)
            return pd.DataFrame(columns=[
                'player_id', 'player_name', 'team_id', 'season',
                'depth_bin', 'direction_bin', 'pass_attempts', 'completions',
                'passing_yards', 'pass_tds', 'interceptions',
                'epa_sum', 'epa_per_attempt', 'completion_pct', 'yards_per_attempt', 'adot', 'cpoe', 'passer_rating',
            ])

    qb_ids = set(roster[roster['position'] == 'QB']['gsis_id'].dropna().unique())

    passes = plays[
        (plays['pass_attempt'] == 1) &
        (plays['sack'] != 1) &
        (plays['qb_scramble'] != 1) &
        (plays['qb_spike'] != 1) &
        (plays['passer_player_id'].isin(qb_ids)) &
        (plays['air_yards'].notna()) &
        (plays['pass_location'].notna())
    ].copy()

    if passes.empty:
        return pd.DataFrame(columns=[
            'player_id', 'player_name', 'team_id', 'season',
            'depth_bin', 'direction_bin', 'pass_attempts', 'completions',
            'passing_yards', 'pass_tds', 'interceptions',
            'epa_sum', 'epa_per_attempt', 'completion_pct', 'adot', 'passer_rating',
        ])

    # Bin depth
    passes['depth_bin'] = pd.cut(
        passes['air_yards'],
        bins=[-999, 10, 20, 999],
        labels=['short', 'intermediate', 'deep'],
        right=False,
    )
    passes['direction_bin'] = passes['pass_location']

    # Name map
    name_map = passes.groupby('passer_player_id')['passer_player_name'].agg(
        lambda x: x.mode().iloc[0] if len(x.mode()) > 0 else x.iloc[0]
    ).to_dict()

    # Team assignment: most attempts
    team_counts = passes.groupby(['passer_player_id', 'posteam']).size().reset_index(name='cnt')
    team_primary = team_counts.sort_values('cnt', ascending=False).drop_duplicates('passer_player_id')
    team_map = dict(zip(team_primary['passer_player_id'], team_primary['posteam']))

    # Aggregate
    grouped = passes.groupby(['passer_player_id', 'depth_bin', 'direction_bin'], observed=True).agg(
        pass_attempts=('epa', 'count'),
        completions=('complete_pass', 'sum'),
        passing_yards=('passing_yards', lambda s: s.fillna(0).sum()),
        pass_tds=('pass_touchdown', 'sum'),
        interceptions=('interception', 'sum'),
        epa_sum=('epa', lambda s: s.dropna().sum()),
        adot=('air_yards', lambda s: s.dropna().mean()),
        cpoe=('cpoe', lambda s: s.dropna().mean()),
    ).reset_index()

    grouped = grouped.rename(columns={'passer_player_id': 'player_id'})
    grouped['player_name'] = grouped['player_id'].map(name_map)
    grouped['team_id'] = grouped['player_id'].map(team_map)
    grouped['season'] = season
    grouped['epa_per_attempt'] = grouped['epa_sum'] / grouped['pass_attempts']
    grouped['completion_pct'] = grouped['completions'] / grouped['pass_attempts']
    grouped['yards_per_attempt'] = grouped['passing_yards'] / grouped['pass_attempts']

    # Passer rating — only for zones with 5+ attempts
    def calc_passer_rating(row):
        if row['pass_attempts'] < 5:
            return None
        return passer_rating(
            int(row['completions']), int(row['pass_attempts']),
            int(row['passing_yards']), int(row['pass_tds']), int(row['interceptions'])
        )
    grouped['passer_rating'] = grouped.apply(calc_passer_rating, axis=1)

    # Convert categorical to string for DB
    grouped['depth_bin'] = grouped['depth_bin'].astype(str)
    grouped['direction_bin'] = grouped['direction_bin'].astype(str)

    log.info("Aggregated %d QB pass location zones for %d QBs",
             len(grouped), grouped['player_id'].nunique())

    return grouped


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

    # --- New receiver stats (leaderboard overhaul 2026-03-24) ---

    # AY% (Air Yards Share): player air_yards / team total air_yards (primary team)
    team_total_air_yards = target_plays.groupby('posteam')['air_yards'].apply(
        lambda x: x.dropna().sum()
    ).to_dict()
    # Use primary-team air yards only (same logic as target_share)
    player_team_air_yards = target_plays.groupby(['receiver_player_id', 'posteam'])['air_yards'].apply(
        lambda x: x.dropna().sum()
    ).reset_index(name='primary_air_yards')
    player_team_air_yards.columns = ['player_id', 'team_id', 'primary_air_yards']
    rec = rec.merge(player_team_air_yards, on=['player_id', 'team_id'], how='left')
    rec['air_yards_share'] = rec.apply(
        lambda r: r['primary_air_yards'] / team_total_air_yards.get(r['team_id'], 1)
        if pd.notna(r.get('primary_air_yards')) and team_total_air_yards.get(r['team_id'], 0) > 0 else float('nan'), axis=1
    )
    rec.drop(columns=['primary_air_yards'], inplace=True)

    # CROE (Catch Rate Over Expected): catch_rate - mean(cp) per receiver
    # NULL if <50% of targets have valid cp (avoids volatile estimates)
    cp_stats = target_plays.groupby('receiver_player_id').agg(
        expected_catch_rate=('cp', lambda x: x.dropna().mean() if x.notna().mean() >= 0.5 else float('nan')),
        cp_coverage=('cp', lambda x: x.notna().mean()),
    ).reset_index().rename(columns={'receiver_player_id': 'player_id'})
    low_cp = cp_stats[cp_stats['cp_coverage'] < 0.8]
    if not low_cp.empty:
        log.warning("%d receivers have >20%% targets missing cp values", len(low_cp))
    rec = rec.merge(cp_stats[['player_id', 'expected_catch_rate']], on='player_id', how='left')
    rec['croe'] = rec['catch_rate'] - rec['expected_catch_rate']
    rec.drop(columns=['expected_catch_rate'], inplace=True)

    # Receiving Success Rate: mean(success) on target plays (success is binary 0/1, 1 when EPA > 0)
    recv_sr = target_plays.groupby('receiver_player_id')['success'].apply(
        lambda x: x.dropna().mean()
    ).reset_index(name='receiving_success_rate').rename(columns={'receiver_player_id': 'player_id'})
    rec = rec.merge(recv_sr, on='player_id', how='left')

    # Total Receiving EPA: sum of EPA on all target plays
    total_recv_epa = target_plays.groupby('receiver_player_id')['epa'].apply(
        lambda x: x.dropna().sum()
    ).reset_index(name='total_receiving_epa').rename(columns={'receiver_player_id': 'player_id'})
    rec = rec.merge(total_recv_epa, on='player_id', how='left')

    # No participation file for this season (nflverse 404s until it publishes
    # one): routes and snaps are UNKNOWN, not zero. Replace the 0/NaN
    # placeholders above with None in an object column — the one form the
    # upsert's `.where(notna, None)` hands to psycopg2 as NULL (a float NaN
    # column stays NaN and lands in Postgres as 'NaN'; see upsert_player_slugs).
    if participation is None or participation.empty:
        for col in ('routes_run', 'total_snaps', 'snap_share',
                    'route_participation_rate', 'yards_per_route_run',
                    'targets_per_route_run'):
            rec[col] = None

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
        'air_yards_share', 'croe', 'receiving_success_rate', 'total_receiving_epa',
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
        'td_pct', 'int_pct', 'sack_pct', 'scramble_pct', 'total_epa',
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


def ensure_qb_season_stats_columns(conn):
    """Add new columns to qb_season_stats (idempotent). NOT inside @retry.
    QB table created via schema.sql — this adds columns from leaderboard overhaul."""
    with conn.cursor() as cur:
        for col, typ in [
            ('td_pct', 'NUMERIC'),
            ('int_pct', 'NUMERIC'),
            ('sack_pct', 'NUMERIC'),
            ('scramble_pct', 'NUMERIC'),
            ('total_epa', 'NUMERIC'),
        ]:
            cur.execute(f"ALTER TABLE qb_season_stats ADD COLUMN IF NOT EXISTS {col} {typ};")
    conn.commit()
    log.info("Ensured qb_season_stats has new rate/EPA columns")


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
        # Add route columns + leaderboard overhaul columns (idempotent for existing tables)
        for col, typ in [('routes_run', 'INTEGER'), ('yards_per_route_run', 'NUMERIC'), ('targets_per_route_run', 'NUMERIC'),
                         ('total_snaps', 'INTEGER'), ('snap_share', 'NUMERIC'), ('route_participation_rate', 'NUMERIC'),
                         ('air_yards_share', 'NUMERIC'), ('croe', 'NUMERIC'), ('receiving_success_rate', 'NUMERIC'), ('total_receiving_epa', 'NUMERIC')]:
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
        'air_yards_share', 'croe', 'receiving_success_rate', 'total_receiving_epa',
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


def ensure_rb_season_stats_table(conn):
    """Create rb_season_stats table if it doesn't exist. NOT @retry."""
    with conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS rb_season_stats (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                player_id TEXT NOT NULL,
                player_name TEXT NOT NULL,
                position TEXT NOT NULL,
                team_id TEXT REFERENCES teams(id),
                season INTEGER NOT NULL,
                games INTEGER,
                carries INTEGER,
                rushing_yards INTEGER,
                rushing_tds INTEGER,
                yards_per_carry NUMERIC,
                epa_per_carry NUMERIC,
                success_rate NUMERIC,
                stuff_rate NUMERIC,
                explosive_rate NUMERIC,
                fumbles INTEGER,
                fumbles_lost INTEGER,
                UNIQUE(player_id, season)
            );
            CREATE INDEX IF NOT EXISTS idx_rb_season ON rb_season_stats(season);
            CREATE INDEX IF NOT EXISTS idx_rb_team ON rb_season_stats(team_id, season);
        """)
        for col, typ in [('targets', 'INTEGER'), ('receptions', 'INTEGER'), ('receiving_yards', 'INTEGER'), ('receiving_tds', 'INTEGER'),
                         ('total_touches', 'INTEGER'), ('touches_per_game', 'NUMERIC'), ('total_rushing_epa', 'NUMERIC')]:
            cur.execute(f"ALTER TABLE rb_season_stats ADD COLUMN IF NOT EXISTS {col} {typ};")
        cur.execute("""
            DO $$ BEGIN
                ALTER TABLE rb_season_stats ENABLE ROW LEVEL SECURITY;
            EXCEPTION WHEN others THEN NULL;
            END $$;
        """)
        cur.execute("""
            DO $$ BEGIN
                CREATE POLICY "public_read" ON rb_season_stats FOR SELECT USING (true);
            EXCEPTION WHEN duplicate_object THEN NULL;
            END $$;
        """)
    conn.commit()
    log.info("Ensured rb_season_stats table exists")


@retry(max_retries=2, delay=3)
def upsert_rb_season_stats(conn, df: pd.DataFrame):
    """Upsert RB season stats into rb_season_stats table."""
    if df.empty:
        log.info("No RB season stats to upsert (empty DataFrame)")
        return

    cols = [
        'player_id', 'player_name', 'position', 'team_id', 'season', 'games',
        'carries', 'rushing_yards', 'rushing_tds', 'yards_per_carry',
        'epa_per_carry', 'success_rate', 'stuff_rate', 'explosive_rate',
        'fumbles', 'fumbles_lost',
        'targets', 'receptions', 'receiving_yards', 'receiving_tds',
        'total_touches', 'touches_per_game', 'total_rushing_epa',
    ]
    clean_df = df[cols].where(df[cols].notna(), None)
    rows = [tuple(r) for _, r in clean_df.iterrows()]
    col_names = ', '.join(cols)
    update_set = ', '.join(f"{c} = EXCLUDED.{c}" for c in cols if c not in ('player_id', 'season'))

    with conn.cursor() as cur:
        execute_values(
            cur,
            f"""INSERT INTO rb_season_stats ({col_names})
                VALUES %s
                ON CONFLICT (player_id, season) DO UPDATE SET {update_set}""",
            rows,
        )
    log.info("Upserted %d RB season rows", len(rows))


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


def aggregate_qb_weekly_stats(plays: pd.DataFrame, roster: pd.DataFrame, season: int, spikes: pd.DataFrame | None = None) -> pd.DataFrame:
    """Aggregate QB weekly (game-log) stats from filtered plays.

    Kneeldowns are dropped from the QB numbers exactly as in
    aggregate_qb_stats, so the Game Log's rush yards and fantasy points still
    sum to the season card above it. LOCAL view only — the caller's `plays`
    frame is never modified.

    `spikes` (filter_spikes output) adds each QB's spikes to pass attempts,
    and so to Comp%, YPA, TD%, INT%, Sack%, ANY/A and passer rating; they stay
    out of dropbacks, EPA, success rate, CPOE and aDOT.
    """
    qb_ids = set(roster[roster['position'] == 'QB']['gsis_id'].dropna().unique())

    qb_plays = plays[plays['play_type'] != 'qb_kneel']

    # --- Dropback stats ---
    dropbacks = qb_plays[qb_plays['qb_dropback'] == 1].copy()

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

    # Game-week map and score/opponent context: read the FULL frame, kneels
    # included. These are game-level facts, not QB stats, and a kneel-only tail
    # should never be able to change a game's week or final score.
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

    if spikes is not None and not spikes.empty:
        spike_att = spikes.groupby(['passer_player_id', 'game_id']).size().reset_index(name='spike_attempts')
        qb_game = qb_game.merge(spike_att, on=['passer_player_id', 'game_id'], how='left')
        qb_game['attempts'] = qb_game['attempts'] + qb_game['spike_attempts'].fillna(0).astype(int)

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
    # qb_plays, so victory-formation kneels do not land in the game log.
    designed_rushes = qb_plays[
        (qb_plays['rusher_player_id'].isin(qb_ids)) &
        (qb_plays['qb_dropback'] == 0)
    ].copy()
    # A success on a carry the count sees: rush_attempts counts non-null-EPA
    # rows, so the flag is restricted to those same rows (box score spec §10.1).
    designed_rushes['rush_succ'] = (
        (designed_rushes['success'] == 1) & designed_rushes['epa'].notna()
    ).astype(int)

    rush_game = designed_rushes.groupby(['rusher_player_id', 'game_id']).agg(
        rush_attempts=('epa', 'count'),
        rush_yards=('rushing_yards', lambda s: s.fillna(0).sum()),
        rush_tds=('rush_touchdown', 'sum'),
        rush_epa_sum=('epa', 'sum'),
        rush_succ=('rush_succ', 'sum'),
    ).reset_index().rename(columns={'rusher_player_id': 'passer_player_id'})

    # Scramble rush stats per game
    scramble_plays = dropbacks[dropbacks['qb_scramble'] == 1].copy()
    scramble_plays['rush_succ'] = (
        (scramble_plays['success'] == 1) & scramble_plays['epa'].notna()
    ).astype(int)
    scramble_game = scramble_plays.groupby(['passer_player_id', 'game_id']).agg(
        scr_count=('epa', 'count'),
        scr_yards=('rushing_yards', lambda s: s.fillna(0).sum()),
        scr_tds=('rush_touchdown', 'sum'),
        scr_epa_sum=('epa', 'sum'),
        scr_succ=('rush_succ', 'sum'),
    ).reset_index()

    qb_game = qb_game.merge(rush_game, on=['passer_player_id', 'game_id'], how='left')
    qb_game = qb_game.merge(scramble_game, on=['passer_player_id', 'game_id'], how='left')

    for col in ['rush_attempts', 'rush_yards', 'rush_tds', 'scr_count', 'scr_yards', 'scr_tds',
                'rush_succ', 'scr_succ']:
        qb_game[col] = qb_game[col].fillna(0).astype(int)
    for col in ['rush_epa_sum', 'scr_epa_sum']:
        qb_game[col] = qb_game[col].fillna(0.0)

    qb_game['rush_attempts'] = qb_game['rush_attempts'] + qb_game['scr_count']
    qb_game['rush_yards'] = qb_game['rush_yards'] + qb_game['scr_yards']
    qb_game['rush_tds'] = qb_game['rush_tds'] + qb_game['scr_tds']

    # Rush EPA/carry and success rate over exactly the carries rush_attempts
    # counts — designed runs plus scrambles (box score spec §10.1). _ratio (the
    # team_game_stats helper) gives None (SQL NULL, never NaN) for a game with no
    # carries and returns a dtype=object Series, so the None survives
    # upsert_qb_weekly_stats' .where(notna, None).
    qb_game['rush_epa_total'] = qb_game['rush_epa_sum'] + qb_game['scr_epa_sum']
    qb_game['rush_succ_total'] = qb_game['rush_succ'] + qb_game['scr_succ']
    qb_game['rush_epa_per_carry'] = _ratio(qb_game, 'rush_epa_total', 'rush_attempts')
    qb_game['rush_success_rate'] = _ratio(qb_game, 'rush_succ_total', 'rush_attempts')

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
        'rush_epa_per_carry', 'rush_success_rate',
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

    # Same rule as the season table: no participation file -> NULL, not 0/NaN.
    if participation is None or participation.empty:
        result['routes_run'] = None
        result['yards_per_route_run'] = None

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


def ensure_qb_weekly_stats_columns(conn):
    """Add QB rushing EPA/success columns to qb_weekly_stats (idempotent). NOT inside @retry.
    ensure_qb_weekly_stats_table is CREATE TABLE IF NOT EXISTS only, so it cannot
    add columns to the table that already exists in production (box score spec §10.1)."""
    with conn.cursor() as cur:
        for col, typ in [
            ('rush_epa_per_carry', 'NUMERIC'),
            ('rush_success_rate', 'NUMERIC'),
        ]:
            cur.execute(f"ALTER TABLE qb_weekly_stats ADD COLUMN IF NOT EXISTS {col} {typ};")
    conn.commit()
    log.info("Ensured qb_weekly_stats has rush_epa_per_carry/rush_success_rate columns")


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
        'rush_epa_per_carry', 'rush_success_rate',
        'fumbles', 'fumbles_lost',
    ]
    # NaN/None -> None (SQL NULL, never 'NaN'::numeric): `.where(df[cols].notna(),
    # None)` does NOT reliably do this — pandas reads the None as "fill with the
    # default NA", so a genuine float64 NaN (e.g. adot/cpoe for a QB whose only
    # dropback is a sack) survives and reaches execute_values as a bare nan.
    # pd.isna(v) checked before any cast, as upsert_team_game_stats already does.
    clean_df = df[cols].astype(object)
    rows = [
        tuple(None if pd.isna(v) else v for v in row)
        for row in clean_df.itertuples(index=False, name=None)
    ]
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


# --- QB pass location stats ---

def ensure_qb_pass_location_tables(conn):
    """Create qb_pass_location_stats table if it doesn't exist."""
    with conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS qb_pass_location_stats (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                player_id TEXT NOT NULL,
                player_name TEXT NOT NULL,
                team_id TEXT NOT NULL REFERENCES teams(id),
                season INT NOT NULL,
                depth_bin TEXT NOT NULL,
                direction_bin TEXT NOT NULL,
                pass_attempts INT NOT NULL,
                completions INT NOT NULL,
                passing_yards NUMERIC,
                pass_tds INT DEFAULT 0,
                interceptions INT DEFAULT 0,
                epa_sum NUMERIC,
                epa_per_attempt NUMERIC,
                completion_pct NUMERIC,
                yards_per_attempt NUMERIC,
                adot NUMERIC,
                cpoe NUMERIC,
                passer_rating NUMERIC,
                UNIQUE (player_id, season, depth_bin, direction_bin)
            )
        """)
        # Add columns if table already exists (migrations)
        for col in ('cpoe', 'yards_per_attempt'):
            cur.execute(f"""
                DO $$ BEGIN
                    ALTER TABLE qb_pass_location_stats ADD COLUMN IF NOT EXISTS {col} NUMERIC;
                END $$
            """)
        cur.execute("""
            DO $$ BEGIN
                ALTER TABLE qb_pass_location_stats ENABLE ROW LEVEL SECURITY;
            EXCEPTION WHEN others THEN NULL;
            END $$
        """)
        cur.execute("""
            DO $$ BEGIN
                CREATE POLICY "public_read" ON qb_pass_location_stats FOR SELECT USING (true);
            EXCEPTION WHEN duplicate_object THEN NULL;
            END $$
        """)
    conn.commit()
    log.info("Ensured qb_pass_location_stats table exists with RLS")


@retry(max_retries=2, delay=3)
def upsert_qb_pass_location_stats(conn, df: pd.DataFrame):
    """Upsert QB pass location stats."""
    if df.empty:
        log.info("No QB pass location stats to upsert")
        return

    cols = ['player_id', 'player_name', 'team_id', 'season',
            'depth_bin', 'direction_bin', 'pass_attempts', 'completions',
            'passing_yards', 'pass_tds', 'interceptions',
            'epa_sum', 'epa_per_attempt', 'completion_pct', 'yards_per_attempt', 'adot', 'cpoe', 'passer_rating']
    clean_df = df[cols].where(df[cols].notna(), None)
    rows = [tuple(r) for _, r in clean_df.iterrows()]
    col_names = ', '.join(cols)
    update_set = ', '.join(
        f"{c} = EXCLUDED.{c}" for c in cols
        if c not in ('player_id', 'season', 'depth_bin', 'direction_bin')
    )

    with conn.cursor() as cur:
        execute_values(
            cur,
            f"INSERT INTO qb_pass_location_stats ({col_names}) VALUES %s "
            f"ON CONFLICT (player_id, season, depth_bin, direction_bin) DO UPDATE SET {update_set}",
            rows,
        )
    log.info("Upserted %d QB pass location stat rows", len(rows))


# --- Down x Distance table ---

def ensure_team_down_distance_table(conn):
    """Create team_down_distance_stats table. NOT @retry."""
    with conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS team_down_distance_stats (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                team_id TEXT NOT NULL,
                season INT NOT NULL,
                down INT NOT NULL,
                distance_bin TEXT NOT NULL,
                carries INT NOT NULL,
                epa_per_carry NUMERIC,
                success_rate NUMERIC,
                yards_per_carry NUMERIC,
                stuff_rate NUMERIC,
                explosive_rate NUMERIC,
                UNIQUE (team_id, season, down, distance_bin)
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS idx_dd_season_team ON team_down_distance_stats(season, team_id)")
        cur.execute("""DO $$ BEGIN ALTER TABLE team_down_distance_stats ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN others THEN NULL; END $$""")
        cur.execute("""DO $$ BEGIN CREATE POLICY "public_read" ON team_down_distance_stats FOR SELECT USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$""")
    conn.commit()
    log.info("Ensured team_down_distance_stats table exists with RLS")


@retry(max_retries=2, delay=3)
def upsert_team_down_distance_stats(conn, df: pd.DataFrame):
    """Upsert team down×distance rushing stats."""
    if df.empty:
        log.info("No down×distance stats to upsert")
        return

    cols = ['team_id', 'season', 'down', 'distance_bin', 'carries',
            'epa_per_carry', 'success_rate', 'yards_per_carry',
            'stuff_rate', 'explosive_rate']
    clean_df = df[cols].where(df[cols].notna(), None)
    rows = [tuple(r) for _, r in clean_df.iterrows()]
    col_names = ', '.join(cols)
    update_set = ', '.join(
        f"{c} = EXCLUDED.{c}" for c in cols
        if c not in ('team_id', 'season', 'down', 'distance_bin')
    )

    with conn.cursor() as cur:
        execute_values(
            cur,
            f"INSERT INTO team_down_distance_stats ({col_names}) VALUES %s "
            f"ON CONFLICT (team_id, season, down, distance_bin) DO UPDATE SET {update_set}",
            rows,
        )
    log.info("Upserted %d team down×distance rows", len(rows))


# --- Situational Efficiency table ---

def ensure_team_situational_table(conn):
    """Create team_situational_stats table. NOT @retry."""
    with conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS team_situational_stats (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                team_id TEXT NOT NULL,
                season INT NOT NULL,
                situation TEXT NOT NULL,
                plays INT NOT NULL,
                epa_per_play NUMERIC,
                success_rate NUMERIC,
                pass_rate NUMERIC,
                rush_epa_per_play NUMERIC,
                pass_epa_per_play NUMERIC,
                rush_success_rate NUMERIC,
                pass_success_rate NUMERIC,
                UNIQUE (team_id, season, situation)
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS idx_sit_season_team ON team_situational_stats(season, team_id)")
        cur.execute("""DO $$ BEGIN ALTER TABLE team_situational_stats ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN others THEN NULL; END $$""")
        cur.execute("""DO $$ BEGIN CREATE POLICY "public_read" ON team_situational_stats FOR SELECT USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$""")
    conn.commit()
    log.info("Ensured team_situational_stats table exists with RLS")


@retry(max_retries=2, delay=3)
def upsert_team_situational_stats(conn, df: pd.DataFrame):
    """Upsert team situational efficiency stats."""
    if df.empty:
        log.info("No situational stats to upsert")
        return

    cols = ['team_id', 'season', 'situation', 'plays', 'epa_per_play',
            'success_rate', 'pass_rate', 'rush_epa_per_play',
            'pass_epa_per_play', 'rush_success_rate', 'pass_success_rate']
    clean_df = df[cols].where(df[cols].notna(), None)
    rows = [tuple(r) for _, r in clean_df.iterrows()]
    col_names = ', '.join(cols)
    update_set = ', '.join(
        f"{c} = EXCLUDED.{c}" for c in cols
        if c not in ('team_id', 'season', 'situation')
    )

    with conn.cursor() as cur:
        execute_values(
            cur,
            f"INSERT INTO team_situational_stats ({col_names}) VALUES %s "
            f"ON CONFLICT (team_id, season, situation) DO UPDATE SET {update_set}",
            rows,
        )
    log.info("Upserted %d team situational rows", len(rows))


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
        # Added after initial deploy — existing installs gain the columns here
        cur.execute("ALTER TABLE player_slugs ADD COLUMN IF NOT EXISTS headshot_url TEXT;")
        cur.execute("ALTER TABLE player_slugs ADD COLUMN IF NOT EXISTS jersey_number INTEGER;")
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


# Season stats tables whose players must ALL have a slug, in every season —
# not just the season being ingested.
SLUG_SOURCE_TABLES = ('qb_season_stats', 'receiver_season_stats',
                      'rb_season_stats', 'rb_gap_stats')


def find_unslugged_players(conn):
    """Players with season stats in ANY season but no player_slugs row.

    Returns {player_id: [(season, player_name, team_id), ...]}, newest season
    first. Direct SQL (psycopg2), so Supabase's 1000-row REST cap does not
    apply. Runs inside process_season's transaction, so the rows upserted
    earlier in the same run are included.
    """
    union = " UNION ".join(
        f"SELECT player_id, player_name, team_id, season FROM {t}"
        for t in SLUG_SOURCE_TABLES
    )
    with conn.cursor() as cur:
        cur.execute(f"""
            SELECT s.player_id, s.player_name, s.team_id, s.season
            FROM ({union}) s
            WHERE s.player_id IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM player_slugs p
                              WHERE p.player_id = s.player_id)
            ORDER BY s.player_id, s.season DESC, s.team_id
        """)
        rows = cur.fetchall()
    out = {}
    for pid, pname, team, season in rows:
        out.setdefault(pid, []).append((season, pname, team))
    return out


def _roster_full_names(roster):
    """{gsis_id: (full_name, position)} from one season's roster.

    Latest week wins, the same rule generate_player_slugs uses. Rows without
    a full name are skipped; a missing full_name column yields {}.
    """
    out = {}
    if roster is None or roster.empty:
        return out
    ordered = (roster.sort_values('week', na_position='first')
               if 'week' in roster.columns else roster)
    for _, row in ordered.iterrows():
        gsis_id = row.get('gsis_id')
        full_name = row.get('full_name')
        if gsis_id and full_name is not None and pd.notna(full_name):
            pos = row.get('position')
            out[gsis_id] = (full_name, pos if pos is not None and pd.notna(pos) else None)
    return out


def generate_player_slugs(qb_stats, receiver_stats, rb_gap_stats, roster, conn, season=None):
    """Collect all unique players, generate slugs with collision handling.

    Existing slugs are NEVER changed (immutability). Only new players get slugs.
    Collisions (e.g. two Josh Allens) are resolved by appending team abbreviation.
    When conn and season are given, also backfills a slug for every player who has season stats in any season but no slug (see find_unslugged_players).
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
        return pd.DataFrame(columns=['player_id', 'slug', 'player_name', 'position',
                                     'current_team_id', 'headshot_url', 'jersey_number'])

    # Build position + full name lookups from roster
    pos_map = {}
    full_name_map = {}  # gsis_id -> full_name (for better slugs than "P.Mahomes")
    headshot_map = {}   # gsis_id -> headshot_url (latest week wins)
    jersey_map = {}     # gsis_id -> jersey_number (latest week wins)
    if roster is not None and not roster.empty:
        # Sort by week so later rows overwrite earlier ones — the most recent
        # week's jersey/headshot wins (players change numbers mid-season).
        # (rows with no week sort first so a real week always wins)
        # Side effect, intentional: pos_map/full_name_map are written in the same
        # loop, so they become latest-week-wins too. That is the correct reading
        # for a traded or position-changed player; previously they took whatever
        # row order the parquet happened to have.
        roster_iter = (roster.sort_values('week', na_position='first')
                       if 'week' in roster.columns else roster)
        for _, row in roster_iter.iterrows():
            gsis_id = row.get('gsis_id')
            pos = row.get('position')
            full_name = row.get('full_name')
            if gsis_id and pos:
                pos_map[gsis_id] = pos
            if gsis_id and full_name and pd.notna(full_name):
                full_name_map[gsis_id] = full_name
            # Columns are nullable and may be absent entirely — access softly
            headshot = row.get('headshot_url')
            if gsis_id and headshot is not None and pd.notna(headshot):
                headshot_map[gsis_id] = headshot
            jersey = row.get('jersey_number')
            if gsis_id and jersey is not None and pd.notna(jersey):
                try:
                    jersey_map[gsis_id] = int(jersey)
                except (TypeError, ValueError, OverflowError):
                    pass  # unparseable/infinite jersey must not kill the ingest

    # Replace abbreviated names (P.Mahomes) with full names (Patrick Mahomes) for slug generation
    for pid in players:
        if pid in full_name_map:
            pname, team = players[pid]
            players[pid] = (full_name_map[pid], team)

    # Load existing slugs from DB. Slugs are immutable: a stored slug is never
    # removed or regenerated here, even when the roster's name has changed
    # since (Gabriel/Gabe Davis, Kenneth/Kenny Gainwell). Removing one kills
    # the old URL and, for a player with no stats this season, leaves him with
    # no page at all. No commit here either: process_season commits once.
    existing_slugs = {}  # player_id -> slug
    existing_slug_values = set()  # all slug strings in use
    if conn is not None:
        with conn.cursor() as cur:
            cur.execute("SELECT player_id, slug FROM player_slugs")
            for pid, old_slug in cur.fetchall():
                existing_slugs[pid] = old_slug
                existing_slug_values.add(old_slug)

    # Backfill: every player with season stats in ANY season needs a slug, not
    # only this season's players. A NEW slug for a player with older stats is
    # built from the roster of his newest stats season other than the one
    # being ingested (the name his existing pages were built under), so on a
    # current-season run a lost slug comes back as the same URL no matter when
    # this runs. Players whose only stats are this season keep today's rule
    # (this season's roster name).
    slug_name_override = {}  # player_id -> name used ONLY to build a new slug
    if conn is not None and season is not None:
        unslugged = {pid: rows for pid, rows in find_unslugged_players(conn).items()
                     if pid not in existing_slugs}
        src_season = {}
        for pid, rows in unslugged.items():
            older = [r for r in rows if r[0] != season]
            src_season[pid] = older[0][0] if older else season  # rows are newest-first
        other_rosters = {}  # season -> {gsis_id: (full_name, position)}, None = download failed
        for s in sorted({v for v in src_season.values() if v != season}):
            try:
                other_rosters[s] = _roster_full_names(download_roster(s))
            except Exception as e:
                log.warning("Slug backfill: could not load the %d roster (%s) — "
                            "those players get their slugs on a later run", s, e)
                other_rosters[s] = None
        for pid, rows in unslugged.items():
            s = src_season[pid]
            _, stats_name, stats_team = next(r for r in rows if r[0] == s)
            if s != season:
                names = other_rosters.get(s)
                if names is None:
                    # No slug this run rather than a different, permanent one
                    players.pop(pid, None)
                    continue
                old_name, old_pos = names.get(pid, (None, None))
                slug_name_override[pid] = old_name or full_name_map.get(pid) or stats_name
                if pid not in pos_map and old_pos:
                    pos_map[pid] = old_pos
            if pid not in players:
                players[pid] = (full_name_map.get(pid) or slug_name_override.get(pid) or stats_name,
                                stats_team)
        if unslugged:
            log.info("Slug backfill: %d players with stats but no slug", len(unslugged))

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
                'headshot_url': headshot_map.get(pid),
                'jersey_number': jersey_map.get(pid),
            })
        return pd.DataFrame(rows)

    # Generate slugs for new players, detecting collisions
    # First pass: group new players by base slug
    slug_groups = {}  # base_slug -> [(player_id, player_name, team_id), ...]
    for pid, (pname, team) in new_players.items():
        base = make_slug(slug_name_override.get(pid, pname))
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
                    pos = (pos_map.get(pid) if isinstance(pos_map.get(pid), str) else "").lower() or "x"
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
                'headshot_url': headshot_map.get(pid),
                'jersey_number': jersey_map.get(pid),
            })

    log.info("Generated %d new slugs (%d total players)", len(new_slug_map), len(rows))
    return pd.DataFrame(rows)


@retry(max_retries=2, delay=3)
def upsert_player_slugs(conn, df: pd.DataFrame):
    """Upsert player slugs. ON CONFLICT updates name/position/team but NEVER slug."""
    if df.empty:
        log.info("No player slugs to upsert (empty DataFrame)")
        return

    cols = ['player_id', 'slug', 'player_name', 'position', 'current_team_id',
            'headshot_url', 'jersey_number']
    # Missing jersey/headshot MUST reach psycopg2 as None. A mixed roster gives
    # jersey_number a float64 dtype and headshot_url the pandas 3 string dtype,
    # neither of which can hold None — and `.where(cond, None)` does not help:
    # pandas reads that None as "fill with the default NA", so NaN survives.
    # psycopg2 then adapts it as 'NaN'::float and Postgres rejects it for the
    # INTEGER/TEXT columns, killing the whole ingest. So place None explicitly.
    # int(v) too: the float64 column yields 17.0 where the column wants 17.
    clean_df = df[cols].astype(object)
    rows = [
        tuple(
            None if pd.isna(v) else (int(v) if c == 'jersey_number' else v)
            for c, v in zip(cols, row)
        )
        for row in clean_df.itertuples(index=False, name=None)
    ]
    col_names = ', '.join(cols)
    # Never update slug — only update name, position, team, headshot, jersey
    update_set = ', '.join(
        f"{c} = EXCLUDED.{c}"
        for c in ['player_name', 'position', 'current_team_id',
                  'headshot_url', 'jersey_number']
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


# --- Schedules / games ---

def ensure_games_table(conn):
    """Create games table (nflverse schedules) if it doesn't exist. NOT @retry."""
    with conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS games (
                game_id TEXT PRIMARY KEY,
                season INT,
                game_type TEXT,
                week INT,
                gameday DATE,
                weekday TEXT,
                gametime TEXT,
                home_team TEXT,
                away_team TEXT,
                home_score REAL,
                away_score REAL,
                created_at TIMESTAMPTZ DEFAULT now(),
                updated_at TIMESTAMPTZ DEFAULT now()
            );
            CREATE INDEX IF NOT EXISTS idx_games_season_home ON games(season, home_team);
            CREATE INDEX IF NOT EXISTS idx_games_season_away ON games(season, away_team);
        """)
        # RLS (wrapped in exception blocks for idempotent re-runs)
        cur.execute("""
            DO $$ BEGIN
                ALTER TABLE games ENABLE ROW LEVEL SECURITY;
            EXCEPTION WHEN others THEN NULL;
            END $$;
        """)
        cur.execute("""
            DO $$ BEGIN
                CREATE POLICY "public_read" ON games FOR SELECT USING (true);
            EXCEPTION WHEN duplicate_object THEN NULL;
            END $$;
        """)
    conn.commit()
    log.info("Ensured games table exists with RLS")


def ingest_schedules(conn, season: int):
    """Upsert one season's schedule + results into games.

    Future games carry null scores and fill in as they're played, so this runs
    every refresh: ON CONFLICT updates scores plus gameday/gametime/weekday
    (reschedules move the date AND the day name).

    conn is None (dry run) → log the would-upsert count and write nothing.
    """
    schedules = download_schedules()
    df = schedules[schedules['season'] == season]
    if df.empty:
        log.warning("No schedule rows for season %d — nothing to ingest", season)
        return
    df = df[GAMES_COLS]

    if conn is None:
        log.info("[DRY RUN] Would upsert %d schedule rows for %d", len(df), season)
        return

    # Missing scores/gametime MUST reach psycopg2 as None. home_score is float64
    # and gametime the pandas 3 string dtype, neither of which can hold None —
    # and `.where(cond, None)` does not help (pandas reads that None as "fill
    # with the default NA", so NaN survives) and psycopg2 adapts NaN as
    # 'NaN'::float, which Postgres rejects for REAL/TEXT. So place None
    # explicitly. int()/float() too: numpy scalars have no psycopg2 adapter.
    clean_df = df.astype(object)
    rows = []
    for row in clean_df.itertuples(index=False, name=None):
        values = []
        for c, v in zip(GAMES_COLS, row):
            if pd.isna(v):
                values.append(None)
            elif c in ('season', 'week'):
                values.append(int(v))
            elif c in ('home_score', 'away_score'):
                values.append(float(v))
            else:
                values.append(str(v))
        rows.append(tuple(values))

    col_names = ', '.join(GAMES_COLS)
    update_set = ', '.join(
        f"{c} = EXCLUDED.{c}"
        for c in ['home_score', 'away_score', 'gameday', 'gametime', 'weekday']
    )
    update_set += ", updated_at = now()"

    try:
        ensure_games_table(conn)
        with conn.cursor() as cur:
            execute_values(
                cur,
                f"""INSERT INTO games ({col_names})
                    VALUES %s
                    ON CONFLICT (game_id) DO UPDATE SET {update_set}""",
                rows,
            )
        conn.commit()
    except Exception:
        # Leave the connection usable — process_season runs next on this same conn
        conn.rollback()
        log.error("Schedules ingest for %d FAILED — rolled back", season)
        raise
    log.info("Upserted %d schedule rows for %d", len(rows), season)


# --- team_game_stats: one row per team per game (box score spec §4/§5) ---

# Play types that are a snap from scrimmage. no_play (penalty-wiped) rows,
# kicks and timeouts are not.
_SCRIMMAGE_PLAY_TYPES = ('pass', 'run', 'qb_kneel', 'qb_spike')

TEAM_GAME_STATS_COLS = [
    'game_id', 'team_id', 'season', 'week', 'opponent_id', 'home_away',
    # efficiency (nflfastR / rbsdm play set)
    'plays', 'epa_per_play', 'success_rate', 'first_down_rate',
    'pass_plays', 'pass_epa_per_play', 'pass_success_rate', 'pass_first_down_rate',
    'rush_plays', 'rush_epa_per_play', 'rush_success_rate', 'rush_first_down_rate',
    'early_plays', 'early_epa_per_play', 'early_success_rate',
    'late_plays', 'late_epa_per_play', 'late_success_rate',
    'explosive_plays', 'explosive_rate', 'explosive_pass', 'explosive_rush',
    # what it cost them
    'epa_lost_turnovers', 'epa_lost_sacks', 'epa_lost_penalties',
    # traditional (official box-score conventions)
    'first_downs', 'first_downs_pass', 'first_downs_rush', 'first_downs_penalty',
    'third_down_att', 'third_down_conv', 'fourth_down_att', 'fourth_down_conv',
    'total_plays', 'total_yards', 'total_drives', 'yards_per_play',
    'net_passing_yards', 'completions', 'attempts', 'yards_per_pass',
    'interceptions', 'sacks', 'sack_yards',
    'rushing_yards', 'rushing_attempts', 'yards_per_rush',
    'red_zone_trips', 'red_zone_tds', 'penalties', 'penalty_yards',
    'turnovers', 'fumbles_lost', 'def_st_tds', 'time_of_possession_seconds',
    # for the player tables (target share denominator)
    'team_targets',
]

# Counts and yard totals: 0 when the team had none, never NULL.
TEAM_GAME_STATS_INT_COLS = [
    'plays', 'pass_plays', 'rush_plays', 'early_plays', 'late_plays',
    'explosive_plays', 'explosive_pass', 'explosive_rush',
    'first_downs', 'first_downs_pass', 'first_downs_rush', 'first_downs_penalty',
    'third_down_att', 'third_down_conv', 'fourth_down_att', 'fourth_down_conv',
    'total_plays', 'total_yards', 'total_drives', 'net_passing_yards',
    'completions', 'attempts', 'interceptions', 'sacks', 'sack_yards',
    'rushing_yards', 'rushing_attempts', 'red_zone_trips', 'red_zone_tds',
    'penalties', 'penalty_yards', 'turnovers', 'fumbles_lost', 'def_st_tds',
    'team_targets',
]

# EPA sums: 0.0 when the team had no such plays (BUF lost 0.00 EPA to turnovers).
TEAM_GAME_STATS_SUM_COLS = ['epa_lost_turnovers', 'epa_lost_sacks', 'epa_lost_penalties']

# Rates: NULL when the denominator is 0 (a team with no rush plays has no rush EPA/play).
TEAM_GAME_STATS_RATE_COLS = [
    'epa_per_play', 'success_rate', 'first_down_rate',
    'pass_epa_per_play', 'pass_success_rate', 'pass_first_down_rate',
    'rush_epa_per_play', 'rush_success_rate', 'rush_first_down_rate',
    'early_epa_per_play', 'early_success_rate', 'late_epa_per_play', 'late_success_rate',
    'explosive_rate', 'yards_per_play', 'yards_per_pass', 'yards_per_rush',
]


def _ratio(frame: pd.DataFrame, num: str, den: str) -> pd.Series:
    """num / den per row as Python floats; None where den is 0 (stored as NULL,
    never NaN). dtype=object keeps the None — a plain list of floats and None
    would become a float64 column with NaN."""
    return pd.Series([float(n) / float(d) if d else None for n, d in zip(frame[num], frame[den])],
                     index=frame.index, dtype=object)


def _top_seconds(value):
    """'12:34' -> 754. None for a missing or unparseable drive_time_of_possession."""
    if pd.isna(value):
        return None
    parts = str(value).split(':')
    if len(parts) != 2:
        return None
    try:
        return int(parts[0]) * 60 + int(parts[1])
    except ValueError:
        return None


def _team_game_frame(reg: pd.DataFrame) -> pd.DataFrame:
    """One row per (game_id, team_id) for every game in the frame — both teams,
    even one that never had the ball — with week, opponent_id and home_away."""
    games = reg.groupby('game_id').agg(
        week=('week', 'first'),
        home_team=('home_team', 'first'),
        away_team=('away_team', 'first'),
    ).reset_index()
    # Malformed-caller-only (real nflverse always populates both), but this must
    # not be silent while the null-week drop below is loud — match it (review M6).
    bad_teams = games['home_team'].isna() | games['away_team'].isna()
    if bad_teams.any():
        bad_game_ids = sorted(games.loc[bad_teams, 'game_id'].unique())
        log.warning("Dropping %d game(s) with unresolvable home_team/away_team: %s",
                    len(bad_game_ids), bad_game_ids)
    games = games.dropna(subset=['home_team', 'away_team'])
    home = games.rename(columns={'home_team': 'team_id', 'away_team': 'opponent_id'})
    home['home_away'] = 'home'
    away = games.rename(columns={'away_team': 'team_id', 'home_team': 'opponent_id'})
    away['home_away'] = 'away'
    frame = pd.concat([home, away], ignore_index=True)
    return frame[['game_id', 'team_id', 'week', 'opponent_id', 'home_away']]


def _team_game_efficiency(reg: pd.DataFrame) -> pd.DataFrame:
    """Efficiency set (spec §4): pass == 1 or rush == 1, EPA present, a possessing
    team. Kneels drop out on their own (pass = rush = 0); 2-point tries are KEPT
    (they have a null down, so early + late can be one short of plays)."""
    eff = reg[((reg['pass'] == 1) | (reg['rush'] == 1)) & reg['epa'].notna() & reg['posteam'].notna()].copy()
    eff['succ'] = (eff['success'] == 1).astype(int)
    eff['fd'] = (eff['first_down'] == 1).astype(int)
    # Scrambles are pass plays for EPA (pass = 1, rush = 0) but explosive RUNS.
    # Both rules are penalty-safe: no_play rows have yards_gained 0.
    eff['expl_pass'] = ((eff['complete_pass'] == 1) & (eff['yards_gained'] >= 20)).astype(int)
    eff['expl_rush'] = (((eff['rush'] == 1) | (eff['qb_scramble'] == 1)) & (eff['yards_gained'] >= 10)).astype(int)

    def sums(sub: pd.DataFrame, prefix: str, first_down: bool) -> pd.DataFrame:
        spec = {
            f'{prefix}plays': ('epa', 'size'),
            f'{prefix}epa_sum': ('epa', 'sum'),
            f'{prefix}succ_sum': ('succ', 'sum'),
        }
        if first_down:
            spec[f'{prefix}fd_sum'] = ('fd', 'sum')
        return sub.groupby(['game_id', 'posteam']).agg(**spec)

    parts = [
        sums(eff, '', True),
        sums(eff[eff['pass'] == 1], 'pass_', True),
        sums(eff[eff['rush'] == 1], 'rush_', True),
        sums(eff[eff['down'].isin([1, 2])], 'early_', False),
        sums(eff[eff['down'].isin([3, 4])], 'late_', False),
        eff.groupby(['game_id', 'posteam']).agg(
            explosive_pass=('expl_pass', 'sum'),
            explosive_rush=('expl_rush', 'sum'),
        ),
    ]
    out = pd.concat(parts, axis=1).reset_index().rename(columns={'posteam': 'team_id'})
    out['explosive_plays'] = out['explosive_pass'].fillna(0) + out['explosive_rush'].fillna(0)
    return out


def _team_game_costs(reg: pd.DataFrame) -> pd.DataFrame:
    """Turnovers (attributed by fumbled_1_team, spec §4) and the EPA lost to
    turnovers, sacks and the team's OWN penalties."""
    off = reg[reg['posteam'].notna()].copy()
    off['is_int'] = (off['interception'] == 1).astype(int)
    # fumble_lost flags the PLAY; fumbled_1_team says who lost the ball. A pick the
    # defence fumbles back is 1 turnover, not 2 (spec §4).
    # Known limitation (spec §4), 1 of 544 2025 team-games — 2025_14_PHI_LAC: when a
    # pick AND a SEPARATE lost fumble happen on one snap, the second fumble is
    # recorded only in fumbled_2_team, which this rule does not read, so it counts 1
    # where 2 is right. There is no test for it: fumbled_2_team is not a column the
    # aggregator reads or the fixture carries, so no synthetic row can reproduce it.
    off['is_fl'] = ((off['fumble_lost'] == 1) & (off['fumbled_1_team'] == off['posteam'])).astype(int)
    # to_epa/sack_epa feed epa_lost_turnovers/epa_lost_sacks: the EFFICIENCY set
    # (spec §4 keeps 2-point tries here, same reasoning as epa_lost_sacks). This
    # is deliberately NOT the no2 (2-pt-excluded) mask used for interceptions/
    # fumbles_lost/turnovers below — don't make these match (review I1).
    off['to_epa'] = off['epa'].where((off['is_int'] == 1) | (off['is_fl'] == 1), 0.0)
    off['sack_epa'] = off['epa'].where(off['sack'] == 1, 0.0)
    # interceptions/fumbles_lost/turnovers are TRADITIONAL (official box-score)
    # counts, so two-point tries are excluded here — matching attempts/
    # completions/sacks in _team_game_traditional's `no2` — even though the same
    # play's EPA still counts above via the efficiency-set `off` frame (I1).
    no2 = off['two_point_attempt'] != 1
    off['is_int_trad'] = off['is_int'].where(no2, 0)
    off['is_fl_trad'] = off['is_fl'].where(no2, 0)
    own = off.groupby(['game_id', 'posteam']).agg(
        interceptions=('is_int_trad', 'sum'),
        fumbles_lost=('is_fl_trad', 'sum'),
        epa_lost_turnovers=('to_epa', 'sum'),
        epa_lost_sacks=('sack_epa', 'sum'),
    ).reset_index().rename(columns={'posteam': 'team_id'})
    own['turnovers'] = own['interceptions'] + own['fumbles_lost']

    # This team's own flags only (penalty_team == team), on offence AND defence.
    # EPA belongs to the possessing team, so a flag while defending is subtracted.
    # .notna() drops a penalty with no team recorded — checked against real data
    # during spec review (0 such rows in 2026 week 1 or anywhere in 2025), so this
    # is a deliberate, verified filter, not a silent gap.
    pen = reg[(reg['penalty'] == 1) & reg['penalty_team'].notna()].copy()
    pen['signed_epa'] = pen['epa'].fillna(0.0).where(pen['posteam'] == pen['penalty_team'], -pen['epa'].fillna(0.0))
    flags = pen.groupby(['game_id', 'penalty_team']).agg(
        penalties=('penalty', 'size'),
        penalty_yards=('penalty_yards', lambda s: s.fillna(0).sum()),
        epa_lost_penalties=('signed_epa', 'sum'),
    ).reset_index().rename(columns={'penalty_team': 'team_id'})
    return own.merge(flags, on=['game_id', 'team_id'], how='outer')


def _team_game_traditional(reg: pd.DataFrame) -> pd.DataFrame:
    """Official box-score counts (spec §4 traditional set), from RAW rows."""
    off = reg[reg['posteam'].notna()].copy()
    no2 = off[off['two_point_attempt'] != 1].copy()
    no2['is_att'] = ((no2['pass_attempt'] == 1) & (no2['sack'] != 1)).astype(int)
    no2['is_comp'] = (no2['complete_pass'] == 1).astype(int)
    no2['is_rush'] = (no2['rush_attempt'] == 1).astype(int)
    # A sack on a 2-point try is excluded too (spec §4 Total Yards: "2-pt
    # excluded") — official box scores don't count 2-point plays in team
    # stats at all, so this stays on no2 like attempts/completions above.
    no2['is_sack'] = (no2['sack'] == 1).astype(int)
    no2['sack_yds'] = no2['yards_gained'].fillna(0).where(no2['sack'] == 1, 0.0)
    passing = no2.groupby(['game_id', 'posteam']).agg(
        attempts=('is_att', 'sum'),
        completions=('is_comp', 'sum'),
        passing_yards=('passing_yards', lambda s: s.fillna(0).sum()),
        rushing_attempts=('is_rush', 'sum'),
        rushing_yards=('rushing_yards', lambda s: s.fillna(0).sum()),
        sacks=('is_sack', 'sum'),
        sack_yards_raw=('sack_yds', 'sum'),
    )

    off['fdp'] = (off['first_down_pass'] == 1).astype(int)
    off['fdr'] = (off['first_down_rush'] == 1).astype(int)
    off['fdn'] = (off['first_down_penalty'] == 1).astype(int)
    misc = off.groupby(['game_id', 'posteam']).agg(
        first_downs_pass=('fdp', 'sum'),
        first_downs_rush=('fdr', 'sum'),
        first_downs_penalty=('fdn', 'sum'),
        total_drives=('drive', 'nunique'),
    )

    # 3rd / 4th down: snaps from scrimmage on that down (no_play excluded), a
    # conversion when the PLAY gained the first down — first_down_rush or
    # first_down_pass (nflverse sets them on touchdowns too). The bare
    # first_down flag also fires on a penalty first down (a 2-yard scramble plus
    # a 15-yard personal foul, 2026_01_GB_MIN play 705), which ESPN does not
    # count as a conversion: 6 team-games in 2026 weeks 1-2. A play that reaches
    # the line AND draws a flag still converts (first_down_rush is set).
    scrim = off[off['play_type'].isin(_SCRIMMAGE_PLAY_TYPES) & (off['two_point_attempt'] != 1)].copy()
    scrim['conv'] = ((scrim['first_down_rush'] == 1) | (scrim['first_down_pass'] == 1)).astype(int)
    downs = {}
    for down, prefix in ((3, 'third'), (4, 'fourth')):
        d = scrim[scrim['down'] == down].groupby(['game_id', 'posteam']).agg(
            att=('conv', 'size'), conv=('conv', 'sum'),
        )
        downs[f'{prefix}_down_att'] = d['att']
        downs[f'{prefix}_down_conv'] = d['conv']
    downs = pd.DataFrame(downs)

    # Red zone is drive-level, ESPN's rule (checked on all 62 team-games of 2026
    # weeks 1-2): a trip once a scrimmage snap OR a field-goal attempt starts
    # INSIDE the 20. yardline_100 < 20, so a snap from the 20 itself is not one
    # (WAS's TD pass from the DAL 20; kneels that start at the 20). The FG clause
    # catches a drive whose only snap inside the 20 is the kick (MIA's FG from the
    # LV 19 after a 30-yard catch). A kneel-only drive strictly inside the 20
    # still counts (DEN, 2026_02_JAX_DEN). No 2-point tries, no no_play rows.
    # A score when that drive ends in a TD by THIS team (td_team), so a
    # red-zone pick-six is not credited to the offence.
    rz_plays = off[(off['play_type'].isin(_SCRIMMAGE_PLAY_TYPES) | (off['play_type'] == 'field_goal'))
                   & (off['two_point_attempt'] != 1)]
    rz_drives = rz_plays[(rz_plays['yardline_100'] < 20) & rz_plays['drive'].notna()][['game_id', 'posteam', 'drive']].drop_duplicates()
    td_drives = off[(off['td_team'] == off['posteam']) & off['drive'].notna()][['game_id', 'posteam', 'drive']].drop_duplicates()
    td_drives['rz_td'] = 1
    rz = rz_drives.merge(td_drives, on=['game_id', 'posteam', 'drive'], how='left')
    red_zone = rz.groupby(['game_id', 'posteam']).agg(
        red_zone_trips=('drive', 'size'),
        red_zone_tds=('rz_td', lambda s: int(s.fillna(0).sum())),
    )

    # Time of possession: one drive_time_of_possession per (game, team, drive)
    # over ALL raw rows — a drive with no scrimmage play still owns its clock.
    top = off[off['drive'].notna()].groupby(['game_id', 'posteam', 'drive'])['drive_time_of_possession'].first()
    top = top.map(_top_seconds).reset_index()
    top_sum = top.groupby(['game_id', 'posteam'])['drive_time_of_possession'].agg(
        top_seconds=lambda s: s.dropna().sum(),
        top_known=lambda s: s.notna().sum(),
    )

    # Defensive / special-teams TDs: credited to a team that did not have the
    # ball. nflverse sets posteam to the RECEIVING team on kickoffs, so a
    # kickoff-return TD has td_team == posteam and needs the kickoff clause.
    tds = reg[reg['td_team'].notna()]
    dst = tds[(tds['posteam'] != tds['td_team']) | (tds['kickoff_attempt'] == 1)]
    def_st = dst.groupby(['game_id', 'td_team']).size().rename('def_st_tds')
    def_st.index = def_st.index.set_names(['game_id', 'posteam'])

    out = pd.concat([passing, misc, downs, red_zone, top_sum, def_st], axis=1).reset_index()
    return out.rename(columns={'posteam': 'team_id'})


def _team_game_targets(reg: pd.DataFrame) -> pd.DataFrame:
    """team_targets: exactly the plays aggregate_receiver_weekly_stats counts
    (filter_plays' play types, no 2-pt, a receiver, a non-sack non-scramble pass
    attempt), so every player's target share sums to 100%."""
    tgt = reg[
        reg['play_type'].isin(['pass', 'run', 'qb_kneel']) &
        (reg['two_point_attempt'] != 1) &
        reg['receiver_player_id'].notna() &
        (reg['pass_attempt'] == 1) &
        (reg['sack'] != 1) &
        (reg['qb_scramble'] != 1) &
        reg['posteam'].notna()
    ]
    return tgt.groupby(['game_id', 'posteam']).size().rename('team_targets').reset_index().rename(columns={'posteam': 'team_id'})


def aggregate_team_game_stats(pbp: pd.DataFrame, season: int) -> pd.DataFrame:
    """One row per team per regular-season game from RAW play-by-play (box score
    spec §4/§5). Takes the unfiltered frame, like aggregate_team_stats' pbp
    argument: time of possession, drives, penalties and red zone need the
    kicking and no_play rows that filter_plays drops.

    Counts and yard totals are 0 when a team had none; EPA sums are 0.0; rates
    are None (SQL NULL, never NaN) when their denominator is 0.
    """
    if pbp.empty or 'season_type' not in pbp.columns:
        return pd.DataFrame(columns=TEAM_GAME_STATS_COLS)
    reg = pbp[pbp['season_type'] == 'REG']
    if reg.empty:
        return pd.DataFrame(columns=TEAM_GAME_STATS_COLS)

    frame = _team_game_frame(reg)
    for part in (_team_game_efficiency(reg), _team_game_costs(reg),
                 _team_game_traditional(reg), _team_game_targets(reg)):
        frame = frame.merge(part, on=['game_id', 'team_id'], how='left')

    # Derived totals (spec §4): sack yards are negative in the raw data and only
    # enter total/net yards that way; the stored sack_yards is positive.
    frame['sack_yards_raw'] = frame['sack_yards_raw'].fillna(0.0)
    frame['passing_yards'] = frame['passing_yards'].fillna(0.0)
    frame['rushing_yards'] = frame['rushing_yards'].fillna(0.0)
    frame['net_passing_yards'] = frame['passing_yards'] + frame['sack_yards_raw']
    frame['total_yards'] = frame['net_passing_yards'] + frame['rushing_yards']
    frame['sack_yards'] = -frame['sack_yards_raw']
    for c in ('attempts', 'sacks', 'rushing_attempts'):
        frame[c] = frame[c].fillna(0)
    frame['total_plays'] = frame['rushing_attempts'] + frame['attempts'] + frame['sacks']
    frame['dropbacks'] = frame['attempts'] + frame['sacks']
    # Sum of parts on purpose: one play can be a rush AND a penalty first down,
    # and only the sum reaches ESPN's total (spec §4).
    frame['first_downs'] = (frame['first_downs_pass'].fillna(0) + frame['first_downs_rush'].fillna(0)
                            + frame['first_downs_penalty'].fillna(0))

    for c in TEAM_GAME_STATS_INT_COLS:
        frame[c] = frame[c].fillna(0).astype(int)
    for c in TEAM_GAME_STATS_SUM_COLS:
        frame[c] = frame[c].fillna(0.0).astype(float)
    for c in ('epa_sum', 'succ_sum', 'fd_sum', 'pass_epa_sum', 'pass_succ_sum', 'pass_fd_sum',
              'rush_epa_sum', 'rush_succ_sum', 'rush_fd_sum', 'early_epa_sum', 'early_succ_sum',
              'late_epa_sum', 'late_succ_sum'):
        frame[c] = frame[c].fillna(0.0)

    frame['epa_per_play'] = _ratio(frame, 'epa_sum', 'plays')
    frame['success_rate'] = _ratio(frame, 'succ_sum', 'plays')
    frame['first_down_rate'] = _ratio(frame, 'fd_sum', 'plays')
    frame['pass_epa_per_play'] = _ratio(frame, 'pass_epa_sum', 'pass_plays')
    frame['pass_success_rate'] = _ratio(frame, 'pass_succ_sum', 'pass_plays')
    frame['pass_first_down_rate'] = _ratio(frame, 'pass_fd_sum', 'pass_plays')
    frame['rush_epa_per_play'] = _ratio(frame, 'rush_epa_sum', 'rush_plays')
    frame['rush_success_rate'] = _ratio(frame, 'rush_succ_sum', 'rush_plays')
    frame['rush_first_down_rate'] = _ratio(frame, 'rush_fd_sum', 'rush_plays')
    frame['early_epa_per_play'] = _ratio(frame, 'early_epa_sum', 'early_plays')
    frame['early_success_rate'] = _ratio(frame, 'early_succ_sum', 'early_plays')
    frame['late_epa_per_play'] = _ratio(frame, 'late_epa_sum', 'late_plays')
    frame['late_success_rate'] = _ratio(frame, 'late_succ_sum', 'late_plays')
    frame['explosive_rate'] = _ratio(frame, 'explosive_plays', 'plays')
    frame['yards_per_play'] = _ratio(frame, 'total_yards', 'total_plays')
    frame['yards_per_pass'] = _ratio(frame, 'net_passing_yards', 'dropbacks')
    frame['yards_per_rush'] = _ratio(frame, 'rushing_yards', 'rushing_attempts')

    # Possession: the summed clock of the team's drives; NULL only when it had
    # drives but nflverse gave none of them a drive_time_of_possession.
    frame['top_known'] = frame['top_known'].fillna(0)
    # A PARTLY unreadable clock is the dangerous case: the unreadable drives fall out
    # of the sum and possession is understated with nothing in the stored row to show
    # it (all-unreadable is at least visible as NULL). Name the game and team.
    for game_id, team_id, known, drives in zip(frame['game_id'], frame['team_id'],
                                               frame['top_known'], frame['total_drives']):
        if 0 < known < drives:
            log.warning("%s %s: drive_time_of_possession readable on only %d of %d drives; "
                        "time_of_possession_seconds is understated",
                        game_id, team_id, int(known), int(drives))
    frame['time_of_possession_seconds'] = pd.Series([
        None if (drives > 0 and known == 0) else int(secs if pd.notna(secs) else 0)
        for drives, known, secs in zip(frame['total_drives'], frame['top_known'], frame['top_seconds'])
    ], index=frame.index, dtype=object)

    frame['season'] = season
    # A game whose every row has a null week (malformed input only — real
    # nflverse always populates week) has no valid week to store. Drop it
    # rather than crash frame['week'].astype(int) below and abort the whole
    # season's ingest, or silently write a bogus week.
    bad_week = frame['week'].isna()
    if bad_week.any():
        bad_game_ids = sorted(frame.loc[bad_week, 'game_id'].unique())
        log.warning("Dropping %d game(s) with no usable week: %s", len(bad_game_ids), bad_game_ids)
        frame = frame[~bad_week].reset_index(drop=True)
    frame['week'] = frame['week'].astype(int)
    frame = frame.sort_values(['game_id', 'home_away']).reset_index(drop=True)
    log.info("Aggregated team game stats for %d team-games (%d games)", len(frame), frame['game_id'].nunique())
    return frame[TEAM_GAME_STATS_COLS]


def ensure_team_game_stats_table(conn):
    """Create team_game_stats (box score spec §5) if it doesn't exist. NOT @retry."""
    # Adding a column later: CREATE TABLE IF NOT EXISTS is a no-op against the
    # existing production table, so editing the body below alone would pass every
    # test and silently do nothing live — add an ALTER TABLE ... ADD COLUMN IF NOT
    # EXISTS function instead, the way ensure_qb_season_stats_columns does.
    with conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS team_game_stats (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                game_id TEXT NOT NULL,
                team_id TEXT NOT NULL REFERENCES teams(id),
                season INT NOT NULL,
                week INT NOT NULL,
                opponent_id TEXT REFERENCES teams(id),
                home_away TEXT,
                plays INT,
                epa_per_play NUMERIC,
                success_rate NUMERIC,
                first_down_rate NUMERIC,
                pass_plays INT,
                pass_epa_per_play NUMERIC,
                pass_success_rate NUMERIC,
                pass_first_down_rate NUMERIC,
                rush_plays INT,
                rush_epa_per_play NUMERIC,
                rush_success_rate NUMERIC,
                rush_first_down_rate NUMERIC,
                early_plays INT,
                early_epa_per_play NUMERIC,
                early_success_rate NUMERIC,
                late_plays INT,
                late_epa_per_play NUMERIC,
                late_success_rate NUMERIC,
                explosive_plays INT,
                explosive_rate NUMERIC,
                explosive_pass INT,
                explosive_rush INT,
                epa_lost_turnovers NUMERIC,
                epa_lost_sacks NUMERIC,
                epa_lost_penalties NUMERIC,
                first_downs INT,
                first_downs_pass INT,
                first_downs_rush INT,
                first_downs_penalty INT,
                third_down_att INT,
                third_down_conv INT,
                fourth_down_att INT,
                fourth_down_conv INT,
                total_plays INT,
                total_yards INT,
                total_drives INT,
                yards_per_play NUMERIC,
                net_passing_yards INT,
                completions INT,
                attempts INT,
                yards_per_pass NUMERIC,
                interceptions INT,
                sacks INT,
                sack_yards INT,
                rushing_yards INT,
                rushing_attempts INT,
                yards_per_rush NUMERIC,
                red_zone_trips INT,
                red_zone_tds INT,
                penalties INT,
                penalty_yards INT,
                turnovers INT,
                fumbles_lost INT,
                def_st_tds INT,
                time_of_possession_seconds INT,
                team_targets INT,
                UNIQUE (game_id, team_id)
            );
            CREATE INDEX IF NOT EXISTS idx_team_game_stats_season_week ON team_game_stats(season, week);
            CREATE INDEX IF NOT EXISTS idx_team_game_stats_team_season ON team_game_stats(team_id, season);
        """)
        cur.execute("""
            DO $$ BEGIN
                ALTER TABLE team_game_stats ENABLE ROW LEVEL SECURITY;
            EXCEPTION WHEN others THEN NULL;
            END $$;
        """)
        cur.execute("""
            DO $$ BEGIN
                CREATE POLICY "public_read" ON team_game_stats FOR SELECT USING (true);
            EXCEPTION WHEN duplicate_object THEN NULL;
            END $$;
        """)
    conn.commit()
    log.info("Ensured team_game_stats table exists with RLS")


@retry(max_retries=2, delay=3)
def upsert_team_game_stats(conn, df: pd.DataFrame):
    """Upsert one row per team per game into team_game_stats."""
    if df.empty:
        log.info("No team game stats to upsert (empty DataFrame)")
        return
    cols = TEAM_GAME_STATS_COLS
    # Plain-Python rows, as in ingest_schedules: NaN/None -> None (SQL NULL, never
    # 'NaN'::numeric), numpy ints/floats -> int/float (no psycopg2 adapter).
    # time_of_possession_seconds is an INT column that can be NULL, so it is not in
    # TEAM_GAME_STATS_INT_COLS — but when it is not NULL it must still arrive as an
    # int, not 1423.0.
    int_cols = set(TEAM_GAME_STATS_INT_COLS) | {'season', 'week', 'time_of_possession_seconds'}
    text_cols = {'game_id', 'team_id', 'opponent_id', 'home_away'}
    rows = []
    for values in df[cols].astype(object).itertuples(index=False, name=None):
        row = []
        for c, v in zip(cols, values):
            if pd.isna(v):
                row.append(None)
            elif c in text_cols:
                row.append(str(v))
            elif c in int_cols:
                row.append(int(v))
            else:
                row.append(float(v))
        rows.append(tuple(row))
    col_names = ', '.join(cols)
    update_set = ', '.join(f"{c} = EXCLUDED.{c}" for c in cols if c not in ('game_id', 'team_id'))

    with conn.cursor() as cur:
        execute_values(
            cur,
            f"""INSERT INTO team_game_stats ({col_names})
                VALUES %s
                ON CONFLICT (game_id, team_id) DO UPDATE SET {update_set}""",
            rows,
        )
    log.info("Upserted %d team game rows", len(rows))


def cleanup_stale_rows(conn, season: int, team_ids: list, player_ids: list, rb_gap_player_ids: list = None, rb_gap_weekly_player_ids: list = None, def_gap_team_ids: list = None, receiver_player_ids: list = None, rb_season_player_ids: list = None, qb_weekly_player_ids: list = None, receiver_weekly_player_ids: list = None, rb_weekly_player_ids: list = None, qb_pass_loc_player_ids: list = None, dd_team_ids: list = None, sit_team_ids: list = None, game_ids: list = None):
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

        if rb_gap_player_ids is not None and len(rb_gap_player_ids) > 0:
            cur.execute(
                "DELETE FROM rb_gap_stats WHERE season = %s AND player_id != ALL(%s)",
                (season, rb_gap_player_ids),
            )
            if cur.rowcount > 0:
                log.info("Cleaned up %d stale rb_gap_stats rows", cur.rowcount)

        if rb_gap_weekly_player_ids is not None and len(rb_gap_weekly_player_ids) > 0:
            cur.execute(
                "DELETE FROM rb_gap_stats_weekly WHERE season = %s AND player_id != ALL(%s)",
                (season, rb_gap_weekly_player_ids),
            )
            if cur.rowcount > 0:
                log.info("Cleaned up %d stale rb_gap_stats_weekly rows", cur.rowcount)

        if def_gap_team_ids is not None and len(def_gap_team_ids) > 0:
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

        if rb_season_player_ids is not None and len(rb_season_player_ids) > 0:
            cur.execute(
                "DELETE FROM rb_season_stats WHERE season = %s AND player_id != ALL(%s)",
                (season, rb_season_player_ids),
            )
            if cur.rowcount > 0:
                log.info("Cleaned up %d stale rb_season_stats rows", cur.rowcount)

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

        if qb_pass_loc_player_ids is not None and len(qb_pass_loc_player_ids) > 0:
            cur.execute(
                "DELETE FROM qb_pass_location_stats WHERE season = %s AND player_id != ALL(%s)",
                (season, qb_pass_loc_player_ids),
            )
            if cur.rowcount > 0:
                log.info("Cleaned up %d stale qb_pass_location_stats rows", cur.rowcount)

        if dd_team_ids is not None and len(dd_team_ids) > 0:
            cur.execute(
                "DELETE FROM team_down_distance_stats WHERE season = %s AND team_id != ALL(%s)",
                (season, dd_team_ids),
            )
            if cur.rowcount > 0:
                log.info("Cleaned up %d stale team_down_distance_stats rows", cur.rowcount)

        if sit_team_ids is not None and len(sit_team_ids) > 0:
            cur.execute(
                "DELETE FROM team_situational_stats WHERE season = %s AND team_id != ALL(%s)",
                (season, sit_team_ids),
            )
            if cur.rowcount > 0:
                log.info("Cleaned up %d stale team_situational_stats rows", cur.rowcount)

        # Game-keyed: a rescheduled game gets a new game_id, and the old id's rows
        # would otherwise survive every team-keyed cleanup (box score spec §5).
        if game_ids is not None and len(game_ids) > 0:
            # I2: download_pbp accepts any non-empty current-season file, so a
            # truncated upstream file can still reach the latest week while
            # missing whole earlier weeks — a keep list that looks plausible but
            # is too small. A reschedule (the case this DELETE exists for) never
            # shrinks the season's game count, so a keep list smaller than what
            # is already stored can only mean an incomplete file: skip the
            # delete rather than risk wiping real rows.
            cur.execute(
                "SELECT COUNT(DISTINCT game_id) FROM team_game_stats WHERE season = %s",
                (season,),
            )
            stored_game_count = cur.fetchone()[0]
            if len(game_ids) < stored_game_count:
                log.warning(
                    "Skipping team_game_stats cleanup for season %d: this run's keep "
                    "list has %d game(s) but the table already holds %d — the "
                    "play-by-play file looks incomplete, not just rescheduled",
                    season, len(game_ids), stored_game_count,
                )
            else:
                cur.execute(
                    "DELETE FROM team_game_stats WHERE season = %s AND game_id != ALL(%s)",
                    (season, game_ids),
                )
                if cur.rowcount > 0:
                    log.warning("Removed %d stale team_game_stats row(s) for games no longer in "
                                "the season's play-by-play (reschedule, or an upstream data gap)",
                                cur.rowcount)


@retry(max_retries=2, delay=3)
def get_existing_through_week(conn, season: int):
    """Return the through_week already recorded for a season, or None if no row exists."""
    with conn.cursor() as cur:
        cur.execute("SELECT through_week FROM data_freshness WHERE season = %s", (season,))
        row = cur.fetchone()
        return row[0] if row else None


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
    spikes = filter_spikes(pbp)

    # A non-empty file can still hold zero usable plays (preseason-only or non-REG rows);
    # through_week's int(max()) would crash on an empty frame
    if len(plays) == 0:
        if season >= CURRENT_SEASON:
            raise DataNotYetPublished(f"PBP for {season} has no completed regular-season plays yet.")
        raise DataQualityError(f"PBP for {season} contains no usable regular-season plays. Aborting.")

    team_stats = aggregate_team_stats(plays, pbp, season)
    qb_stats = aggregate_qb_stats(plays, roster, season, spikes=spikes)
    qb_pass_loc = aggregate_qb_pass_location_stats(plays, roster, season)
    rb_gap_stats = aggregate_rb_gap_stats(plays, season)
    rb_gap_stats_weekly = aggregate_rb_gap_stats_weekly(plays, season)
    def_gap_stats = aggregate_def_gap_stats(plays, season)
    receiver_stats = aggregate_receiver_stats(plays, roster, season, participation)
    rb_season_stats = aggregate_rb_season_stats(plays, roster, season)
    qb_weekly = aggregate_qb_weekly_stats(plays, roster, season, spikes=spikes)
    receiver_weekly = aggregate_receiver_weekly_stats(plays, roster, season, participation)
    rb_weekly = aggregate_rb_weekly_stats(plays, roster, season)
    dd_stats = aggregate_team_down_distance_stats(plays, season)
    sit_stats = aggregate_team_situational_stats(plays, season)
    # RAW pbp, not plays: box scores need the kicking and no_play rows (spec §5)
    team_game_stats = aggregate_team_game_stats(pbp, season)
    through_week = int(plays['week'].max())

    validate_data(team_stats, qb_stats, receiver_stats)

    if dry_run:
        log.info("[DRY RUN] Would upsert: %d team rows, %d QB rows, %d RB gap rows, %d RB gap weekly rows, %d def gap rows, %d receiver rows, %d RB season rows, through_week=%d",
                 len(team_stats), len(qb_stats), len(rb_gap_stats), len(rb_gap_stats_weekly), len(def_gap_stats), len(receiver_stats), len(rb_season_stats), through_week)
        log.info("[DRY RUN] QB weekly: %d rows, Receiver weekly: %d rows, RB weekly: %d rows",
                 len(qb_weekly), len(receiver_weekly), len(rb_weekly))
        log.info("[DRY RUN] Aggregated %d RB gap stat rows", len(rb_gap_stats))
        log.info("[DRY RUN] Aggregated %d RB gap weekly stat rows", len(rb_gap_stats_weekly))
        log.info("[DRY RUN] Def gap: %d rows", len(def_gap_stats))
        log.info("[DRY RUN] Team game stats: %d rows (%d games)",
                 len(team_game_stats), team_game_stats['game_id'].nunique() if not team_game_stats.empty else 0)
        # Log sample QBs for verification
        sample_cols = ['player_name', 'team', 'games', 'dropbacks', 'attempts', 'completions',
                       'passing_yards', 'touchdowns', 'interceptions', 'adot', 'fumbles', 'fumbles_lost',
                       'epa_per_play', 'cpoe', 'success_rate', 'rush_epa_per_play']
        avail_cols = [c for c in sample_cols if c in qb_stats.columns]
        top_qbs = qb_stats.nlargest(5, 'dropbacks')
        for _, row in top_qbs.iterrows():
            log.info("[SAMPLE] %s", {c: (round(row[c], 3) if isinstance(row[c], float) else row[c]) for c in avail_cols})
        return

    # Guard against nflverse re-publishing a truncated file: never move a season's data backwards.
    # cleanup_stale_rows would otherwise delete every team/player missing from the truncated frame.
    prior_week = get_existing_through_week(conn, season)
    if prior_week is not None and through_week < prior_week:
        raise DataQualityError(
            f"PBP for {season} only goes through week {through_week} but DB already has week {prior_week} — "
            f"refusing to ingest a truncated file.")

    ensure_team_season_stats_columns(conn)
    ensure_qb_season_stats_columns(conn)
    ensure_rb_gap_tables(conn)
    ensure_rb_gap_weekly_tables(conn)
    ensure_def_gap_tables(conn)
    ensure_receiver_stats_table(conn)
    ensure_rb_season_stats_table(conn)
    ensure_qb_weekly_stats_table(conn)
    ensure_qb_weekly_stats_columns(conn)
    ensure_receiver_weekly_stats_table(conn)
    ensure_rb_weekly_stats_table(conn)
    ensure_qb_pass_location_tables(conn)
    ensure_team_down_distance_table(conn)
    ensure_team_situational_table(conn)
    ensure_player_slugs_table(conn)
    ensure_team_game_stats_table(conn)

    try:
        upsert_teams(conn, team_stats)
        upsert_team_stats(conn, team_stats)
        upsert_qb_stats(conn, qb_stats)
        upsert_qb_pass_location_stats(conn, qb_pass_loc)
        upsert_rb_gap_stats(conn, rb_gap_stats)
        upsert_rb_gap_stats_weekly(conn, rb_gap_stats_weekly)
        upsert_def_gap_stats(conn, def_gap_stats)
        upsert_receiver_stats(conn, receiver_stats)
        upsert_rb_season_stats(conn, rb_season_stats)
        upsert_qb_weekly_stats(conn, qb_weekly)
        upsert_receiver_weekly_stats(conn, receiver_weekly)
        upsert_rb_weekly_stats(conn, rb_weekly)
        upsert_team_down_distance_stats(conn, dd_stats)
        upsert_team_situational_stats(conn, sit_stats)
        upsert_team_game_stats(conn, team_game_stats)
        player_slugs_df = generate_player_slugs(qb_stats, receiver_stats, rb_gap_stats, roster, conn, season=season)
        upsert_player_slugs(conn, player_slugs_df)
        cleanup_stale_rows(
            conn, season,
            team_ids=team_stats['team_id'].unique().tolist(),
            player_ids=qb_stats['player_id'].unique().tolist(),
            rb_gap_player_ids=rb_gap_stats['player_id'].unique().tolist() if not rb_gap_stats.empty else [],
            rb_gap_weekly_player_ids=rb_gap_stats_weekly['player_id'].unique().tolist() if not rb_gap_stats_weekly.empty else [],
            def_gap_team_ids=def_gap_stats['team_id'].unique().tolist() if not def_gap_stats.empty else [],
            receiver_player_ids=receiver_stats['player_id'].unique().tolist() if not receiver_stats.empty else [],
            rb_season_player_ids=rb_season_stats['player_id'].unique().tolist() if not rb_season_stats.empty else [],
            qb_weekly_player_ids=qb_weekly['player_id'].unique().tolist() if not qb_weekly.empty else [],
            receiver_weekly_player_ids=receiver_weekly['player_id'].unique().tolist() if not receiver_weekly.empty else [],
            rb_weekly_player_ids=rb_weekly['player_id'].unique().tolist() if not rb_weekly.empty else [],
            qb_pass_loc_player_ids=qb_pass_loc['player_id'].unique().tolist() if not qb_pass_loc.empty else [],
            dd_team_ids=dd_stats['team_id'].unique().tolist() if not dd_stats.empty else [],
            sit_team_ids=sit_stats['team_id'].unique().tolist() if not sit_stats.empty else [],
            game_ids=team_game_stats['game_id'].unique().tolist() if not team_game_stats.empty else [],
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
            # Schedules ingest BEFORE process_season and outside its DataNotYetPublished
            # skip: the schedule must land even when no PBP exists yet (pre-season).
            # Its own except — the one below catches only DataNotYetPublished, so an
            # unwrapped schedules failure would kill the whole run.
            try:
                ingest_schedules(conn, season)
            except Exception as e:
                log.warning("Schedules ingest for %d failed — continuing: %s", season, e)
            try:
                process_season(season, conn, dry_run=args.dry_run)
            except DataNotYetPublished as e:
                log.info("Season %d skipped — %s Nothing ingested; will succeed once data exists.", season, e)
    finally:
        if conn:
            conn.close()

    log.info("Done!")


if __name__ == '__main__':
    main()
