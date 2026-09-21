import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("@/lib/data/box-score", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/data/box-score")>()),
  getBoxScore: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createServerClient: vi.fn(),
  hasNoDatabase: vi.fn(() => false),
}));

// base-ui tooltips need a provider; the page test only cares which metrics get one.
vi.mock("@/components/ui/MetricTooltip", () => ({
  default: ({ metric }: { metric: string }) => <span data-tooltip={metric} />,
}));

import GamePage, { generateMetadata } from "@/app/game/[game_id]/page";
import { getBoxScore, type BoxScoreData } from "@/lib/data/box-score";
import { hasNoDatabase } from "@/lib/supabase/server";
import { BUF_HOU_GAME, BUF_STATS, HOU_STATS, BUF_HOU_LINES } from "../fixtures/box-score-buf-hou";

const RECORDS = { away: { wins: 1, losses: 0, ties: 0 }, home: { wins: 0, losses: 1, ties: 0 } };
const READY: BoxScoreData = { state: "ready", game: BUF_HOU_GAME, records: RECORDS, away: BUF_STATS, home: HOU_STATS, lines: BUF_HOU_LINES };
const M = "\u2212";

const page = (game_id: string) => GamePage({ params: Promise.resolve({ game_id }) });
const meta = (game_id: string) => generateMetadata({ params: Promise.resolve({ game_id }) });

beforeEach(() => {
  vi.mocked(getBoxScore).mockReset();
  vi.mocked(hasNoDatabase).mockReset();
  vi.mocked(hasNoDatabase).mockReturnValue(false);
});

