import { describe, it, expect } from "vitest";
import {
  fmtFixed,
  fmtSigned2,
  fmtSigned1,
  fmtDec1,
  fmtInt,
  fmtSignedInt,
  fmtPct,
  fmtPair,
  fmtClock,
  epaCellClass,
  recordThroughWeek,
  formatRecord,
  formatGameDate,
  gameLabel,
  normalizeGameType,
  normalizeGameId,
  GAME_ID_PATTERN,
  buildScoreboard,
  betterSide,
  buildComparison,
  LEGEND_TEXT,
  playCountNote,
  receivingNote,
  buildPassingTable,
  buildRushingTable,
  buildReceivingTable,
  type ComparisonRow,
} from "@/lib/stats/box-score";
import type { GamePlayerLines, TeamGame } from "@/lib/types";
import {
  BUF_HOU_GAME,
  BUF_STATS,
  HOU_STATS,
  BUF_HOU_LINES,
  ALLEN,
  scheduleFor,
  teamRow,
  rec,
  qb,
  rb,
} from "../fixtures/box-score-buf-hou";

const M = "\u2212"; // typographic minus
const DASH = "\u2014";

describe("number formatting", () => {
  it("prints a typographic minus and never a signed zero", () => {
    expect(fmtSigned2(0.278)).toBe("+0.28");
    expect(fmtSigned2(-0.2628)).toBe(`${M}0.26`);
    expect(fmtSigned2(0)).toBe("0.00");
    expect(fmtSigned2(-0.001)).toBe("0.00");
    expect(fmtDec1(-0.04)).toBe("0.0");
    expect(fmtDec1(-7)).toBe(`${M}7.0`);
    expect(fmtSigned1(8.1)).toBe("+8.1");
    expect(fmtInt(-3)).toBe(`${M}3`);
    expect(fmtInt(409)).toBe("409");
    expect(fmtSignedInt(2)).toBe("+2");
    expect(fmtSignedInt(0)).toBe("0");
    expect(fmtSignedInt(-2)).toBe(`${M}2`);
  });

  it("renders rates, pairs and clocks", () => {
    expect(fmtPct(0.4107)).toBe("41%");
    expect(fmtPct(6 / 28, 1)).toBe("21.4%");
    expect(fmtPct(0)).toBe("0%");
    expect(fmtPair(3, 9)).toBe("3-9");
    expect(fmtPair(20, 29, "/")).toBe("20/29");
    expect(fmtClock(23 * 60 + 43)).toBe("23:43");
    expect(fmtClock(68 * 60 + 26)).toBe("68:26");
    expect(fmtClock(5)).toBe("0:05");
    expect(fmtClock(-1)).toBe(DASH);
  });

  it("shows an em dash for null, undefined, NaN, Infinity and non-numbers", () => {
    for (const v of [null, undefined, NaN, Infinity, -Infinity]) {
      expect(fmtSigned2(v)).toBe(DASH);
      expect(fmtPct(v)).toBe(DASH);
      expect(fmtInt(v)).toBe(DASH);
      expect(fmtClock(v)).toBe(DASH);
    }
    expect(fmtPair(3, null)).toBe(DASH);
    expect(fmtFixed("12" as unknown as number, 1)).toBe(DASH);
  });

  it("colours EPA at the site's thresholds and greys out null/NaN (never amber)", () => {
    expect(epaCellClass(0.56)).toBe("text-green-700");
    expect(epaCellClass(0.02)).toBe("text-green-700");
    expect(epaCellClass(-0.01)).toBe("text-amber-600");
    expect(epaCellClass(-0.02)).toBe("text-amber-600");
    expect(epaCellClass(-0.46)).toBe("text-red-600");
    expect(epaCellClass(null)).toBe("text-gray-400");
    expect(epaCellClass(NaN)).toBe("text-gray-400");
    expect(epaCellClass(undefined)).toBe("text-gray-400");
  });
});

