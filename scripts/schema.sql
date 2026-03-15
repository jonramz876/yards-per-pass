-- scripts/schema.sql
-- Yards Per Pass — Database Schema
-- Run this in the Supabase SQL Editor (supabase.com → project → SQL Editor)

-- 1. Teams (32 rows, static reference data)
CREATE TABLE IF NOT EXISTS teams (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  division TEXT NOT NULL,
  conference TEXT NOT NULL,
  primary_color TEXT NOT NULL,
  secondary_color TEXT NOT NULL
);

-- 2. Team season stats (~192 rows: 32 teams × 6 seasons)
CREATE TABLE IF NOT EXISTS team_season_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id TEXT REFERENCES teams(id),
  season INTEGER NOT NULL,
  off_epa_play NUMERIC,
  def_epa_play NUMERIC,
  off_pass_epa NUMERIC,
  off_rush_epa NUMERIC,
  def_pass_epa NUMERIC,
  def_rush_epa NUMERIC,
  off_success_rate NUMERIC,
  def_success_rate NUMERIC,
  pass_rate NUMERIC,
  plays INTEGER,
  wins INTEGER DEFAULT 0,
  losses INTEGER DEFAULT 0,
  ties INTEGER DEFAULT 0,
  UNIQUE(team_id, season)
);

CREATE INDEX IF NOT EXISTS idx_team_season ON team_season_stats(season, team_id);

-- 3. QB season stats (~200 rows per season)
CREATE TABLE IF NOT EXISTS qb_season_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id TEXT NOT NULL,
  player_name TEXT NOT NULL,
  team_id TEXT REFERENCES teams(id),
  season INTEGER NOT NULL,
  games INTEGER,
  completions INTEGER,
  attempts INTEGER,
  dropbacks INTEGER,
  epa_per_db NUMERIC,
  epa_per_play NUMERIC,
  cpoe NUMERIC,
  completion_pct NUMERIC,
  success_rate NUMERIC,
  passing_yards INTEGER,
  touchdowns INTEGER,
  interceptions INTEGER,
  sacks INTEGER,
  adot NUMERIC,
  ypa NUMERIC,
  passer_rating NUMERIC,
  any_a NUMERIC,
  rush_attempts INTEGER,
  rush_yards INTEGER,
  rush_tds INTEGER,
  rush_epa_per_play NUMERIC,
  UNIQUE(player_id, season)
);

CREATE INDEX IF NOT EXISTS idx_qb_season ON qb_season_stats(season);
CREATE INDEX IF NOT EXISTS idx_qb_player ON qb_season_stats(player_id);

-- 4. Data freshness (one row per season)
CREATE TABLE IF NOT EXISTS data_freshness (
  season INTEGER PRIMARY KEY,
  last_updated TIMESTAMPTZ DEFAULT NOW(),
  through_week INTEGER
);

-- 5. Row Level Security — anonymous read access
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_read" ON teams FOR SELECT USING (true);

ALTER TABLE team_season_stats ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_read" ON team_season_stats FOR SELECT USING (true);

ALTER TABLE qb_season_stats ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_read" ON qb_season_stats FOR SELECT USING (true);

ALTER TABLE data_freshness ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_read" ON data_freshness FOR SELECT USING (true);
