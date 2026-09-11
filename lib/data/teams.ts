// lib/data/teams.ts
// Last verified: 2026-03-15
// Source: Official NFL team colors, logos hosted locally in /public/logos/

import type { Team, TeamSeasonStat } from "@/lib/types";

const teamLogo = (slug: string) => `/logos/${slug}.png`;

export const NFL_TEAMS: Team[] = [
  { id: 'ARI', name: 'Arizona Cardinals', abbreviation: 'ARI', division: 'NFC West', conference: 'NFC', primaryColor: '#97233F', secondaryColor: '#000000', logo: teamLogo('ari') },
  { id: 'ATL', name: 'Atlanta Falcons', abbreviation: 'ATL', division: 'NFC South', conference: 'NFC', primaryColor: '#A71930', secondaryColor: '#000000', logo: teamLogo('atl') },
  { id: 'BAL', name: 'Baltimore Ravens', abbreviation: 'BAL', division: 'AFC North', conference: 'AFC', primaryColor: '#241773', secondaryColor: '#000000', logo: teamLogo('bal') },
  { id: 'BUF', name: 'Buffalo Bills', abbreviation: 'BUF', division: 'AFC East', conference: 'AFC', primaryColor: '#00338D', secondaryColor: '#C60C30', logo: teamLogo('buf') },
  { id: 'CAR', name: 'Carolina Panthers', abbreviation: 'CAR', division: 'NFC South', conference: 'NFC', primaryColor: '#0085CA', secondaryColor: '#101820', logo: teamLogo('car') },
  { id: 'CHI', name: 'Chicago Bears', abbreviation: 'CHI', division: 'NFC North', conference: 'NFC', primaryColor: '#0B162A', secondaryColor: '#C83803', logo: teamLogo('chi') },
  { id: 'CIN', name: 'Cincinnati Bengals', abbreviation: 'CIN', division: 'AFC North', conference: 'AFC', primaryColor: '#FB4F14', secondaryColor: '#000000', logo: teamLogo('cin') },
  { id: 'CLE', name: 'Cleveland Browns', abbreviation: 'CLE', division: 'AFC North', conference: 'AFC', primaryColor: '#311D00', secondaryColor: '#FF3C00', logo: teamLogo('cle') },
  { id: 'DAL', name: 'Dallas Cowboys', abbreviation: 'DAL', division: 'NFC East', conference: 'NFC', primaryColor: '#041E42', secondaryColor: '#869397', logo: teamLogo('dal') },
  { id: 'DEN', name: 'Denver Broncos', abbreviation: 'DEN', division: 'AFC West', conference: 'AFC', primaryColor: '#FB4F14', secondaryColor: '#002244', logo: teamLogo('den') },
  { id: 'DET', name: 'Detroit Lions', abbreviation: 'DET', division: 'NFC North', conference: 'NFC', primaryColor: '#0076B6', secondaryColor: '#B0B7BC', logo: teamLogo('det') },
  { id: 'GB', name: 'Green Bay Packers', abbreviation: 'GB', division: 'NFC North', conference: 'NFC', primaryColor: '#203731', secondaryColor: '#FFB612', logo: teamLogo('gb') },
  { id: 'HOU', name: 'Houston Texans', abbreviation: 'HOU', division: 'AFC South', conference: 'AFC', primaryColor: '#03202F', secondaryColor: '#A71930', logo: teamLogo('hou') },
  { id: 'IND', name: 'Indianapolis Colts', abbreviation: 'IND', division: 'AFC South', conference: 'AFC', primaryColor: '#002C5F', secondaryColor: '#A2AAAD', logo: teamLogo('ind') },
  { id: 'JAX', name: 'Jacksonville Jaguars', abbreviation: 'JAX', division: 'AFC South', conference: 'AFC', primaryColor: '#006778', secondaryColor: '#9F792C', logo: teamLogo('jax') },
  { id: 'KC', name: 'Kansas City Chiefs', abbreviation: 'KC', division: 'AFC West', conference: 'AFC', primaryColor: '#E31837', secondaryColor: '#FFB81C', logo: teamLogo('kc') },
  { id: 'LAC', name: 'Los Angeles Chargers', abbreviation: 'LAC', division: 'AFC West', conference: 'AFC', primaryColor: '#0080C6', secondaryColor: '#FFC20E', logo: teamLogo('lac') },
  { id: 'LA', name: 'Los Angeles Rams', abbreviation: 'LA', division: 'NFC West', conference: 'NFC', primaryColor: '#003594', secondaryColor: '#FFA300', logo: teamLogo('la') },
  { id: 'LV', name: 'Las Vegas Raiders', abbreviation: 'LV', division: 'AFC West', conference: 'AFC', primaryColor: '#000000', secondaryColor: '#A5ACAF', logo: teamLogo('lv') },
  { id: 'MIA', name: 'Miami Dolphins', abbreviation: 'MIA', division: 'AFC East', conference: 'AFC', primaryColor: '#008E97', secondaryColor: '#FC4C02', logo: teamLogo('mia') },
  { id: 'MIN', name: 'Minnesota Vikings', abbreviation: 'MIN', division: 'NFC North', conference: 'NFC', primaryColor: '#4F2683', secondaryColor: '#FFC62F', logo: teamLogo('min') },
  { id: 'NE', name: 'New England Patriots', abbreviation: 'NE', division: 'AFC East', conference: 'AFC', primaryColor: '#002244', secondaryColor: '#C60C30', logo: teamLogo('ne') },
  { id: 'NO', name: 'New Orleans Saints', abbreviation: 'NO', division: 'NFC South', conference: 'NFC', primaryColor: '#D3BC8D', secondaryColor: '#101820', logo: teamLogo('no') },
  { id: 'NYG', name: 'New York Giants', abbreviation: 'NYG', division: 'NFC East', conference: 'NFC', primaryColor: '#0B2265', secondaryColor: '#A71930', logo: teamLogo('nyg') },
  { id: 'NYJ', name: 'New York Jets', abbreviation: 'NYJ', division: 'AFC East', conference: 'AFC', primaryColor: '#125740', secondaryColor: '#000000', logo: teamLogo('nyj') },
  { id: 'PHI', name: 'Philadelphia Eagles', abbreviation: 'PHI', division: 'NFC East', conference: 'NFC', primaryColor: '#004C54', secondaryColor: '#A5ACAF', logo: teamLogo('phi') },
  { id: 'PIT', name: 'Pittsburgh Steelers', abbreviation: 'PIT', division: 'AFC North', conference: 'AFC', primaryColor: '#FFB612', secondaryColor: '#101820', logo: teamLogo('pit') },
  { id: 'SEA', name: 'Seattle Seahawks', abbreviation: 'SEA', division: 'NFC West', conference: 'NFC', primaryColor: '#002244', secondaryColor: '#69BE28', logo: teamLogo('sea') },
  { id: 'SF', name: 'San Francisco 49ers', abbreviation: 'SF', division: 'NFC West', conference: 'NFC', primaryColor: '#AA0000', secondaryColor: '#B3995D', logo: teamLogo('sf') },
  { id: 'TB', name: 'Tampa Bay Buccaneers', abbreviation: 'TB', division: 'NFC South', conference: 'NFC', primaryColor: '#D50A0A', secondaryColor: '#FF7900', logo: teamLogo('tb') },
  { id: 'TEN', name: 'Tennessee Titans', abbreviation: 'TEN', division: 'AFC South', conference: 'AFC', primaryColor: '#0C2340', secondaryColor: '#4B92DB', logo: teamLogo('ten') },
  { id: 'WAS', name: 'Washington Commanders', abbreviation: 'WAS', division: 'NFC East', conference: 'NFC', primaryColor: '#5A1414', secondaryColor: '#FFB612', logo: teamLogo('wsh') },
];

