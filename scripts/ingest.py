#!/usr/bin/env python3
"""nflverse → Supabase ETL pipeline for Yards Per Pass.

Downloads play-by-play and roster data from nflverse GitHub releases,
aggregates team and QB season stats, and upserts into Supabase PostgreSQL.
"""

import argparse
import os
import sys
from datetime import datetime, timezone

import pandas as pd
import psycopg2
from psycopg2.extras import execute_values
from dotenv import load_dotenv

load_dotenv()

# --- Constants ---
FIRST_SEASON = 2020
CURRENT_SEASON = 2025
PBP_URL = "https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_{season}.parquet"
ROSTER_URL = "https://github.com/nflverse/nflverse-data/releases/download/weekly_rosters/roster_weekly_{season}.parquet"

REQUIRED_PBP_COLS = [
    'play_type', 'season_type', 'two_point_attempt', 'epa', 'success',
    'posteam', 'defteam', 'pass_attempt', 'rush_attempt', 'qb_dropback',
    'passer_player_id', 'passer_player_name', 'rusher_player_id',
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


def download_pbp(season: int) -> pd.DataFrame:
    """Download play-by-play Parquet from nflverse."""
    url = PBP_URL.format(season=season)
    print(f"  Downloading PBP for {season}...")
    df = pd.read_parquet(url)
    missing = [c for c in REQUIRED_PBP_COLS if c not in df.columns]
    if missing:
        raise ValueError(f"Missing columns in PBP data: {missing}")
    return df


def download_roster(season: int) -> pd.DataFrame:
    """Download roster Parquet from nflverse."""
    url = ROSTER_URL.format(season=season)
    print(f"  Downloading roster for {season}...")
    return pd.read_parquet(url)


def filter_plays(pbp: pd.DataFrame) -> pd.DataFrame:
    """Filter to relevant plays: pass/run, regular season, no two-point attempts."""
    mask = (
        pbp['play_type'].isin(['pass', 'run']) &
        (pbp['season_type'] == 'REG') &
        (pbp['two_point_attempt'] != 1)
    )
    filtered = pbp[mask].copy()
    print(f"  Filtered to {len(filtered):,} plays (from {len(pbp):,} raw)")
    return filtered


def aggregate_team_stats(plays: pd.DataFrame, pbp: pd.DataFrame, season: int) -> pd.DataFrame:
    """Aggregate team-level season stats from filtered plays."""
    # Offensive stats
    off = plays.groupby('posteam').agg(
        off_epa_play=('epa', 'mean'),
        off_success_rate=('success', 'mean'),
        plays=('epa', 'count'),
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

    # Pass rate
    pass_rate = plays.groupby('posteam').apply(
        lambda x: x['pass_attempt'].sum() / len(x), include_groups=False
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

    print(f"  Aggregated stats for {len(team_stats)} teams")
    return team_stats


def aggregate_qb_stats(plays: pd.DataFrame, roster: pd.DataFrame, season: int) -> pd.DataFrame:
    """Aggregate QB season stats from filtered plays."""
    # Identify QB player IDs from roster
    qb_ids = set(roster[roster['position'] == 'QB']['gsis_id'].dropna().unique())

    # --- Dropback stats (qb_dropback == 1) ---
    dropbacks = plays[plays['qb_dropback'] == 1].copy()

    # Fix scramble attribution: on scrambles, passer_player_id and passer_player_name
    # are often NULL but rusher_player_id/name have the QB. Fill both before groupby.
    scramble_mask = dropbacks['qb_scramble'] == 1
    dropbacks.loc[scramble_mask, 'passer_player_id'] = (
        dropbacks.loc[scramble_mask, 'rusher_player_id']
    )
    dropbacks.loc[scramble_mask, 'passer_player_name'] = (
        dropbacks.loc[scramble_mask, 'rusher_player_name']
    )

    qb_drop = dropbacks.groupby('passer_player_id').agg(
        player_name=('passer_player_name', 'first'),
        dropback_count=('game_id', 'count'),  # Use game_id (never NaN) not epa (can be NaN)
        dropback_epa_sum=('epa', 'sum'),
        completions=('complete_pass', 'sum'),
        sacks=('sack', 'sum'),
        scrambles=('qb_scramble', 'sum'),
        cpoe=('cpoe', lambda x: x.dropna().mean()),
        adot=('air_yards', lambda x: x.dropna().mean()),
        touchdowns=('pass_touchdown', 'sum'),
        interceptions=('interception', 'sum'),
        games=('game_id', 'nunique'),
        success_rate=('success', lambda x: x.dropna().mean()),
    ).reset_index().rename(columns={'passer_player_id': 'player_id'})

    # Pass attempts: use nflverse pass_attempt flag directly (excludes sacks AND scrambles)
    # pass_attempt == 1 only on true pass attempts (completions + incompletions + INTs)
    pass_attempts = dropbacks.groupby('passer_player_id')['pass_attempt'].sum().reset_index()
    pass_attempts.rename(columns={'passer_player_id': 'player_id', 'pass_attempt': 'attempts'}, inplace=True)
    qb_drop = qb_drop.merge(pass_attempts, on='player_id', how='left')
    qb_drop['attempts'] = qb_drop['attempts'].fillna(0).astype(int)

    # Passing yards: use nflverse passing_yards column on actual pass attempts only
    # pass_attempt == 1 excludes both sacks and scrambles
    actual_passes = dropbacks[dropbacks['pass_attempt'] == 1]
    pass_yards = actual_passes.groupby('passer_player_id')['passing_yards'].apply(
        lambda s: s.fillna(0).sum()
    )
    pass_yards = pass_yards.reset_index().rename(
        columns={'passer_player_id': 'player_id', 'passing_yards': 'passing_yards'}
    )
    qb_drop = qb_drop.merge(pass_yards, on='player_id', how='left')
    qb_drop['passing_yards'] = qb_drop['passing_yards'].fillna(0).astype(int)

    # Derived passing stats
    qb_drop['completion_pct'] = qb_drop.apply(
        lambda r: (r['completions'] / r['attempts'] * 100) if r['attempts'] > 0 else 0.0, axis=1
    )
    qb_drop['ypa'] = qb_drop.apply(
        lambda r: r['passing_yards'] / r['attempts'] if r['attempts'] > 0 else 0.0, axis=1
    )
    qb_drop['epa_per_db'] = qb_drop['dropback_epa_sum'] / qb_drop['dropback_count']

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

    # Scramble TDs: these have qb_dropback==1, qb_scramble==1, rush_touchdown==1
    # They are NOT counted in pass_touchdown or designed rush_tds, so we must add them
    scramble_tds = dropbacks[dropbacks['qb_scramble'] == 1].groupby('passer_player_id').agg(
        scramble_td_count=('rush_touchdown', 'sum'),
    ).reset_index().rename(columns={'passer_player_id': 'player_id'})

    # Merge dropback + rush + scramble TDs
    qb_stats = qb_drop.merge(rush_stats, on='player_id', how='left')
    qb_stats = qb_stats.merge(scramble_tds, on='player_id', how='left')
    qb_stats['rush_attempts'] = qb_stats['rush_attempts'].fillna(0).astype(int)
    qb_stats['rush_yards'] = qb_stats['rush_yards'].fillna(0).astype(int)
    qb_stats['rush_tds'] = qb_stats['rush_tds'].fillna(0).astype(int)
    qb_stats['rush_epa_sum'] = qb_stats['rush_epa_sum'].fillna(0)
    # Add scramble TDs into rush_tds (they are rushing TDs, just from dropback scrambles)
    qb_stats['rush_tds'] = qb_stats['rush_tds'] + qb_stats['scramble_td_count'].fillna(0).astype(int)

    # EPA per play (total: passing + rushing)
    total_plays = qb_stats['dropback_count'] + qb_stats['rush_attempts']
    total_epa = qb_stats['dropback_epa_sum'] + qb_stats['rush_epa_sum']
    qb_stats['epa_per_play'] = total_epa / total_plays.replace(0, float('nan'))

    # Rush EPA per play
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

    # Select final columns
    cols = [
        'player_id', 'player_name', 'team_id', 'season', 'games',
        'completions', 'attempts', 'dropbacks', 'epa_per_db', 'epa_per_play',
        'cpoe', 'completion_pct', 'success_rate', 'passing_yards',
        'touchdowns', 'interceptions', 'sacks', 'adot', 'ypa', 'passer_rating',
        'rush_attempts', 'rush_yards', 'rush_tds', 'rush_epa_per_play',
    ]
    result = qb_stats[cols].copy()

    print(f"  Aggregated stats for {len(result)} QBs")
    return result


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
        conn.commit()
        print(f"  Upserted {len(rows)} teams")


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
    conn.commit()
    print(f"  Upserted {len(rows)} team season rows")


def upsert_qb_stats(conn, df: pd.DataFrame):
    """Upsert QB season stats."""
    cols = [
        'player_id', 'player_name', 'team_id', 'season', 'games',
        'completions', 'attempts', 'dropbacks', 'epa_per_db', 'epa_per_play',
        'cpoe', 'completion_pct', 'success_rate', 'passing_yards',
        'touchdowns', 'interceptions', 'sacks', 'adot', 'ypa', 'passer_rating',
        'rush_attempts', 'rush_yards', 'rush_tds', 'rush_epa_per_play',
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
    conn.commit()
    print(f"  Upserted {len(rows)} QB season rows")


def update_freshness(conn, season: int, through_week: int):
    """Update the data_freshness single-row table."""
    with conn.cursor() as cur:
        cur.execute(
            """INSERT INTO data_freshness (id, last_updated, season, through_week)
               VALUES (1, %s, %s, %s)
               ON CONFLICT (id) DO UPDATE SET
                 last_updated = EXCLUDED.last_updated,
                 season = EXCLUDED.season,
                 through_week = EXCLUDED.through_week""",
            (datetime.now(timezone.utc), season, through_week),
        )
    conn.commit()
    print(f"  Updated freshness: season={season}, through_week={through_week}")


def process_season(season: int, conn, dry_run: bool = False):
    """Full pipeline for one season."""
    print(f"\n{'='*50}")
    print(f"Processing season {season}")
    print(f"{'='*50}")

    pbp = download_pbp(season)
    roster = download_roster(season)
    plays = filter_plays(pbp)

    team_stats = aggregate_team_stats(plays, pbp, season)
    qb_stats = aggregate_qb_stats(plays, roster, season)
    through_week = int(plays['week'].max())

    if dry_run:
        print(f"\n  [DRY RUN] Would upsert:")
        print(f"    {len(team_stats)} team rows")
        print(f"    {len(qb_stats)} QB rows")
        print(f"    through_week={through_week}")
        return

    upsert_teams(conn, team_stats)
    upsert_team_stats(conn, team_stats)
    upsert_qb_stats(conn, qb_stats)
    update_freshness(conn, season, through_week)

    print(f"\n  ✓ Season {season} complete (through week {through_week})")


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
            print("ERROR: DATABASE_URL not set. Add it to .env or environment.", file=sys.stderr)
            sys.exit(1)
        conn = psycopg2.connect(db_url)

    try:
        for season in seasons:
            process_season(season, conn, dry_run=args.dry_run)
    finally:
        if conn:
            conn.close()

    print("\nDone!")


if __name__ == '__main__':
    main()