describe("records from the schedule (spec §6)", () => {
  it("counts played regular-season games through the week", () => {
    expect(recordThroughWeek(scheduleFor("BUF"), 1)).toEqual({ wins: 1, losses: 0, ties: 0 });
    expect(recordThroughWeek(scheduleFor("HOU"), 1)).toEqual({ wins: 0, losses: 1, ties: 0 });
  });

  it("ignores later weeks, playoff rows and unplayed games; ties count", () => {
    const [wk1, wk2] = scheduleFor("BUF");
    const played2: TeamGame = { ...wk2, played: true, result: "L", team_score: 20, opponent_score: 24, home_score: 20, away_score: 24 };
    const tie3: TeamGame = { ...played2, game_id: "2026_03_BUF_LAC", week: 3, opponent_id: "LAC", result: "T", team_score: 20, opponent_score: 20 };
    const playoff: TeamGame = { ...played2, game_id: "2026_19_BUF_MIA", week: 19, game_type: "WC", result: "W" };
    const all = [wk1, played2, tie3, playoff];
    expect(recordThroughWeek(all, 3)).toEqual({ wins: 1, losses: 1, ties: 1 });
    expect(recordThroughWeek(all, 2)).toEqual({ wins: 1, losses: 1, ties: 0 });
    expect(recordThroughWeek(all, 19)).toEqual({ wins: 1, losses: 1, ties: 1 });
    expect(recordThroughWeek([], 5)).toEqual({ wins: 0, losses: 0, ties: 0 });
  });

  it("formats the ties leg only when there is one", () => {
    expect(formatRecord({ wins: 1, losses: 0, ties: 0 })).toBe("1-0");
    expect(formatRecord({ wins: 9, losses: 7, ties: 1 })).toBe("9-7-1");
  });
});

describe("normalizeGameType — the one rule for games.game_type", () => {
  it("treats empty, blank and lower-case exactly as REG", () => {
    for (const raw of ["REG", "reg", "Reg", "", "   ", null, undefined]) {
      expect(normalizeGameType(raw)).toBe("REG");
    }
  });

  it("upper-cases the playoff rounds and leaves an unknown code alone", () => {
    expect(normalizeGameType("wc")).toBe("WC");
    expect(normalizeGameType(" post ")).toBe("POST");
    expect(normalizeGameType("SB")).toBe("SB");
  });
});

describe("normalizeGameId — the one rule for a /game/ address", () => {
  it("is the rule GAME_ID_PATTERN states, and both are importable without Supabase", () => {
    expect(normalizeGameId("2026_01_buf_hou")).toBe("2026_01_BUF_HOU");
    expect(GAME_ID_PATTERN.test("2026_01_BUF_HOU")).toBe(true);
    for (const bad of ["", "   ", "2026_03_BUF LAC", null, undefined, "2026_1_BUF_HOU"]) {
      expect(normalizeGameId(bad)).toBeNull();
    }
  });
});

describe("scoreboard model", () => {
  const today = new Date(2026, 8, 21);

  it("labels the week and date, and marks the winner", () => {
    const sb = buildScoreboard(BUF_HOU_GAME, { wins: 1, losses: 0, ties: 0 }, { wins: 0, losses: 1, ties: 0 }, today);
    expect(sb.label).toBe("WEEK 1");
    expect(sb.dateLabel).toBe("SUN SEP 13");
    expect(sb.away).toMatchObject({
      id: "BUF", abbreviation: "BUF", name: "Buffalo Bills", nickname: "Bills",
      record: "1-0", score: 36, winner: true, logo: "/logos/buf.png", primaryColor: "#00338D",
    });
    expect(sb.home).toMatchObject({ id: "HOU", nickname: "Texans", record: "0-1", score: 31, winner: false });
  });

  it("adds the year for another calendar year, tolerates bad dates and names playoff rounds", () => {
    expect(formatGameDate("2025-12-08", "Monday", today)).toBe("MON DEC 8, 2025");
    expect(formatGameDate(null, "Sunday", today)).toBe("SUN");
    expect(formatGameDate("garbage", null, today)).toBe("");
    expect(formatGameDate("2026-13-40", "Sun", today)).toBe("SUN");
    expect(gameLabel({ game_type: "WC", week: 19 })).toBe("WILD CARD");
    expect(gameLabel({ game_type: "SB", week: 22 })).toBe("SUPER BOWL");
    expect(gameLabel({ game_type: "REG", week: 7 })).toBe("WEEK 7");
    // An empty game_type must fall back to WEEK n, not render as "".
    expect(gameLabel({ game_type: "", week: 5 })).toBe("WEEK 5");
    // An unrecognized, non-empty type echoes itself.
    expect(gameLabel({ game_type: "XYZ", week: 5 })).toBe("XYZ");
  });

  it("marks neither score in a tie and copes with an unknown team id", () => {
    const sb = buildScoreboard(
      { ...BUF_HOU_GAME, home_score: 20, away_score: 20, away_team: "XYZ" },
      { wins: 0, losses: 0, ties: 1 },
      { wins: 0, losses: 0, ties: 1 },
      today
    );
    expect(sb.away.winner).toBe(false);
    expect(sb.home.winner).toBe(false);
    expect(sb.away).toMatchObject({ abbreviation: "XYZ", name: "XYZ", nickname: "XYZ", logo: "", record: "0-0-1" });
  });
});

