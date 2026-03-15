// lib/types/index.ts

export interface Team {
  id: string;
  name: string;
  abbreviation: string;
  division: string;
  conference: string;
  primaryColor: string;
  secondaryColor: string;
  logo: string;
}

export interface TeamSeasonStat {
  id: string;
  team_id: string;
  season: number;
  off_epa_play: number;
  def_epa_play: number;
  off_pass_epa: number;
  off_rush_epa: number;
  def_pass_epa: number;
  def_rush_epa: number;
  off_success_rate: number;
  def_success_rate: number;
  pass_rate: number;
  plays: number;
  wins: number;
  losses: number;
  ties: number;
}

export interface QBSeasonStat {
  id: string;
  player_id: string;
  player_name: string;
  team_id: string;
  season: number;
  games: number;
  completions: number;
  attempts: number;
  dropbacks: number;
  epa_per_db: number;
  epa_per_play: number;
  cpoe: number;
  completion_pct: number;
  success_rate: number;
  passing_yards: number;
  touchdowns: number;
  interceptions: number;
  sacks: number;
  adot: number;
  ypa: number;
  passer_rating: number;
  any_a: number;
  rush_attempts: number;
  rush_yards: number;
  rush_tds: number;
  rush_epa_per_play: number;
}

export interface DataFreshness {
  last_updated: string;
  season: number;
  through_week: number;
}
