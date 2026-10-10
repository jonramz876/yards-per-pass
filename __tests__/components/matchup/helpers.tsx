// Shared by the matchup component tests: the real model over the frozen
// week 1-3 rows (the two frozen fixtures joined by game and team, as the
// loader's 35-column read returns them), and small source-text helpers.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import statsRowsJson from "../../stats/fixtures/team-game-stats-2026-w1-3.json";
import radarRowsJson from "../../stats/fixtures/team-radar-2026-w1-3.json";
import { buildMatchup, type MatchupModel, type MatchupSide } from "@/lib/stats/matchup";

type Row = Record<string, unknown>;
const RADAR_BY_KEY = new Map((radarRowsJson as Row[]).map((r) => [`${r.game_id}|${r.team_id}`, r]));
export const ROWS: Row[] = (statsRowsJson as Row[]).map((r) => ({ ...r, ...RADAR_BY_KEY.get(`${r.game_id}|${r.team_id}`) }));

export const model = (awayId = "BUF", homeId = "HOU", rows: Row[] = ROWS): MatchupModel =>
  buildMatchup({ rows, season: 2026, awayId, homeId });
export const awayBall = (awayId = "BUF", homeId = "HOU"): MatchupSide => model(awayId, homeId).awayBall as MatchupSide;
export const homeBall = (awayId = "BUF", homeId = "HOU"): MatchupSide => model(awayId, homeId).homeBall as MatchupSide;

/** Rows with one team's own rows removed: that team "has not played". */
export const rowsWithout = (teamId: string): Row[] => ROWS.filter((r) => r.team_id !== teamId);

export const COMPONENT_DIR = join(process.cwd(), "components", "matchup");
export const componentFiles = (): string[] =>
  existsSync(COMPONENT_DIR) ? readdirSync(COMPONENT_DIR).filter((f) => /\.tsx?$/.test(f)).sort() : [];
export const source = (file: string): string => readFileSync(join(COMPONENT_DIR, file), "utf8");
/** A source file without its comments, so a guard reads code and class strings, not prose. */
export const code = (file: string): string =>
  source(file)
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
/** Every whitespace-separated token inside the file's string and template literals: its class names, near enough. */
export const classTokens = (file: string): string[] =>
  Array.from(code(file).matchAll(/"([^"\n]*)"|`([^`]*)`/g))
    .flatMap((m) => (m[1] ?? m[2] ?? "").split(/\s+/))
    .filter(Boolean);

export const ACCENT = "#D50A0A";
export const classes = (el: Element | null | undefined): string[] => (el?.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);