// Helper functions
export function getTeam(id: string): Team | undefined {
  return NFL_TEAMS.find((t) => t.id === id);
}

export function getTeamColor(id: string): string {
  return getTeam(id)?.primaryColor ?? "#6B7280";
}

export function getTeamLogo(id: string): string {
  return getTeam(id)?.logo ?? "";
}

// Groupings
export const DIVISIONS = Array.from(new Set(NFL_TEAMS.map((t) => t.division))).sort();
export const CONFERENCES = ["AFC", "NFC"] as const;

/* ─── Standings order ───
 * One rule for every standings view: the homepage board (TecmoStandings), the
 * team header's division rank (TeamIdentityCard) and the division rivals strip
 * (DivisionRivals). W/L/T come from ingest; this only orders them. */

type WinLossTie = Pick<TeamSeasonStat, "wins" | "losses" | "ties">;

/** A W/L/T count as a usable number — null, NaN or a missing field reads 0. */
function recordCount(n: number | null | undefined): number {
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

/**
 * Win percentage the NFL way: (W + T/2) / (W + L + T) — a tie is half a win.
 * A team that hasn't played (0-0, or no stats row at all) is .500, so early in
 * the season it sits below every winning record and above every losing one.
 */
export function winPct(rec: WinLossTie | null | undefined): number {
  const w = recordCount(rec?.wins);
  const l = recordCount(rec?.losses);
  const t = recordCount(rec?.ties);
  const games = w + l + t;
  return games > 0 ? (w + t / 2) / games : 0.5;
}

/**
 * Standings comparator, ready for Array#sort: negative when `a` ranks ahead of
 * `b`, positive when behind, 0 when the records are level.
 *   1. Higher win % first (9-7-1 .559 above 9-8 .529; 3-1 above 3-2 and 4-2).
 *   2. Same win %: more wins-minus-losses first — the "games behind" column —
 *      so 5-0 leads 4-0 and 0-2 leads 0-3 across a bye week.
 * Level records (9-8 vs 9-8, 0-0 vs 0-0-1) return 0: the board and the rivals
 * strip add their own final tiebreak, and division rank lets them share a
 * place. A missing row counts as 0-0. Never returns NaN.
 */
export function compareRecords(
  a: WinLossTie | null | undefined,
  b: WinLossTie | null | undefined
): number {
  const byPct = winPct(b) - winPct(a);
  if (byPct !== 0) return byPct;
  const marginA = recordCount(a?.wins) - recordCount(a?.losses);
  const marginB = recordCount(b?.wins) - recordCount(b?.losses);
  return marginB - marginA;
}
