// __tests__/fixtures/box-score-buf-hou.ts — 2026_01_BUF_HOU, the golden game
// (box score spec §4, verified against rbsdm.com and ESPN). The team rows carry
// the exact values PR 2's golden pytest pins; the player rows are the weekly
// rows as the mockup shows them. Never edit a value here to make a test pass.
import type {
  GamePlayerLines,
  PlayerIdentity,
  QBWeeklyStat,
  RBWeeklyStat,
  ReceiverWeeklyStat,
  TeamGame,
  TeamGameStat,
} from "@/lib/types";

/** A `games` row with both scores present — the same shape as lib/data/box-score.ts's PlayedGame. */
export interface PlayedGameFixture {
  game_id: string;
  season: number;
  game_type: string;
  week: number;
  gameday: string | null;
  weekday: string | null;
  gametime: string | null;
  home_team: string;
  away_team: string;
  home_score: number;
  away_score: number;
}

export const BUF_HOU_GAME: PlayedGameFixture = {
  game_id: "2026_01_BUF_HOU",
  season: 2026,
  game_type: "REG",
  week: 1,
  gameday: "2026-09-13",
  weekday: "Sunday",
  gametime: "13:00",
  home_team: "HOU",
  away_team: "BUF",
  home_score: 31,
  away_score: 36,
};

/** A team_game_stats row with every column; overrides on top of BUF's. */
export function teamRow(over: Partial<TeamGameStat>): TeamGameStat {
  return { ...BUF_STATS, ...over };
}

export const BUF_STATS: TeamGameStat = {
  game_id: "2026_01_BUF_HOU",
  team_id: "BUF",
  season: 2026,
  week: 1,
  opponent_id: "HOU",
  home_away: "away",
  plays: 56,
  epa_per_play: 0.278,
  success_rate: 0.4107,
  first_down_rate: 0.3571,
  pass_plays: 37,
  pass_epa_per_play: 0.5557,
  pass_success_rate: 0.4595,
  pass_first_down_rate: 0.4324,
  rush_plays: 19,
  rush_epa_per_play: -0.2628,
  rush_success_rate: 0.3158,
  rush_first_down_rate: 0.2105,
  early_plays: 45,
  early_epa_per_play: 0.3013,
  early_success_rate: 0.4222,
  late_plays: 10,
  late_epa_per_play: 0.2955,
  late_success_rate: 0.4,
  explosive_plays: 8,
  explosive_rate: 8 / 56,
  explosive_pass: 5,
  explosive_rush: 3,
  epa_lost_turnovers: 0,
  epa_lost_sacks: -3.27,
  epa_lost_penalties: -8.52,
  first_downs: 20,
  first_downs_pass: 13,
  first_downs_rush: 5,
  first_downs_penalty: 2,
  third_down_att: 9,
  third_down_conv: 3,
  fourth_down_att: 1,
  fourth_down_conv: 0,
  total_plays: 52,
  total_yards: 409,
  total_drives: 12,
  yards_per_play: 409 / 52,
  net_passing_yards: 323,
  completions: 20,
  attempts: 29,
  yards_per_pass: 323 / 31,
  interceptions: 0,
  sacks: 2,
  sack_yards: 11,
  rushing_yards: 86,
  rushing_attempts: 21,
  yards_per_rush: 86 / 21,
  red_zone_trips: 3,
  red_zone_tds: 1,
  penalties: 10,
  penalty_yards: 85,
  turnovers: 0,
  fumbles_lost: 0,
  def_st_tds: 0,
  time_of_possession_seconds: 23 * 60 + 43,
  team_targets: 28,
};