describe("GamePage — states (spec §6)", () => {
  it("junk address → notFound without a query", async () => {
    await expect(page("not-a-game")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(getBoxScore).not.toHaveBeenCalled();
  });

  it("lower-case address is looked up upper-cased", async () => {
    vi.mocked(getBoxScore).mockResolvedValue({ state: "not-found" });
    await expect(page("2026_01_buf_hou")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(getBoxScore).toHaveBeenCalledWith("2026_01_BUF_HOU");
  });

  it("unknown game and unplayed game → notFound", async () => {
    vi.mocked(getBoxScore).mockResolvedValue({ state: "not-found" });
    await expect(page("2026_01_BUF_HOU")).rejects.toThrow("NEXT_NOT_FOUND");
    vi.mocked(getBoxScore).mockResolvedValue({ state: "unplayed", game: { ...BUF_HOU_GAME, home_score: null, away_score: null } });
    await expect(page("2026_09_BUF_HOU")).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("2020–2025 game → scoreboard + 'Box scores start with the 2026 season' + both team links", async () => {
    vi.mocked(getBoxScore).mockResolvedValue({
      state: "uncovered", reason: "season", firstSeason: 2026, records: { away: { wins: 8, losses: 5, ties: 0 }, home: { wins: 9, losses: 4, ties: 0 } },
      game: { ...BUF_HOU_GAME, game_id: "2025_14_PHI_LAC", season: 2025, week: 14, gameday: "2025-12-08", weekday: "Monday", away_team: "PHI", home_team: "LAC", away_score: 19, home_score: 22 },
    });
    const { container } = render(await page("2025_14_PHI_LAC"));
    expect(container.querySelector("[data-scoreboard]")).not.toBeNull();
    expect(container.querySelector("[data-scoreboard-label]")?.textContent).toMatch(/^WEEK 14 · MON DEC 8/);
    expect(screen.getByText("Box scores start with the 2026 season")).toBeTruthy();
    expect(container.textContent).toContain("Team stats and player lines for earlier games aren\u2019t available yet.");
    expect(container.querySelector('[data-game-message="uncovered"]')).not.toBeNull();
    expect(container.querySelector('[data-game-message] a[href="/team/PHI"]')?.textContent).toContain("Philadelphia Eagles");
    expect(container.querySelector('[data-game-message] a[href="/team/LAC"]')?.textContent).toContain("Los Angeles Chargers");
    expect(container.querySelector("[data-section]")).toBeNull();
    expect(container.querySelector("[data-player-table]")).toBeNull();
  });

  it("playoff game → scoreboard + regular-season-only message", async () => {
    vi.mocked(getBoxScore).mockResolvedValue({
      state: "uncovered", reason: "playoffs", firstSeason: null, records: RECORDS,
      game: { ...BUF_HOU_GAME, game_id: "2026_19_BUF_HOU", game_type: "WC", week: 19 },
    });
    const { container } = render(await page("2026_19_BUF_HOU"));
    expect(container.querySelector("[data-scoreboard-label]")?.textContent).toMatch(/^WILD CARD/);
    expect(screen.getByText("Box scores cover regular-season games for now")).toBeTruthy();
    expect(container.textContent).toContain("Playoff games don\u2019t have team stats or player lines here yet.");
  });

  it("played 2026 game without stats yet → 'Stats arrive once play-by-play is published'", async () => {
    vi.mocked(getBoxScore).mockResolvedValue({ state: "pending", game: BUF_HOU_GAME, records: RECORDS });
    const { container } = render(await page("2026_01_BUF_HOU"));
    expect(screen.getByText("Stats arrive once play-by-play is published")).toBeTruthy();
    expect(container.textContent).toContain("That\u2019s usually within a few hours of the final whistle.");
    expect(container.querySelector('[data-game-message="pending"]')).not.toBeNull();
  });

  it("a failed protected read throws (never a blank page) unless there is no database", async () => {
    vi.mocked(getBoxScore).mockRejectedValue(new Error("Failed to fetch team game stats for 2026_01_BUF_HOU: fetch failed"));
    await expect(page("2026_01_BUF_HOU")).rejects.toThrow("Failed to fetch team game stats");
    vi.mocked(getBoxScore).mockRejectedValue({ message: "TypeError: fetch failed", details: "", hint: "", code: "" });
    await expect(page("2026_01_BUF_HOU")).rejects.toThrow("Box score data unavailable: TypeError: fetch failed");
    vi.mocked(hasNoDatabase).mockReturnValue(true);
    await expect(page("2026_01_BUF_HOU")).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

describe("GamePage — 2026_01_BUF_HOU renders the golden values", () => {
  beforeEach(() => {
    vi.mocked(getBoxScore).mockResolvedValue(READY);
  });

  it("scoreboard: band, teams, records, score with the winner in gold, team links", async () => {
    const { container } = render(await page("2026_01_BUF_HOU"));
    const sb = container.querySelector("[data-scoreboard]")!;
    expect(sb.querySelector("[data-scoreboard-label]")?.textContent).toMatch(/^WEEK 1 · SUN SEP 13/);
    expect(sb.textContent).toContain("FINAL");
    const away = sb.querySelector('[data-scoreboard-team="away"]')!;
    const home = sb.querySelector('[data-scoreboard-team="home"]')!;
    expect(away.getAttribute("href")).toBe("/team/BUF");
    expect(away.textContent).toContain("BUF");
    expect(away.textContent).toContain("Bills");
    expect(away.textContent).toContain("1-0");
    expect(home.getAttribute("href")).toBe("/team/HOU");
    expect(home.textContent).toContain("HOU");
    expect(home.textContent).toContain("Texans");
    expect(home.textContent).toContain("0-1");
    expect(sb.querySelector('[data-score="away"]')?.textContent).toBe("36");
    expect(sb.querySelector('[data-score="home"]')?.textContent).toBe("31");
    expect((sb.querySelector('[data-score="away"]') as HTMLElement).style.color).toBe("rgb(251, 191, 36)");
    expect((sb.querySelector('[data-score="home"]') as HTMLElement).style.color).toBe("");
    expect(sb.querySelectorAll("img")).toHaveLength(2);
  });

  it("legend, four sections in order, shaded better sides, tooltips and notes", async () => {
    const { container } = render(await page("2026_01_BUF_HOU"));
    expect(container.textContent).toContain("Shaded = the better side of each row.");
    expect(Array.from(container.querySelectorAll("[data-section]")).map((s) => s.getAttribute("data-section"))).toEqual([
      "efficiency", "team-stats", "cost", "downs",
    ]);
    const row = (key: string) => container.querySelector(`[data-row="${key}"]`)!;
    const cells = (key: string) => Array.from(row(key).querySelectorAll("td")).map((td) => td.textContent);
    expect(cells("epa")).toEqual(["+0.28(56)", "EPA / play(plays)", "+0.07(79)"]);
    expect(row("epa").getAttribute("data-better")).toBe("away");
    expect((row("epa").querySelectorAll("td")[0] as HTMLElement).style.backgroundColor).toBe("rgb(236, 253, 245)");
    expect((row("epa").querySelectorAll("td")[2] as HTMLElement).style.backgroundColor).toBe("");
    expect(cells("epa-rush")).toEqual([`${M}0.26(19)`, "↳ Rushing", "+0.03(31)"]);
    expect(row("epa-rush").getAttribute("data-better")).toBe("home");
    expect(cells("explosive")).toEqual(["8(14%)", "Explosive plays(rate)", "8(10%)"]);
    expect(row("explosive").getAttribute("data-better")).toBeNull();
    expect(cells("toxic")).toEqual(["+2(TO +2, expl 0)", "Toxic differential(turnovers + explosives)", `${M}2(TO ${M}2, expl 0)`]);
    expect(cells("sacks")).toEqual(["2-11", "↳ Sacks-yards lost", "3-17"]);
    expect(cells("possession")).toEqual(["23:43", "Possession", "36:17"]);
    expect(cells("cost-turnovers")).toEqual(["0.0", "EPA lost to turnovers", `${M}7.0`]);
    expect(cells("early-epa")).toEqual(["+0.30(45)", "Early downs(1st–2nd) EPA / play", "+0.10(59)"]);
    expect(Array.from(container.querySelectorAll("[data-tooltip]")).map((e) => e.getAttribute("data-tooltip"))).toEqual([
      "EPA / play", "Success rate", "1st down rate", "Explosive plays", "Toxic differential",
    ]);
    const teamStats = container.querySelector('[data-section="team-stats"]')!;
    expect(teamStats.textContent).toContain("Why the play counts differ.");
    expect(teamStats.textContent).toContain("BUF has 56 plays there and 52 in the official total above");
    expect(container.querySelector('[data-section="cost"]')?.textContent).toContain("A strip-sack counts in both the sack row and the turnover row.");
  });

  it("player tables: order, team sub-headers, links, position tags, EPA colours, notes, no YPRR", async () => {
    const { container } = render(await page("2026_01_BUF_HOU"));
    expect(Array.from(container.querySelectorAll("[data-player-table]")).map((t) => t.getAttribute("data-player-table"))).toEqual([
      "passing", "rushing", "receiving",
    ]);
    const passing = container.querySelector('[data-player-table="passing"]')!;
    expect(Array.from(passing.querySelectorAll("th")).map((th) => th.textContent)).toEqual([
      "Player", "C/ATT", "YDS", "TD", "INT", "SCK", "RTG", "EPA/DB", "CPOE", "SUCC%", "aDOT",
    ]);
    expect(Array.from(passing.querySelectorAll("[data-team-row]")).map((r) => r.getAttribute("data-team-row"))).toEqual(["BUF", "HOU"]);
    const allen = passing.querySelector('[data-player-id="00-0034857"]')!;
    expect(allen.querySelector("a")?.getAttribute("href")).toBe("/player/josh-allen");
    expect(Array.from(allen.querySelectorAll("td")).map((td) => td.textContent)).toEqual([
      "Josh Allen", "20/29", "334", "2", "0", "2", "130.5", "+0.56", "+8.1", "47%", "13.2",
    ]);
    expect(allen.querySelectorAll("td")[7].className).toContain("text-green-700");

    const rushing = container.querySelector('[data-player-table="rushing"]')!;
    const cook = rushing.querySelector('[data-player-id="00-0038545"]')!;
    expect(cook.querySelectorAll("td")[0].textContent).toBe("James CookRB");
    expect(cook.querySelectorAll("td")[5].className).toContain("text-amber-600");
    const allenRush = rushing.querySelector('[data-player-id="00-0034857"]')!;
    expect(Array.from(allenRush.querySelectorAll("td")).map((td) => td.textContent)).toEqual([
      "Josh AllenQB", "5", "24", "2", "4.8", `${M}0.46`, "40%",
    ]);
    expect(allenRush.querySelectorAll("td")[5].className).toContain("text-red-600");

    const receiving = container.querySelector('[data-player-table="receiving"]')!;
    expect(receiving.textContent).toContain("28 team targets");
    expect(receiving.textContent).toContain("37 team targets");
    expect(receiving.textContent).not.toContain("YPRR");
    expect(receiving.querySelector('[data-player-id="00-0038557"] a')?.textContent).toBe("Dalton Kincaid");
    expect(receiving.textContent).toContain("Player lines won\u2019t always add up to team totals.");
    expect(receiving.textContent).toContain("10 of Josh Allen\u2019s 334 passing yards");
    expect(receiving.querySelector(".overflow-x-auto")).not.toBeNull();
  });

  it("null EPA renders a grey dash, never amber", async () => {
    vi.mocked(getBoxScore).mockResolvedValue({
      ...READY,
      lines: { ...BUF_HOU_LINES, qbs: [{ ...BUF_HOU_LINES.qbs[0], epa_per_dropback: null as unknown as number, rush_epa_per_carry: null }, BUF_HOU_LINES.qbs[1]] },
    });
    const { container } = render(await page("2026_01_BUF_HOU"));
    const cell = container.querySelector('[data-player-table="passing"] [data-player-id="00-0034857"]')!.querySelectorAll("td")[7];
    expect(cell.textContent).toBe("\u2014");
    expect(cell.className).toContain("text-gray-400");
    expect(cell.className).not.toContain("amber");
  });
});

describe("GamePage generateMetadata", () => {
  it("ready → winner-first title, canonical, indexable", async () => {
    vi.mocked(getBoxScore).mockResolvedValue(READY);
    const m = await meta("2026_01_BUF_HOU");
    expect(m.title).toBe("Bills 36, Texans 31 — 2026 Week 1 box score");
    expect(m.alternates?.canonical).toBe("https://yardsperpass.com/game/2026_01_BUF_HOU");
    expect("robots" in m).toBe(false);
    expect(String(m.description)).toContain("Buffalo Bills at Houston Texans");
  });

  it("uncovered → noindex; pending → indexable; unknown → not-found title", async () => {
    vi.mocked(getBoxScore).mockResolvedValue({ state: "uncovered", reason: "season", firstSeason: 2026, game: { ...BUF_HOU_GAME, season: 2025 }, records: RECORDS });
    expect((await meta("2025_01_BUF_HOU")).robots).toEqual({ index: false, follow: true });
    vi.mocked(getBoxScore).mockResolvedValue({ state: "pending", game: BUF_HOU_GAME, records: RECORDS });
    expect("robots" in (await meta("2026_01_BUF_HOU"))).toBe(false);
    vi.mocked(getBoxScore).mockResolvedValue({ state: "not-found" });
    expect(String((await meta("2026_01_BUF_HOU")).title)).toContain("Game Not Found");
    expect(String((await meta("junk")).title)).toContain("Game Not Found");
  });

  it("home winner is named first", async () => {
    vi.mocked(getBoxScore).mockResolvedValue({ ...READY, game: { ...BUF_HOU_GAME, away_score: 20, home_score: 27 } });
    expect((await meta("2026_01_BUF_HOU")).title).toBe("Texans 27, Bills 20 — 2026 Week 1 box score");
  });
});
