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
  /** Defensive forced turnovers. Null on rows ingested before the column existed. */
  takeaways: number | null;
  /** Offensive turnovers. Null on rows ingested before the column existed. */
  giveaways: number | null;
  /** takeaways - giveaways. Null on rows ingested before the column existed. */
  turnover_diff: number | null;
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
  // Leaderboard overhaul stats
  td_pct: number | null;
  int_pct: number | null;
  sack_pct: number | null;
  scramble_pct: number | null;
  total_epa: number | null;
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
  total_snaps: number;
  snap_share: number;
  route_participation_rate: number;
  // Leaderboard overhaul stats
  air_yards_share: number | null;
  croe: number | null;
  receiving_success_rate: number | null;
  total_receiving_epa: number | null;
}

export interface RBSeasonStat {
  id: string;
  player_id: string;
  player_name: string;
  position: string;
  team_id: string;
  season: number;
  games: number;
  carries: number;
  rushing_yards: number;
  rushing_tds: number;
  yards_per_carry: number;
  epa_per_carry: number;
  success_rate: number;
  stuff_rate: number;
  explosive_rate: number;
  fumbles: number;
  fumbles_lost: number;
  targets: number;
  receptions: number;
  receiving_yards: number;
  receiving_tds: number;
  // Leaderboard overhaul stats
  total_touches: number | null;
  touches_per_game: number | null;
  total_rushing_epa: number | null;
}

// Cross-link types for player pages
export interface CrossLinkReceiver {
  player_id: string;
  player_name: string;
  slug: string | null;
  targets: number;
  receptions: number;
  receiving_yards: number;
  receiving_tds: number;
}

export interface CrossLinkQB {
  player_id: string;
  player_name: string;
  slug: string | null;
  dropbacks: number;
  passing_yards: number;
  touchdowns: number;
}

// Player page types

export interface PlayerSlug {
  player_id: string;
  slug: string;
  player_name: string;
  position: string;
  current_team_id: string;
  headshot_url: string | null;
  jersey_number: number | null;
}

export interface QBWeeklyStat {
  player_id: string;
  season: number;
  week: number;
  team_id: string;
  opponent_id: string;
  home_away: string;
  result: string;
  team_score: number;
  opponent_score: number;
  completions: number;
  attempts: number;
  passing_yards: number;
  touchdowns: number;
  interceptions: number;
  sacks: number;
  epa_per_dropback: number;
  cpoe: number;
  success_rate: number;
  adot: number;
  passer_rating: number;
  ypa: number;
  rush_attempts: number;
  rush_yards: number;
  rush_tds: number;
  /**
   * EPA per carry and success rate over exactly the carries `rush_attempts`
   * counts (designed runs + scrambles, kneels excluded) — box score spec
   * §10.1, added by PR 2. Null for a game with no carries, and on every row
   * ingested before PR 2 (2020–2025 until the backfill).
   */
  rush_epa_per_carry: number | null;
  rush_success_rate: number | null;
  fumbles: number;
  fumbles_lost: number;
}

export interface ReceiverWeeklyStat {
  player_id: string;
  season: number;
  week: number;
  team_id: string;
  opponent_id: string;
  home_away: string;
  result: string;
  team_score: number;
  opponent_score: number;
  targets: number;
  receptions: number;
  receiving_yards: number;
  receiving_tds: number;
  epa_per_target: number;
  catch_rate: number;
  yac: number;
  yac_per_reception: number;
  adot: number;
  air_yards: number;
  routes_run: number;
  yards_per_route_run: number;
}

export interface RBWeeklyStat {
  player_id: string;
  season: number;
  week: number;
  team_id: string;
  opponent_id: string;
  home_away: string;
  result: string;
  team_score: number;
  opponent_score: number;
  carries: number;
  rushing_yards: number;
  rushing_tds: number;
  epa_per_carry: number;
  success_rate: number;
  yards_per_carry: number;
  stuff_rate: number;
  explosive_rate: number;
  targets: number;
  receptions: number;
  receiving_yards: number;
  receiving_tds: number;
  fumbles: number;
  fumbles_lost: number;
}

// QB Field Heat Map types
export interface QBPassLocationStat {
  id: string;
  player_id: string;
  player_name: string;
  team_id: string;
  season: number;
  depth_bin: string;
  direction_bin: string;
  pass_attempts: number;
  completions: number;
  passing_yards: number;
  pass_tds: number;
  interceptions: number;
  epa_sum: number | null;
  epa_per_attempt: number | null;
  completion_pct: number | null;
  yards_per_attempt: number | null;
  adot: number | null;
  cpoe: number | null;
  passer_rating: number | null;
}

/**
 * One row of the `games` table (nflverse schedules), with the fields that only
 * make sense relative to ONE team derived for that team. Future games carry
 * null scores, so `played` — not the week number — is what says a game is done.
 */