export const HOU_STATS: TeamGameStat = {
  game_id: "2026_01_BUF_HOU",
  team_id: "HOU",
  season: 2026,
  week: 1,
  opponent_id: "BUF",
  home_away: "home",
  plays: 79,
  epa_per_play: 0.0713,
  success_rate: 0.481,
  first_down_rate: 0.3165,
  pass_plays: 48,
  pass_epa_per_play: 0.0977,
  pass_success_rate: 0.5208,
  pass_first_down_rate: 0.3333,
  rush_plays: 31,
  rush_epa_per_play: 0.0303,
  rush_success_rate: 0.4194,
  rush_first_down_rate: 0.2903,
  early_plays: 59,
  early_epa_per_play: 0.1003,
  early_success_rate: 0.4746,
  late_plays: 20,
  late_epa_per_play: -0.0144,
  late_success_rate: 0.5,
  explosive_plays: 8,
  explosive_rate: 8 / 79,
  explosive_pass: 4,
  explosive_rush: 4,
  epa_lost_turnovers: -7.0,
  epa_lost_sacks: -8.66,
  epa_lost_penalties: -9.69,
  first_downs: 26,
  first_downs_pass: 11,
  first_downs_rush: 10,
  first_downs_penalty: 5,
  third_down_att: 16,
  third_down_conv: 7,
  fourth_down_att: 2,
  fourth_down_conv: 2,
  total_plays: 73,
  total_yards: 381,
  total_drives: 11,
  yards_per_play: 381 / 73,
  net_passing_yards: 257,
  completions: 26,
  attempts: 38,
  yards_per_pass: 257 / 41,
  interceptions: 0,
  sacks: 3,
  sack_yards: 17,
  rushing_yards: 124,
  rushing_attempts: 32,
  yards_per_rush: 124 / 32,
  red_zone_trips: 5,
  red_zone_tds: 4,
  penalties: 7,
  penalty_yards: 106,
  turnovers: 2,
  fumbles_lost: 2,
  def_st_tds: 0,
  time_of_possession_seconds: 36 * 60 + 17,
  team_targets: 37,
};

/** The teams' `games` rows from each side, as getTeamSchedule returns them (week 1 only, plus an unplayed week 2). */
export function scheduleFor(team: "BUF" | "HOU"): TeamGame[] {
  const isBuf = team === "BUF";
  return [
    {
      game_id: "2026_01_BUF_HOU",
      season: 2026,
      game_type: "REG",
      week: 1,
      gameday: "2026-09-13",
      weekday: "Sunday",
      gametime: "13:00",
      home_team: "HOU",
      away_team: "BUF",
      home_score: 31,
      away_score: 36,
      opponent_id: isBuf ? "HOU" : "BUF",
      home_away: isBuf ? "away" : "home",
      played: true,
      result: isBuf ? "W" : "L",
      team_score: isBuf ? 36 : 31,
      opponent_score: isBuf ? 31 : 36,
    },
    {
      game_id: isBuf ? "2026_02_DET_BUF" : "2026_02_CIN_HOU",
      season: 2026,
      game_type: "REG",
      week: 2,
      gameday: isBuf ? "2026-09-17" : "2026-09-20",
      weekday: isBuf ? "Thursday" : "Sunday",
      gametime: isBuf ? "20:15" : "13:00",
      home_team: team,
      away_team: isBuf ? "DET" : "CIN",
      home_score: null,
      away_score: null,
      opponent_id: isBuf ? "DET" : "CIN",
      home_away: "home",
      played: false,
      result: null,
      team_score: null,
      opponent_score: null,
    },
  ];
}

const gameSide = (team: string) =>
  team === "BUF"
    ? { team_id: "BUF", opponent_id: "HOU", home_away: "away", result: "W", team_score: 36, opponent_score: 31 }
    : { team_id: "HOU", opponent_id: "BUF", home_away: "home", result: "L", team_score: 31, opponent_score: 36 };

