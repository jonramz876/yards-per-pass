// Shared by the matchup card's PR 2 tests (image, share page, matchup page):
// a whole MatchupLoad built by hand around the real model over the frozen
// week 1-3 rows, as __tests__/stats/matchup-card.test.ts builds it (no fixture
// holds a schedule), and the card model made from it.
import { ROWS } from "../../components/matchup/helpers";
import { NFL_TEAMS } from "@/lib/data/teams";
import type { MatchupLoad } from "@/lib/data/matchup";
import { buildMatchup, type MatchupGame } from "@/lib/stats/matchup";
import { buildMatchupCard, type MatchupCardModel, type MatchupCardPane } from "@/lib/stats/matchup-card";
import type { Team } from "@/lib/types";

export { ROWS };
export type Row = Record<string, unknown>;
export type CardModel = Extract<MatchupCardModel, { kind: "card" }>;
export type PlateModel = Extract<MatchupCardModel, { kind: "plate" }>;
export type DrawnPane = Extract<MatchupCardPane, { drawn: true }>;

export const team = (id: string): Team => {
  const t = NFL_TEAMS.find((x) => x.id === id);
  if (!t) throw new Error(`no team ${id}`);
  return t;
};

/** An unplayed Week 5 game of the pair, in this order. */
export const cardGame = (away: string, home: string, over: Partial<MatchupGame> = {}): MatchupGame => ({
  game_id: `2026_05_${away}_${home}`, season: 2026, game_type: "REG", week: 5,
  gameday: "2026-10-12", weekday: "Monday", gametime: "20:15",
  home_team: home, away_team: away, home_score: null, away_score: null,
  ...over,
});

export const RECORDS = { away: { wins: 3, losses: 1, ties: 0 }, home: { wins: 2, losses: 2, ties: 0 } };

/** The loader's whole answer for a pair: ready, a game in this order, games available. */
export function cardLoad(away = "BUF", home = "LA", over: Record<string, unknown> & { rows?: Row[] } = {}): MatchupLoad {
  const { rows, ...rest } = over;
  const model = buildMatchup({ rows: rows ?? ROWS, season: 2026, awayId: away, homeId: home });
  return {
    state: model.state, model, season: 2026, defaultSeason: 2026, isLatestSeason: true, swap: false,
    game: cardGame(away, home), records: RECORDS, lineup: null, playersAvailable: false, gamesAvailable: true,
    ...rest,
  } as unknown as MatchupLoad;
}

export const cardModelOf = (away: string, home: string, load: MatchupLoad): MatchupCardModel =>
  buildMatchupCard({ away: team(away), home: team(home), load });

export function asCard(m: MatchupCardModel): CardModel {
  if (m.kind !== "card") throw new Error(`expected a card, got a plate: ${m.message}`);
  return m;
}
export function asPlate(m: MatchupCardModel): PlateModel {
  if (m.kind !== "plate") throw new Error("expected a plate, got a card");
  return m;
}
export function drawnPane(p: MatchupCardPane): DrawnPane {
  if (!p.drawn) throw new Error(`expected a drawn pane, got: ${p.message}`);
  return p;
}

export const card = (away = "BUF", home = "LA", over: Record<string, unknown> & { rows?: Row[] } = {}): CardModel =>
  asCard(cardModelOf(away, home, cardLoad(away, home, over)));

/* ─── Row sets for the states ─── */

/** `teamId`'s offense has no Turnovers and no Stuffs rate: two missing spokes, the radar still draws. */
export const rowsMissingSpokes = (teamId: string): Row[] =>
  ROWS.map((r) => (r.team_id === teamId ? { ...r, designed_runs: null, total_drives: 0 } : r));
/** These teams' offenses have under four real spokes: their pane cannot be drawn. */
export const rowsUndrawn = (...teamIds: string[]): Row[] =>
  ROWS.map((r) => (teamIds.includes(r.team_id as string) ? { ...r, pass_plays: 0, attempts: 0, sacks: 0, total_drives: 0 } : r));
/** One game's rows: two teams have played, so the pool is too small for ranks. */
export const ROWS_SMALL_POOL: Row[] = ROWS.filter((r) => r.game_id === "2026_01_BUF_HOU");

/** The three plate states of spec §7, for BUF at HOU. */
export const PLATES: Record<string, () => PlateModel> = {
  "small-pool": () => asPlate(cardModelOf("BUF", "HOU", cardLoad("BUF", "HOU", { rows: ROWS_SMALL_POOL }))),
  uncovered: () =>
    asPlate(cardModelOf("BUF", "HOU", cardLoad("BUF", "HOU", { state: "uncovered", model: null, firstSeason: 2026, season: 2025, isLatestSeason: false, game: null }))),
  "neither pane drawn": () => asPlate(cardModelOf("BUF", "HOU", cardLoad("BUF", "HOU", { rows: rowsUndrawn("BUF", "HOU") }))),
};
