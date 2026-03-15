// lib/data/teams.ts
// Last verified: 2026-03-14
// Source: Official NFL team colors + ESPN CDN logos

import type { Team } from "@/lib/types";

const espnLogo = (abbr: string) =>
  `https://a.espncdn.com/i/teamlogos/nfl/500/${abbr.toLowerCase()}.png`;

export const NFL_TEAMS: Team[] = [
  { id: 'ARI', name: 'Arizona Cardinals', abbreviation: 'ARI', division: 'NFC West', conference: 'NFC', primaryColor: '#97233F', secondaryColor: '#000000', logo: espnLogo('ari') },
  { id: 'ATL', name: 'Atlanta Falcons', abbreviation: 'ATL', division: 'NFC South', conference: 'NFC', primaryColor: '#A71930', secondaryColor: '#000000', logo: espnLogo('atl') },
  { id: 'BAL', name: 'Baltimore Ravens', abbreviation: 'BAL', division: 'AFC North', conference: 'AFC', primaryColor: '#241773', secondaryColor: '#000000', logo: espnLogo('bal') },
  { id: 'BUF', name: 'Buffalo Bills', abbreviation: 'BUF', division: 'AFC East', conference: 'AFC', primaryColor: '#00338D', secondaryColor: '#C60C30', logo: espnLogo('buf') },
  { id: 'CAR', name: 'Carolina Panthers', abbreviation: 'CAR', division: 'NFC South', conference: 'NFC', primaryColor: '#0085CA', secondaryColor: '#101820', logo: espnLogo('car') },
  { id: 'CHI', name: 'Chicago Bears', abbreviation: 'CHI', division: 'NFC North', conference: 'NFC', primaryColor: '#0B162A', secondaryColor: '#C83803', logo: espnLogo('chi') },
  { id: 'CIN', name: 'Cincinnati Bengals', abbreviation: 'CIN', division: 'AFC North', conference: 'AFC', primaryColor: '#FB4F14', secondaryColor: '#000000', logo: espnLogo('cin') },
  { id: 'CLE', name: 'Cleveland Browns', abbreviation: 'CLE', division: 'AFC North', conference: 'AFC', primaryColor: '#311D00', secondaryColor: '#FF3C00', logo: espnLogo('cle') },
  { id: 'DAL', name: 'Dallas Cowboys', abbreviation: 'DAL', division: 'NFC East', conference: 'NFC', primaryColor: '#041E42', secondaryColor: '#869397', logo: espnLogo('dal') },
  { id: 'DEN', name: 'Denver Broncos', abbreviation: 'DEN', division: 'AFC West', conference: 'AFC', primaryColor: '#FB4F14', secondaryColor: '#002244', logo: espnLogo('den') },
  { id: 'DET', name: 'Detroit Lions', abbreviation: 'DET', division: 'NFC North', conference: 'NFC', primaryColor: '#0076B6', secondaryColor: '#B0B7BC', logo: espnLogo('det') },
  { id: 'GB', name: 'Green Bay Packers', abbreviation: 'GB', division: 'NFC North', conference: 'NFC', primaryColor: '#203731', secondaryColor: '#FFB612', logo: espnLogo('gb') },
  { id: 'HOU', name: 'Houston Texans', abbreviation: 'HOU', division: 'AFC South', conference: 'AFC', primaryColor: '#03202F', secondaryColor: '#A71930', logo: espnLogo('hou') },
  { id: 'IND', name: 'Indianapolis Colts', abbreviation: 'IND', division: 'AFC South', conference: 'AFC', primaryColor: '#002C5F', secondaryColor: '#A2AAAD', logo: espnLogo('ind') },
  { id: 'JAX', name: 'Jacksonville Jaguars', abbreviation: 'JAX', division: 'AFC South', conference: 'AFC', primaryColor: '#006778', secondaryColor: '#9F792C', logo: espnLogo('jax') },
  { id: 'KC', name: 'Kansas City Chiefs', abbreviation: 'KC', division: 'AFC West', conference: 'AFC', primaryColor: '#E31837', secondaryColor: '#FFB81C', logo: espnLogo('kc') },
  { id: 'LAC', name: 'Los Angeles Chargers', abbreviation: 'LAC', division: 'AFC West', conference: 'AFC', primaryColor: '#0080C6', secondaryColor: '#FFC20E', logo: espnLogo('lac') },
  { id: 'LAR', name: 'Los Angeles Rams', abbreviation: 'LAR', division: 'NFC West', conference: 'NFC', primaryColor: '#003594', secondaryColor: '#FFA300', logo: espnLogo('lar') },
  { id: 'LV', name: 'Las Vegas Raiders', abbreviation: 'LV', division: 'AFC West', conference: 'AFC', primaryColor: '#000000', secondaryColor: '#A5ACAF', logo: espnLogo('lv') },
  { id: 'MIA', name: 'Miami Dolphins', abbreviation: 'MIA', division: 'AFC East', conference: 'AFC', primaryColor: '#008E97', secondaryColor: '#FC4C02', logo: espnLogo('mia') },
  { id: 'MIN', name: 'Minnesota Vikings', abbreviation: 'MIN', division: 'NFC North', conference: 'NFC', primaryColor: '#4F2683', secondaryColor: '#FFC62F', logo: espnLogo('min') },
  { id: 'NE', name: 'New England Patriots', abbreviation: 'NE', division: 'AFC East', conference: 'AFC', primaryColor: '#002244', secondaryColor: '#C60C30', logo: espnLogo('ne') },
  { id: 'NO', name: 'New Orleans Saints', abbreviation: 'NO', division: 'NFC South', conference: 'NFC', primaryColor: '#D3BC8D', secondaryColor: '#101820', logo: espnLogo('no') },
  { id: 'NYG', name: 'New York Giants', abbreviation: 'NYG', division: 'NFC East', conference: 'NFC', primaryColor: '#0B2265', secondaryColor: '#A71930', logo: espnLogo('nyg') },
  { id: 'NYJ', name: 'New York Jets', abbreviation: 'NYJ', division: 'AFC East', conference: 'AFC', primaryColor: '#125740', secondaryColor: '#000000', logo: espnLogo('nyj') },
  { id: 'PHI', name: 'Philadelphia Eagles', abbreviation: 'PHI', division: 'NFC East', conference: 'NFC', primaryColor: '#004C54', secondaryColor: '#A5ACAF', logo: espnLogo('phi') },
  { id: 'PIT', name: 'Pittsburgh Steelers', abbreviation: 'PIT', division: 'AFC North', conference: 'AFC', primaryColor: '#FFB612', secondaryColor: '#101820', logo: espnLogo('pit') },
  { id: 'SEA', name: 'Seattle Seahawks', abbreviation: 'SEA', division: 'NFC West', conference: 'NFC', primaryColor: '#002244', secondaryColor: '#69BE28', logo: espnLogo('sea') },
  { id: 'SF', name: 'San Francisco 49ers', abbreviation: 'SF', division: 'NFC West', conference: 'NFC', primaryColor: '#AA0000', secondaryColor: '#B3995D', logo: espnLogo('sf') },
  { id: 'TB', name: 'Tampa Bay Buccaneers', abbreviation: 'TB', division: 'NFC South', conference: 'NFC', primaryColor: '#D50A0A', secondaryColor: '#FF7900', logo: espnLogo('tb') },
  { id: 'TEN', name: 'Tennessee Titans', abbreviation: 'TEN', division: 'AFC South', conference: 'AFC', primaryColor: '#0C2340', secondaryColor: '#4B92DB', logo: espnLogo('ten') },
  { id: 'WAS', name: 'Washington Commanders', abbreviation: 'WAS', division: 'NFC East', conference: 'NFC', primaryColor: '#5A1414', secondaryColor: '#FFB612', logo: espnLogo('wsh') },
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