/** "+0.28 (56)" — main value plus detail, the way a visitor reads the cell. */
function cell(c: { main: string; detail?: string }): string {
  return c.detail ? `${c.main} ${c.detail}` : c.main;
}

function rowsOf(sectionKey: string): ComparisonRow[] {
  const section = buildComparison(BUF_STATS, HOU_STATS).find((s) => s.key === sectionKey);
  if (!section) throw new Error(`no section ${sectionKey}`);
  return section.rows;
}

/** [key, BUF cell, HOU cell, shaded side] for one section. */
function flat(sectionKey: string): [string, string, string, string | null][] {
  return rowsOf(sectionKey).map((r) => [r.key, cell(r.away), cell(r.home), r.better]);
}

describe("comparison sections — 2026_01_BUF_HOU golden (spec §4 / mockup)", () => {
  it("lists the four sections in page order with their titles", () => {
    expect(buildComparison(BUF_STATS, HOU_STATS).map((s) => [s.key, s.title])).toEqual([
      ["efficiency", "Efficiency"],
      ["team-stats", "Team stats"],
      ["cost", "What it cost them"],
      ["downs", "Early vs late downs"],
    ]);
  });

  it("has a unique row key within each section", () => {
    for (const section of buildComparison(BUF_STATS, HOU_STATS)) {
      const keys = section.rows.map((r) => r.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it("Efficiency", () => {
    expect(flat("efficiency")).toEqual([
      ["epa", "+0.28 (56)", "+0.07 (79)", "away"],
      ["epa-pass", "+0.56 (37)", "+0.10 (48)", "away"],
      ["epa-rush", `${M}0.26 (19)`, "+0.03 (31)", "home"],
      ["success", "41%", "48%", "home"],
      ["success-pass", "46%", "52%", "home"],
      ["success-rush", "32%", "42%", "home"],
      ["first-down-rate", "36%", "32%", "away"],
      ["first-down-rate-pass", "43%", "33%", "away"],
      ["first-down-rate-rush", "21%", "29%", "home"],
      ["explosive", "8 (14%)", "8 (10%)", null],
      ["explosive-pass", "5 (14%)", "4 (8%)", "away"],
      ["explosive-rush", "3 (16%)", "4 (13%)", "home"],
      ["toxic", "+2 (TO +2, expl 0)", `${M}2 (TO ${M}2, expl 0)`, "away"],
    ]);
    // Spec §2's layout example is "8 (14%)"; the stored explosive_rate is
    // 8/56 = 14%, per PR 2's GOLD. Matches.
  });

  it("Efficiency labels, details, sub-rows and tooltips read as the mockup", () => {
    const rows = rowsOf("efficiency");
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(byKey.epa).toMatchObject({ label: "EPA / play", labelDetail: "(plays)", tooltip: "EPA / play" });
    expect(byKey["epa-pass"]).toMatchObject({ label: "Passing", sub: true });
    expect(byKey.success).toMatchObject({ label: "Success rate", tooltip: "Success rate" });
    expect(byKey["first-down-rate"]).toMatchObject({ label: "1st down rate", tooltip: "1st down rate" });
    expect(byKey["first-down-rate-rush"]).toMatchObject({ label: "Rushing", sub: true });
    expect(byKey.explosive).toMatchObject({ label: "Explosive plays", labelDetail: "(rate)", tooltip: "Explosive plays" });
    expect(byKey["explosive-pass"]).toMatchObject({ label: "Passing", labelDetail: "(20+ yd completion)", sub: true });
    expect(byKey["explosive-rush"]).toMatchObject({ label: "Rushing", labelDetail: "(10+ yd run)", sub: true });
    expect(byKey.toxic).toMatchObject({ label: "Toxic differential", labelDetail: "(turnovers + explosives)", tooltip: "Toxic differential" });
    expect(rows.filter((r) => r.tooltip).map((r) => r.tooltip)).toEqual(["EPA / play", "Success rate", "1st down rate", "Explosive plays", "Toxic differential"]);
  });

  it("Team stats", () => {
    expect(flat("team-stats")).toEqual([
      ["first-downs", "20", "26", "home"],
      ["first-downs-pass", "13", "11", "away"],
      ["first-downs-rush", "5", "10", "home"],
      ["first-downs-penalty", "2", "5", "home"],
      ["third-down", "3-9", "7-16", "home"],
      ["fourth-down", "0-1", "2-2", "home"],
      ["total-plays", "52", "73", null],
      ["total-yards", "409", "381", "away"],
      ["total-drives", "12", "11", null],
      ["yards-per-play", "7.9", "5.2", "away"],
      ["passing", "323", "257", "away"],
      ["comp-att", "20/29", "26/38", null],
      ["yards-per-pass", "10.4", "6.3", "away"],
      ["interceptions", "0", "0", null],
      ["sacks", "2-11", "3-17", "away"],
      ["rushing", "86", "124", "home"],
      ["rushing-attempts", "21", "32", null],
      ["yards-per-rush", "4.1", "3.9", "away"],
      ["red-zone", "1-3", "4-5", "home"],
      ["penalties", "10-85", "7-106", null],
      ["turnovers", "0", "2", "away"],
      ["fumbles-lost", "0", "2", "away"],
      ["turnovers-int", "0", "0", null],
      ["def-st-tds", "0", "0", null],
      ["possession", "23:43", "36:17", null],
    ]);
    const labels = rowsOf("team-stats").map((r) => (r.sub ? "↳ " : "") + r.label + (r.labelDetail ? ` ${r.labelDetail}` : ""));
    expect(labels).toEqual([
      "1st downs", "↳ Passing 1st downs", "↳ Rushing 1st downs", "↳ 1st downs from penalties",
      "↳ 3rd down efficiency", "↳ 4th down efficiency", "Total plays", "Total yards", "Total drives",
      "Yards per play", "Passing", "↳ Comp/Att", "↳ Yards per pass", "↳ Interceptions thrown",
      "↳ Sacks-yards lost", "Rushing", "↳ Rushing attempts", "↳ Yards per rush", "Red zone (made-att)",
      "Penalties", "Turnovers", "↳ Fumbles lost", "↳ Interceptions thrown", "Defensive / special teams TDs", "Possession",
    ]);
  });

  it("What it cost them — less bad is better, one decimal", () => {
    expect(flat("cost")).toEqual([
      ["cost-turnovers", "0.0", `${M}7.0`, "away"],
      ["cost-sacks", `${M}3.3`, `${M}8.7`, "away"],
      ["cost-penalties", `${M}8.5`, `${M}9.7`, "away"],
    ]);
  });

  it("Early vs late downs", () => {
    expect(flat("downs")).toEqual([
      ["early-epa", "+0.30 (45)", "+0.10 (59)", "away"],
      ["early-success", "42%", "47%", "home"],
      ["late-epa", "+0.30 (10)", `${M}0.01 (20)`, "away"],
      ["late-success", "40%", "50%", "home"],
    ]);
    const early = rowsOf("downs")[0];
    expect(early).toMatchObject({ label: "Early downs", labelDetail: "(1st–2nd)", labelSuffix: "EPA / play" });
    expect(rowsOf("downs")[2]).toMatchObject({ label: "Late downs", labelDetail: "(3rd–4th)", labelSuffix: "EPA / play" });
  });
});

describe("comparison sections — edge cases", () => {
  it("never shades a row whose values read the same, or where a value is missing", () => {
    expect(betterSide(0.281, 0.279, true, (v) => Math.round(v * 100))).toBeNull();
    expect(betterSide(0.28, 0.07, true, (v) => Math.round(v * 100))).toBe("away");
    expect(betterSide(2, 0, false)).toBe("home");
    expect(betterSide(null, 3, true)).toBeNull();
    expect(betterSide(3, NaN, true)).toBeNull();
  });

  it("shows dashes and no shading when a rate column is null (a team with no rush plays)", () => {
    const home = teamRow({ team_id: "HOU", rush_plays: 0, rush_epa_per_play: null, rush_success_rate: null, rush_first_down_rate: null, yards_per_rush: null, explosive_rush: 0, rushing_attempts: 0, rushing_yards: 0 });
    const rows = buildComparison(BUF_STATS, home);
    const eff = Object.fromEntries(rows[0].rows.map((r) => [r.key, r]));
    expect(cell(eff["epa-rush"].home)).toBe(`${DASH} (0)`);
    expect(eff["epa-rush"].better).toBeNull();
    expect(cell(eff["success-rush"].home)).toBe(DASH);
    expect(cell(eff["first-down-rate-rush"].home)).toBe(DASH);
    expect(eff["first-down-rate-rush"].better).toBeNull();
    expect(cell(eff["explosive-rush"].home)).toBe(`0 (${DASH})`);
    const team = Object.fromEntries(rows[1].rows.map((r) => [r.key, r]));
    expect(cell(team["yards-per-rush"].home)).toBe(DASH);
    expect(team["yards-per-rush"].better).toBeNull();
  });

  it("breaks a sacks tie on yards lost, and leaves 0-attempt made-att rows unshaded", () => {
    const home = teamRow({ team_id: "HOU", sacks: 2, sack_yards: 17, fourth_down_att: 0, fourth_down_conv: 0, red_zone_trips: 0, red_zone_tds: 0 });
    const team = Object.fromEntries(buildComparison(BUF_STATS, home)[1].rows.map((r) => [r.key, r]));
    expect(team.sacks.better).toBe("away");
    expect(cell(team["fourth-down"].home)).toBe("0-0");
    expect(team["fourth-down"].better).toBeNull();
    expect(team["red-zone"].better).toBeNull();
    const same = Object.fromEntries(buildComparison(BUF_STATS, teamRow({ team_id: "HOU" }))[1].rows.map((r) => [r.key, r]));
    expect(same.sacks.better).toBeNull();
  });

  it("does not shade the sacks row when a sack count is missing, even though yards would break the tie", () => {
    const away = teamRow({ sacks: null as unknown as number });
    const team = Object.fromEntries(buildComparison(away, HOU_STATS)[1].rows.map((r) => [r.key, r]));
    expect(cell(team.sacks.away)).toBe(DASH);
    expect(team.sacks.better).toBeNull();
  });

  it("quantizes negative decimals the way fmtFixed prints them, so identical-looking cells are never shaded apart", () => {
    const away = teamRow({ epa_lost_turnovers: -3.25 });
    const home = teamRow({ team_id: "HOU", epa_lost_turnovers: -3.26 });
    const cost = Object.fromEntries(buildComparison(away, home)[2].rows.map((r) => [r.key, r]));
    expect(cell(cost["cost-turnovers"].away)).toBe(`${M}3.3`);
    expect(cell(cost["cost-turnovers"].home)).toBe(`${M}3.3`);
    expect(cost["cost-turnovers"].better).toBeNull();
  });

  it("toxic differential shows a dash when a turnover count is missing", () => {
    const home = teamRow({ team_id: "HOU", turnovers: null as unknown as number });
    const eff = Object.fromEntries(buildComparison(BUF_STATS, home)[0].rows.map((r) => [r.key, r]));
    expect(eff.toxic.away.main).toBe(DASH);
    expect(eff.toxic.away.detail).toBeUndefined();
    expect(eff.toxic.better).toBeNull();
  });

  it("possession clocks a null as a dash and never shades", () => {
    const home = teamRow({ team_id: "HOU", time_of_possession_seconds: null });
    const team = Object.fromEntries(buildComparison(BUF_STATS, home)[1].rows.map((r) => [r.key, r]));
    expect(cell(team.possession.home)).toBe(DASH);
    expect(team.possession.better).toBeNull();
  });
});

describe("on-page notes (spec §12) come from the game's own numbers", () => {
  it("explains the three play counts with the away team's figures", () => {
    const note = playCountNote(BUF_STATS, HOU_STATS);
    expect(note).toContain("so BUF has 56 plays there and 52 in the official total above");
    expect(note).toContain("which is why BUF shows 21 attempts and 19 rush plays");
  });

  it("picks the team whose counts differ when the away team's match", () => {
    const away = teamRow({ plays: 52, rush_plays: 21 });
    expect(playCountNote(away, HOU_STATS)).toContain("HOU has 79 plays there and 73");
  });

  it("names the uncredited passing yards (Allen's lateral) and the rushing-table gap", () => {
    const note = receivingNote(BUF_HOU_LINES, "BUF", "HOU");
    expect(note).toContain("10 of Josh Allen\u2019s 334 passing yards aren\u2019t credited to a receiver above");
    expect(note).not.toContain("Stroud");
    expect(note.endsWith("runs by receivers and kneel-downs don\u2019t appear in the rushing table.")).toBe(true);
  });

  it("falls back to a generic sentence when every yard is credited", () => {
    const lines: GamePlayerLines = { ...BUF_HOU_LINES, qbs: [qb(ALLEN, "BUF", { passing_yards: 324 })] };
    expect(receivingNote(lines, "BUF", "HOU")).toBe(
      "Yards gained after a lateral belong to no receiver, and runs by receivers and kneel-downs don\u2019t appear in the rushing table."
    );
  });

  it("does not throw when players is missing from a malformed lines object", () => {
    const lines = { ...BUF_HOU_LINES, players: undefined } as unknown as GamePlayerLines;
    expect(() => receivingNote(lines, "BUF", "HOU")).not.toThrow();
  });
});

const texts = (table: ReturnType<typeof buildPassingTable>, team: string) =>
  table.teams.find((t) => t.team_id === team)!.rows.map((r) => [r.name, r.position, ...r.cells.map((c) => c.text)]);

describe("player tables — 2026_01_BUF_HOU golden (mockup)", () => {
  it("Passing: both QBs, away team first, no position tag", () => {
    const table = buildPassingTable(BUF_HOU_LINES, "BUF", "HOU");
    expect(table.columns).toEqual(["Player", "C/ATT", "YDS", "TD", "INT", "SCK", "RTG", "EPA/DB", "CPOE", "SUCC%", "aDOT"]);
    expect(table.teams.map((t) => t.team_id)).toEqual(["BUF", "HOU"]);
    expect(table.teams[0].color).toBe("#00338D");
    expect(texts(table, "BUF")).toEqual([["Josh Allen", null, "20/29", "334", "2", "0", "2", "130.5", "+0.56", "+8.1", "47%", "13.2"]]);
    expect(texts(table, "HOU")).toEqual([["C.J. Stroud", null, "26/38", "274", "2", "0", "3", "106.7", "+0.10", "+3.2", "50%", "8.5"]]);
    expect(table.teams[0].rows[0].slug).toBe("josh-allen");
    expect(table.teams[0].rows[0].cells[6]).toEqual({ text: "+0.56", epa: 0.5557 });
  });

  it("Rushing: RBs plus QB carries, sorted by yards with a stable tiebreak", () => {
    const table = buildRushingTable(BUF_HOU_LINES, "BUF", "HOU");
    expect(table.columns).toEqual(["Player", "CAR", "YDS", "TD", "YPC", "EPA/CAR", "SUCC%"]);
    expect(texts(table, "BUF")).toEqual([
      ["James Cook", "RB", "13", "57", "0", "4.4", `${M}0.01`, "38%"],
      ["Josh Allen", "QB", "5", "24", "2", "4.8", `${M}0.46`, "40%"],
      // 3 yards on 1 carry each: name A→Z decides.
      ["Frank Gore Jr.", "RB", "1", "3", "0", "3.0", `${M}0.06`, "0%"],
      ["Ray Davis", "RB", "1", "3", "0", "3.0", `${M}0.15`, "0%"],
    ]);
    expect(texts(table, "HOU")).toEqual([
      ["David Montgomery", "RB", "20", "60", "2", "3.0", `${M}0.02`, "40%"],
      ["Woody Marks", "RB", "9", "42", "0", "4.7", "+0.16", "44%"],
      ["C.J. Stroud", "QB", "2", "15", "0", "7.5", "+0.73", "50%"],
    ]);
  });

  // scripts/ingest.py builds qb_ids (:1990) and rb_ids (:2288) from the whole
  // season's weekly roster, so a player listed QB one week and RB/FB another is
  // in both sets all season and one game can write him a qb_weekly_stats row
  // AND an rb_weekly_stats row. The two disagree: the QB aggregator counts
  // designed runs plus scrambles (spec §10.1), the RB one filters scrambles out
  // (`qb_scramble != 1`, ingest.py:2293).
  const HILL = "00-0031547";
  function dualListed(qbCarries: number, rbCarries: number): GamePlayerLines {
    return {
      ...BUF_HOU_LINES,
      qbs: [
        ...BUF_HOU_LINES.qbs,
        qb(HILL, "BUF", {
          rush_attempts: qbCarries, rush_yards: 41, rush_tds: 1,
          rush_epa_per_carry: 0.11, rush_success_rate: 0.5,
        }),
      ],
      rbs: [...BUF_HOU_LINES.rbs, rb(HILL, "BUF", rbCarries, 30, 1, 0.05, 0.5)],
      players: {
        ...BUF_HOU_LINES.players,
        [HILL]: { player_id: HILL, player_name: "Taysom Hill", position: "QB", slug: "taysom-hill" },
      },
    };
  }

  it("Rushing: a dual-listed player renders once, keeping the line with more carries", () => {
    const buf = buildRushingTable(dualListed(8, 6), "BUF", "HOU").teams.find((t) => t.team_id === "BUF")!;
    expect(buf.rows.filter((r) => r.player_id === HILL)).toHaveLength(1);
    expect(new Set(buf.rows.map((r) => r.player_id)).size).toBe(buf.rows.length);
    // The QB line (8 carries, 41 yards), not the RB line's 6 for 30.
    expect(buf.rows.find((r) => r.player_id === HILL)!.cells.map((c) => c.text)).toEqual([
      "8", "41", "1", "5.1", "+0.11", "50%",
    ]);
    // …and the team's carries are not double-counted.
    expect(buf.rows.reduce((n, r) => n + Number(r.cells[0].text), 0)).toBe(13 + 5 + 1 + 1 + 8);
  });

  it("Rushing: an equal-carry dual listing keeps the QB line (spec §10.1)", () => {
    const buf = buildRushingTable(dualListed(8, 8), "BUF", "HOU").teams.find((t) => t.team_id === "BUF")!;
    const rows = buf.rows.filter((r) => r.player_id === HILL);
    expect(rows).toHaveLength(1);
    expect(rows[0].cells.map((c) => c.text)).toEqual(["8", "41", "1", "5.1", "+0.11", "50%"]);
  });

  it("Rushing: a dual listing whose RB line has more carries keeps the RB line", () => {
    const buf = buildRushingTable(dualListed(2, 9), "BUF", "HOU").teams.find((t) => t.team_id === "BUF")!;
    const rows = buf.rows.filter((r) => r.player_id === HILL);
    expect(rows).toHaveLength(1);
    expect(rows[0].cells.slice(0, 2).map((c) => c.text)).toEqual(["9", "30"]);
  });

  it("Receiving: team targets in the sub-header, TGT% by team targets, Y/TGT, no YPRR without routes", () => {
    const table = buildReceivingTable(BUF_HOU_LINES, "BUF", "HOU", { BUF: 28, HOU: 37 });
    expect(table.columns).toEqual(["Player", "TGT", "REC", "YDS", "TD", "TGT%", "YAC", "EPA/TGT", "CATCH%", "aDOT", "Y/TGT"]);
    expect(table.teams.map((t) => t.note)).toEqual(["28 team targets", "37 team targets"]);
    expect(texts(table, "BUF")).toEqual([
      ["Dalton Kincaid", "TE", "6", "5", "130", "0", "21.4%", "38", "+1.27", "83%", "16.3", "21.7"],
      ["DJ Moore", "WR", "8", "5", "100", "1", "28.6%", "24", "+0.80", "63%", "19.8", "12.5"],
      ["Khalil Shakir", "WR", "6", "4", "40", "0", "21.4%", "15", "+0.09", "67%", "6.5", "6.7"],
      ["Josh Palmer", "WR", "2", "1", "34", "1", "7.1%", "6", "+2.06", "50%", "31.0", "17.0"],
      ["James Cook", "RB", "4", "3", "12", "0", "14.3%", "14", `${M}0.09`, "75%", `${M}1.0`, "3.0"],
      ["Dawson Knox", "TE", "1", "1", "7", "0", "3.6%", "5", "+0.29", "100%", "2.0", "7.0"],
      ["Keon Coleman", "WR", "1", "1", "1", "0", "3.6%", `${M}3`, "+1.00", "100%", "4.0", "1.0"],
    ]);
    expect(texts(table, "HOU")).toEqual([
      ["Nico Collins", "WR", "10", "7", "75", "1", "27.0%", "8", "+0.49", "70%", "12.0", "7.5"],
      ["Jaylin Noel", "WR", "2", "2", "53", "0", "5.4%", "27", "+1.99", "100%", "13.0", "26.5"],
      ["Dalton Schultz", "TE", "8", "4", "35", "0", "21.6%", "27", `${M}0.32`, "50%", "3.3", "4.4"],
      ["Xavier Hutchinson", "WR", "6", "3", "32", "0", "16.2%", "21", "+0.15", "50%", "9.5", "5.3"],
      ["Kayshon Boutte", "WR", "2", "1", "21", "0", "5.4%", "7", "+0.21", "50%", "16.0", "10.5"],
      ["David Montgomery", "RB", "3", "3", "19", "1", "8.1%", "14", "+0.88", "100%", "1.7", "6.3"],
      ["Marlin Klein", "TE", "1", "1", "16", "0", "2.7%", "2", "+1.05", "100%", "14.0", "16.0"],
      ["Foster Moreau", "TE", "2", "2", "15", "0", "5.4%", "8", "+0.47", "100%", "3.5", "7.5"],
      ["Jared Wayne", "WR", "1", "1", "12", "0", "2.7%", "0", "+0.73", "100%", "12.0", "12.0"],
      ["Cade Stover", "TE", "1", "1", `${M}2`, "0", "2.7%", "0", `${M}0.94`, "100%", `${M}2.0`, `${M}2.0`],
      ["Woody Marks", "RB", "1", "1", `${M}2`, "0", "2.7%", "0", `${M}1.37`, "100%", `${M}2.0`, `${M}2.0`],
    ]);
  });
});

describe("player tables — edge cases", () => {
  it("shows YPRR only when any row in the game has route data", () => {
    const withRoutes: GamePlayerLines = {
      ...BUF_HOU_LINES,
      receivers: [
        rec("00-0038557", "BUF", 6, 5, 130, 0, 38, 1.27, 16.3, { routes_run: 30, yards_per_route_run: 130 / 30 }),
        rec("00-0036908", "HOU", 10, 7, 75, 1, 8, 0.49, 12.0),
      ],
    };
    const table = buildReceivingTable(withRoutes, "BUF", "HOU", { BUF: 28, HOU: 37 });
    expect(table.columns[table.columns.length - 1]).toBe("YPRR");
    expect(texts(table, "BUF")[0].slice(-1)).toEqual(["4.33"]);
    expect(texts(table, "HOU")[0].slice(-1)).toEqual([DASH]);
  });

  it("null EPA (a 2025 QB row before the backfill) renders a dash with a null epa, and a missing team target count blanks TGT%", () => {
    const lines: GamePlayerLines = {
      ...BUF_HOU_LINES,
      qbs: [qb(ALLEN, "BUF", { rush_attempts: 5, rush_yards: 24, rush_epa_per_carry: null, rush_success_rate: null })],
    };
    const rushing = buildRushingTable(lines, "BUF", "HOU");
    const allen = rushing.teams[0].rows.find((r) => r.player_id === ALLEN)!;
    expect(allen.cells[4]).toEqual({ text: DASH, epa: null });
    expect(allen.cells[5].text).toBe(DASH);
    const receiving = buildReceivingTable(BUF_HOU_LINES, "BUF", "HOU", { BUF: null, HOU: 0 });
    expect(receiving.teams.map((t) => t.note)).toEqual([undefined, undefined]);
    expect(receiving.teams[0].rows[0].cells[4].text).toBe(DASH);
  });

  it("leaves out QBs and RBs without a carry, and falls back to the id for an unknown player", () => {
    const lines: GamePlayerLines = {
      qbs: [qb(ALLEN, "BUF", { rush_attempts: 0 })],
      receivers: [],
      rbs: [
        { ...BUF_HOU_LINES.rbs[0], player_id: "00-0099999", carries: 0 },
        { ...BUF_HOU_LINES.rbs[1], player_id: "00-0088888" },
      ],
      players: {},
    };
    const table = buildRushingTable(lines, "BUF", "HOU");
    expect(table.teams[0].rows.map((r) => [r.name, r.slug, r.position])).toEqual([["00-0088888", null, "RB"]]);
    expect(table.teams[1].rows).toEqual([]);
    expect(buildPassingTable(lines, "BUF", "HOU").teams[0].rows[0]).toMatchObject({ name: "00-0034857", slug: null });
  });

  it("copes with empty lines", () => {
    const empty: GamePlayerLines = { qbs: [], receivers: [], rbs: [], players: {} };
    expect(buildPassingTable(empty, "BUF", "HOU").teams.map((t) => t.rows.length)).toEqual([0, 0]);
    expect(buildRushingTable(empty, "BUF", "HOU").teams.map((t) => t.rows.length)).toEqual([0, 0]);
    expect(buildReceivingTable(empty, "BUF", "HOU", {}).columns).toHaveLength(11);
    expect(receivingNote(empty, "BUF", "HOU")).toContain("Yards gained after a lateral");
    expect(LEGEND_TEXT).toContain("team pages");
  });

  it("omits the epa key entirely from non-EPA player cells", () => {
    const passing = buildPassingTable(BUF_HOU_LINES, "BUF", "HOU");
    expect("epa" in passing.teams[0].rows[0].cells[0]).toBe(false); // C/ATT
    expect("epa" in passing.teams[0].rows[0].cells[6]).toBe(true); // EPA/DB
    const rushing = buildRushingTable(BUF_HOU_LINES, "BUF", "HOU");
    expect("epa" in rushing.teams[0].rows[0].cells[0]).toBe(false); // CAR
    expect("epa" in rushing.teams[0].rows[0].cells[4]).toBe(true); // EPA/CAR
    const receiving = buildReceivingTable(BUF_HOU_LINES, "BUF", "HOU", { BUF: 28, HOU: 37 });
    expect("epa" in receiving.teams[0].rows[0].cells[0]).toBe(false); // TGT
    expect("epa" in receiving.teams[0].rows[0].cells[6]).toBe(true); // EPA/TGT
  });
});