export function qb(
  player_id: string,
  team: string,
  over: Partial<QBWeeklyStat>
): QBWeeklyStat {
  return {
    player_id,
    season: 2026,
    week: 1,
    ...gameSide(team),
    completions: 0,
    attempts: 0,
    passing_yards: 0,
    touchdowns: 0,
    interceptions: 0,
    sacks: 0,
    epa_per_dropback: 0,
    cpoe: 0,
    success_rate: 0,
    adot: 0,
    passer_rating: 0,
    ypa: 0,
    rush_attempts: 0,
    rush_yards: 0,
    rush_tds: 0,
    rush_epa_per_carry: null,
    rush_success_rate: null,
    fumbles: 0,
    fumbles_lost: 0,
    ...over,
  };
}

export function rec(
  player_id: string,
  team: string,
  targets: number,
  receptions: number,
  receiving_yards: number,
  receiving_tds: number,
  yac: number,
  epa_per_target: number,
  adot: number,
  over: Partial<ReceiverWeeklyStat> = {}
): ReceiverWeeklyStat {
  return {
    player_id,
    season: 2026,
    week: 1,
    ...gameSide(team),
    targets,
    receptions,
    receiving_yards,
    receiving_tds,
    epa_per_target,
    catch_rate: targets > 0 ? receptions / targets : 0,
    yac,
    yac_per_reception: receptions > 0 ? yac / receptions : 0,
    adot,
    air_yards: adot * targets,
    // No participation file for 2026: routes are NULL in the database.
    routes_run: null as unknown as number,
    yards_per_route_run: null as unknown as number,
    ...over,
  };
}

export function rb(
  player_id: string,
  team: string,
  carries: number,
  rushing_yards: number,
  rushing_tds: number,
  epa_per_carry: number,
  success_rate: number,
  over: Partial<RBWeeklyStat> = {}
): RBWeeklyStat {
  return {
    player_id,
    season: 2026,
    week: 1,
    ...gameSide(team),
    carries,
    rushing_yards,
    rushing_tds,
    epa_per_carry,
    success_rate,
    yards_per_carry: carries > 0 ? rushing_yards / carries : 0,
    stuff_rate: 0,
    explosive_rate: 0,
    targets: 0,
    receptions: 0,
    receiving_yards: 0,
    receiving_tds: 0,
    fumbles: 0,
    fumbles_lost: 0,
    ...over,
  };
}

function identity(player_id: string, player_name: string, position: string, slug: string): PlayerIdentity {
  return { player_id, player_name, position, slug };
}

export const ALLEN = "00-0034857";
export const STROUD = "00-0039163";

