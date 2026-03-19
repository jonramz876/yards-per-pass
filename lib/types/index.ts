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
  epa_per_db: number | null;
  epa_per_play: number | null;
  cpoe: number | null;
  completion_pct: number;
  success_rate: number | null;
  passing_yards: number;
  touchdowns: number;
  interceptions: number;
  sacks: number;
  sack_yards_lost: number;
  adot: number | null;
  ypa: number;
  passer_rating: number;
  any_a: number;
  rush_attempts: number;
  rush_yards: number;
  rush_tds: number;
  rush_epa_per_play: number | null;
  fumbles: number;
  fumbles_lost: number;
}

export interface DataFreshness {
  last_updated: string;
  season: number;
  through_week: number;
}

// Run Gap Tool types
export interface RBGapStat {
  id: string;
  player_id: string;
  player_name: string;
  team_id: string;
  season: number;
  gap: string; // LE, LT, LG, M, RG, RT, RE
  carries: number;
  epa_per_carry: number | null;
  yards_per_carry: number | null;
  success_rate: number | null;
  stuff_rate: number | null;
  explosive_rate: number | null;
}

export interface RBGapStatWeekly extends RBGapStat {
  week: number;
  situation: string;
  field_zone: string;
}

export interface DefGapStat {
  id: string;
  team_id: string;
  season: number;
  gap: string;
  carries_faced: number;
  def_epa_per_carry: number | null;
  def_yards_per_carry: number | null;
  def_success_rate: number | null;
  def_stuff_rate: number | null;
  def_explosive_rate: number | null;
}

export interface ReceiverSeasonStat {
  id: string;
  player_id: string;
  player_name: string;
  position: string;
  team_id: string;
  season: number;
  games: number;
  targets: number;
  receptions: number;
  receiving_yards: number;
  receiving_tds: number;
  catch_rate: number;
  yards_per_target: number;
  yards_per_reception: number;
  epa_per_target: number;
  yac: number;
  yac_per_reception: number;
  air_yards: number;
  air_yards_per_target: number;
  target_share: number;
  fumbles: number;
  fumbles_lost: number;
  routes_run: number;
  yards_per_route_run: number;
  targets_per_route_run: number;
}