export interface TeamGame {
  game_id: string;
  season: number;
  /** REG for regular season; WC / DIV / CON / SB for playoff rounds. */
  game_type: string;
  week: number;
  /** ISO date "2026-09-13" (nullable in the source for TBD games). */
  gameday: string | null;
  /** Full day name, e.g. "Sunday". */
  weekday: string | null;
  /** Kickoff in 24h ET, e.g. "13:00". Null when not yet scheduled. */
  gametime: string | null;
  home_team: string;
  away_team: string;
  home_score: number | null;
  away_score: number | null;
  // ── derived for the team the schedule was fetched for ──
  opponent_id: string;
  home_away: "home" | "away";
  /** Both scores present — the game has been played. */
  played: boolean;
  /** From this team's perspective; null until played. */
  result: "W" | "L" | "T" | null;
  team_score: number | null;
  opponent_score: number | null;
}

/**
 * One played regular-season game from one team's side, read from the `games`
 * table (box score spec §9). The player Game Log shows these instead of a
 * weekly stat row's stored team_score/opponent_score, which miss any points
 * scored after the game's last run or pass.
 */
export interface GameResult {
  game_id: string;
  team_score: number;
  opponent_score: number;
  result: "W" | "L" | "T";
  opponent_id: string;
}

/**
 * Game results keyed by team, then week: `results["TEN"][5]`. Plain objects
 * (never a Map) so it can cross the server → client boundary; the week keys
 * arrive as strings, which JS object lookup treats the same as numbers.
 */
export type GameResultsByTeam = Record<string, Record<number, GameResult>>;

/**
 * One team's row of `team_game_stats` for one game (box score spec §5), as
 * scripts/ingest.py's aggregate_team_game_stats writes it. Counts and yard
 * totals are 0 when the team had none, never null. The NUMERIC columns arrive
 * from PostgREST as strings and go through parseNumericFields, so they are
 * numbers or null: the rate columns are null when their denominator was 0,
 * the three epa_lost_* sums are 0 when there was nothing to lose, and
 * time_of_possession_seconds is null only when nflverse gave none of the
 * team's drives a clock. Every render of a nullable column guards
 * `val == null || Number.isNaN(val)`.
 */
export interface TeamGameStat {
  game_id: string;
  team_id: string;
  season: number;
  week: number;
  opponent_id: string;
  home_away: "home" | "away";
  // efficiency (nflfastR / rbsdm play set)
  plays: number;
  epa_per_play: number | null;
  success_rate: number | null;
  first_down_rate: number | null;
  pass_plays: number;
  pass_epa_per_play: number | null;
  pass_success_rate: number | null;
  pass_first_down_rate: number | null;
  rush_plays: number;
  rush_epa_per_play: number | null;
  rush_success_rate: number | null;
  rush_first_down_rate: number | null;
  early_plays: number;
  early_epa_per_play: number | null;
  early_success_rate: number | null;
  late_plays: number;
  late_epa_per_play: number | null;
  late_success_rate: number | null;
  explosive_plays: number;
  explosive_rate: number | null;
  explosive_pass: number;
  explosive_rush: number;
  // what it cost them (EPA sums)
  epa_lost_turnovers: number;
  epa_lost_sacks: number;
  epa_lost_penalties: number;
  // traditional (official box-score conventions)
  first_downs: number;
  first_downs_pass: number;
  first_downs_rush: number;
  first_downs_penalty: number;
  third_down_att: number;
  third_down_conv: number;
  fourth_down_att: number;
  fourth_down_conv: number;
  total_plays: number;
  total_yards: number;
  total_drives: number;
  yards_per_play: number | null;
  net_passing_yards: number;
  completions: number;
  attempts: number;
  yards_per_pass: number | null;
  interceptions: number;
  sacks: number;
  /** Stored positive (11 = eleven yards lost). */
  sack_yards: number;
  rushing_yards: number;
  rushing_attempts: number;
  yards_per_rush: number | null;
  red_zone_trips: number;
  red_zone_tds: number;
  penalties: number;
  penalty_yards: number;
  turnovers: number;
  fumbles_lost: number;
  def_st_tds: number;
  time_of_possession_seconds: number | null;
  /** Denominator for TGT% in the receiving table (spec §5). */
  team_targets: number;
}

/** What a player line needs from `player_slugs`: name, position tag and page link. */
export interface PlayerIdentity {
  player_id: string;
  player_name: string;
  position: string;
  slug: string | null;
}

/**
 * The weekly rows behind a box score's player tables (spec §6): both teams'
 * QB, receiver and RB rows for that season + week, plus the identity of every
 * player_id they name — the weekly tables store no name or position.
 */
export interface GamePlayerLines {
  qbs: QBWeeklyStat[];
  receivers: ReceiverWeeklyStat[];
  rbs: RBWeeklyStat[];
  players: Record<string, PlayerIdentity>;
}

export interface TeamDownDistanceStat {
  team_id: string;
  season: number;
  down: number;
  distance_bin: string;
  carries: number;
  epa_per_carry: number;
  success_rate: number;
  yards_per_carry: number;
  stuff_rate: number;
  explosive_rate: number;
}

export interface TeamSituationalStat {
  team_id: string;
  season: number;
  situation: string;
  plays: number;
  epa_per_play: number;
  success_rate: number;
  pass_rate: number;
  rush_epa_per_play: number;
  pass_epa_per_play: number;
  rush_success_rate: number;
  pass_success_rate: number;
}