export const BUF_HOU_LINES: GamePlayerLines = {
  qbs: [
    qb(ALLEN, "BUF", {
      completions: 20, attempts: 29, passing_yards: 334, touchdowns: 2, interceptions: 0, sacks: 2,
      passer_rating: 130.5, epa_per_dropback: 0.5557, cpoe: 8.1, success_rate: 0.47, adot: 13.2, ypa: 11.5,
      rush_attempts: 5, rush_yards: 24, rush_tds: 2, rush_epa_per_carry: -0.4626, rush_success_rate: 0.4,
    }),
    qb(STROUD, "HOU", {
      completions: 26, attempts: 38, passing_yards: 274, touchdowns: 2, interceptions: 0, sacks: 3,
      passer_rating: 106.7, epa_per_dropback: 0.0977, cpoe: 3.2, success_rate: 0.5, adot: 8.5, ypa: 7.2,
      rush_attempts: 2, rush_yards: 15, rush_tds: 0, rush_epa_per_carry: 0.73, rush_success_rate: 0.5,
    }),
  ],
  receivers: [
    rec("00-0038557", "BUF", 6, 5, 130, 0, 38, 1.27, 16.3),
    rec("00-0033557", "BUF", 8, 5, 100, 1, 24, 0.8, 19.8),
    rec("00-0037248", "BUF", 6, 4, 40, 0, 15, 0.09, 6.5),
    rec("00-0036926", "BUF", 2, 1, 34, 1, 6, 2.06, 31.0),
    rec("00-0038545", "BUF", 4, 3, 12, 0, 14, -0.09, -1.0),
    rec("00-0035285", "BUF", 1, 1, 7, 0, 5, 0.29, 2.0),
    rec("00-0039062", "BUF", 1, 1, 1, 0, -3, 1.0, 4.0),
    rec("00-0036908", "HOU", 10, 7, 75, 1, 8, 0.49, 12.0),
    rec("00-0039911", "HOU", 2, 2, 53, 0, 27, 1.99, 13.0),
    rec("00-0034351", "HOU", 8, 4, 35, 0, 27, -0.32, 3.3),
    rec("00-0038995", "HOU", 6, 3, 32, 0, 21, 0.15, 9.5),
    rec("00-0038537", "HOU", 2, 1, 21, 0, 7, 0.21, 16.0),
    rec("00-0036212", "HOU", 3, 3, 19, 1, 14, 0.88, 1.7),
    rec("00-0040155", "HOU", 1, 1, 16, 0, 2, 1.05, 14.0),
    rec("00-0034426", "HOU", 2, 2, 15, 0, 8, 0.47, 3.5),
    rec("00-0039339", "HOU", 1, 1, 12, 0, 0, 0.73, 12.0),
    rec("00-0039864", "HOU", 1, 1, -2, 0, 0, -0.94, -2.0),
    rec("00-0039916", "HOU", 1, 1, -2, 0, 0, -1.37, -2.0),
  ],
  rbs: [
    rb("00-0038545", "BUF", 13, 57, 0, -0.01, 0.3846, { targets: 4, receptions: 3, receiving_yards: 12 }),
    rb("00-0039354", "BUF", 1, 3, 0, -0.15, 0),
    rb("00-0039352", "BUF", 1, 3, 0, -0.06, 0),
    rb("00-0036212", "HOU", 20, 60, 2, -0.02, 0.4, { targets: 3, receptions: 3, receiving_yards: 19, receiving_tds: 1 }),
    rb("00-0039916", "HOU", 9, 42, 0, 0.16, 0.4444, { targets: 1, receptions: 1, receiving_yards: -2 }),
  ],
  players: Object.fromEntries(
    [
      identity(ALLEN, "Josh Allen", "QB", "josh-allen"),
      identity(STROUD, "C.J. Stroud", "QB", "cj-stroud"),
      identity("00-0038557", "Dalton Kincaid", "TE", "dalton-kincaid"),
      identity("00-0033557", "DJ Moore", "WR", "dj-moore"),
      identity("00-0037248", "Khalil Shakir", "WR", "khalil-shakir"),
      identity("00-0036926", "Josh Palmer", "WR", "josh-palmer"),
      identity("00-0038545", "James Cook", "RB", "james-cook"),
      identity("00-0035285", "Dawson Knox", "TE", "dawson-knox"),
      identity("00-0039062", "Keon Coleman", "WR", "keon-coleman"),
      identity("00-0039354", "Ray Davis", "RB", "ray-davis"),
      identity("00-0039352", "Frank Gore Jr.", "RB", "frank-gore-jr"),
      identity("00-0036908", "Nico Collins", "WR", "nico-collins"),
      identity("00-0039911", "Jaylin Noel", "WR", "jaylin-noel"),
      identity("00-0034351", "Dalton Schultz", "TE", "dalton-schultz"),
      identity("00-0038995", "Xavier Hutchinson", "WR", "xavier-hutchinson"),
      identity("00-0038537", "Kayshon Boutte", "WR", "kayshon-boutte"),
      identity("00-0036212", "David Montgomery", "RB", "david-montgomery"),
      identity("00-0040155", "Marlin Klein", "TE", "marlin-klein"),
      identity("00-0034426", "Foster Moreau", "TE", "foster-moreau"),
      identity("00-0039339", "Jared Wayne", "WR", "jared-wayne"),
      identity("00-0039864", "Cade Stover", "TE", "cade-stover"),
      identity("00-0039916", "Woody Marks", "RB", "woody-marks"),
    ].map((p) => [p.player_id, p])
  ),
};
