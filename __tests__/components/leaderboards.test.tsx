// Spec A §4.2 / §4.6 / §4.7: the three leaderboards colour player EPA against
// the season's league average (not zero), say so under the table, and carry
// footnotes and tooltips that match what scripts/ingest.py computes.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import type { ReactElement } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { QBSeasonStat, RBSeasonStat, ReceiverSeasonStat } from "@/lib/types";

const nav = vi.hoisted(() => ({
  params: new URLSearchParams(),
  push: vi.fn(),
  replace: vi.fn(),
  pathname: "/rushing",
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => nav.params,
  useRouter: () => ({ push: nav.push, replace: nav.replace }),
  usePathname: () => nav.pathname,
}));

import RBLeaderboard from "@/components/tables/RBLeaderboard";
import ReceiverLeaderboard from "@/components/tables/ReceiverLeaderboard";
import QBLeaderboard from "@/components/tables/QBLeaderboard";

function setURL(pathname: string, query: string) {
  nav.pathname = pathname;
  nav.params = new URLSearchParams(query);
}

beforeEach(() => {
  nav.push.mockReset();
  nav.replace.mockReset();
});

function renderBoard(ui: ReactElement) {
  return render(<TooltipProvider>{ui}</TooltipProvider>);
}

/** Index of the column whose header text starts with `label`. */
function col(container: HTMLElement, label: string): number {
  const headers = Array.from(container.querySelectorAll("thead th"));
  const i = headers.findIndex((th) => (th.textContent ?? "").startsWith(label));
  if (i < 0) throw new Error(`no column "${label}"`);
  return i;
}

/** The row whose text contains the player's name. */
function row(container: HTMLElement, name: string): HTMLTableRowElement {
  const tr = Array.from(container.querySelectorAll<HTMLTableRowElement>("tbody tr")).find((r) =>
    (r.textContent ?? "").includes(name),
  );
  if (!tr) throw new Error(`no row for ${name}`);
  return tr;
}

function cellClass(container: HTMLElement, name: string, label: string): string {
  return row(container, name).querySelectorAll("td")[col(container, label)].className;
}

const COLOURS = ["text-green-600", "text-red-600", "text-gray-700"] as const;
function colourOf(cls: string): string {
  const hit = COLOURS.filter((c) => cls.split(/\s+/).includes(c));
  expect(hit, cls).toHaveLength(1);
  return hit[0];
}

/** The footnote block under the table. */
function footnotes(container: HTMLElement): string {
  const div = container.querySelector("div.border-t.pt-3");
  if (!div) throw new Error("no footnote block");
  return div.textContent ?? "";
}

function rb(id: string, name: string, epa: number, carries = 100): RBSeasonStat {
  return {
    id, player_id: id, player_name: name, position: "RB", team_id: "BUF", season: 2026,
    games: 2, carries, rushing_yards: carries * 4, rushing_tds: 0, yards_per_carry: 4,
    epa_per_carry: epa, success_rate: 0.4, stuff_rate: 0.2, explosive_rate: 0.1,
    fumbles: 0, fumbles_lost: 0, targets: 4, receptions: 3, receiving_yards: 20, receiving_tds: 0,
    total_touches: carries + 3, touches_per_game: (carries + 3) / 2, total_rushing_epa: epa * carries,
  };
}

function rec(id: string, name: string, epa: number, targets = 100, position = "WR"): ReceiverSeasonStat {
  return {
    id, player_id: id, player_name: name, position, team_id: "KC", season: 2026, games: 2,
    targets, receptions: Math.round(targets * 0.65), receiving_yards: targets * 8, receiving_tds: 1,
    catch_rate: 0.65, yards_per_target: 8, yards_per_reception: 12, epa_per_target: epa,
    yac: 100, yac_per_reception: 4, air_yards: 500, air_yards_per_target: 8, target_share: 0.2,
    fumbles: 0, fumbles_lost: 0,
    routes_run: null as unknown as number, yards_per_route_run: null as unknown as number,
    targets_per_route_run: null as unknown as number, total_snaps: null as unknown as number,
    snap_share: null as unknown as number, route_participation_rate: null as unknown as number,
    air_yards_share: 0.2, croe: 0.01, receiving_success_rate: 0.5, total_receiving_epa: epa * targets,
  };
}

function qb(id: string, name: string, over: Partial<QBSeasonStat>): QBSeasonStat {
  const base: QBSeasonStat = {
    id, player_id: id, player_name: name, team_id: "KC", season: 2026, games: 2,
    completions: 180, attempts: 280, dropbacks: 300, epa_per_db: 0, epa_per_play: 0, cpoe: 1,
    completion_pct: 64, success_rate: 0.45, passing_yards: 2000, touchdowns: 10, interceptions: 4,
    sacks: 15, sack_yards_lost: 90, adot: 8, ypa: 7, passer_rating: 90, any_a: 6,
    rush_attempts: 30, rush_yards: 120, rush_tds: 1, rush_epa_per_play: 0.2, fumbles: 1, fumbles_lost: 0,
    td_pct: 3.5, int_pct: 1.4, sack_pct: 5, scramble_pct: 0, total_epa: 0,
  };
  const q = { ...base, ...over };
  q.total_epa = (q.epa_per_db ?? 0) * q.dropbacks;
  return q;
}

describe("RB leaderboard: EPA colours against the league-average carry", () => {
  // Five backs, 100 carries each: the carry-weighted average is -0.10.
  const BACKS = [
    rb("r1", "Minus TwentyFive", -0.25),
    rb("r2", "Minus Fifteen", -0.15),
    rb("r3", "Minus Ten", -0.1),
    rb("r4", "Minus Three", -0.03),
    rb("r5", "Plus Three", 0.03),
  ];

  it("colours each back against -0.10, not against zero; Total EPA follows EPA/Car", () => {
    setURL("/rushing", "tab=epa");
    const { container } = renderBoard(<RBLeaderboard data={BACKS} throughWeek={2} season={2026} />);
    const expected: Record<string, string> = {
      "Minus TwentyFive": "text-red-600",
      "Minus Fifteen": "text-red-600",
      "Minus Ten": "text-gray-700",
      "Minus Three": "text-green-600", // a negative EPA/carry, better than the average back
      "Plus Three": "text-green-600",
    };
    for (const [name, colour] of Object.entries(expected)) {
      expect(colourOf(cellClass(container, name, "EPA/Car")), name).toBe(colour);
      expect(colourOf(cellClass(container, name, "Total EPA")), `${name} total`).toBe(colour);
    }
    const notes = footnotes(container);
    expect(notes).toContain("2026 average running-back carry (-0.10 EPA");
    expect(notes).toContain("within 0.03");
    expect(notes).toContain("Total EPA takes the colour of the back’s EPA/Car.");
    expect(container.textContent).not.toMatch(/\\u[0-9a-fA-F]{4}/);
  });

  it("shows no EPA colour before the season has 350 carries, and says why", () => {
    setURL("/rushing", "tab=epa");
    const { container } = renderBoard(<RBLeaderboard data={BACKS.slice(0, 3)} throughWeek={2} season={2026} />);
    for (const b of BACKS.slice(0, 3)) {
      expect(colourOf(cellClass(container, b.player_name, "EPA/Car"))).toBe("text-gray-700");
      expect(colourOf(cellClass(container, b.player_name, "Total EPA"))).toBe("text-gray-700");
    }
    expect(footnotes(container)).toContain("EPA colours start once 2026 has enough carries to set a league average.");
  });

  it("footnote defines Success% by EPA, not a yardage rule", () => {
    setURL("/rushing", "");
    const { container } = renderBoard(<RBLeaderboard data={BACKS} throughWeek={2} season={2026} />);
    const notes = footnotes(container);
    expect(notes).toContain("share of carries that gained expected points (EPA above zero)");
    expect(notes).not.toContain("stay on schedule");
    expect(notes).not.toMatch(/\\u[0-9a-fA-F]{4}/);
  });
});

describe("Receiver leaderboard: EPA colours against the league-average target", () => {
  // 100 targets each: the target-weighted average is (40+29+23+10+13)/500 = +0.23.
  const RECS = [
    rec("w1", "Plus Forty", 0.4),
    rec("w2", "Plus TwentyNine", 0.29),
    rec("w3", "Plus TwentyThree", 0.23, 100, "TE"),
    rec("w4", "Plus Ten", 0.1),
    rec("w5", "Plus Thirteen Back", 0.13, 100, "RB"),
  ];

  it("with the heatmap off, EPA/Tgt is green/grey/red around +0.23 with a 0.06 band", () => {
    setURL("/receivers", "");
    const { container } = renderBoard(<ReceiverLeaderboard data={RECS} throughWeek={2} season={2026} />);
    const heatmap = Array.from(container.querySelectorAll("label")).find((l) => l.textContent?.includes("Heatmap"))!;
    fireEvent.click(heatmap.querySelector("input")!);
    const expected: Record<string, string> = {
      "Plus Forty": "text-green-600",
      "Plus TwentyNine": "text-gray-700", // exactly average + band: grey
      "Plus TwentyThree": "text-gray-700",
      "Plus Ten": "text-red-600", // a positive EPA/target, worse than the average target
      "Plus Thirteen Back": "text-red-600",
    };
    for (const [name, colour] of Object.entries(expected)) {
      expect(colourOf(cellClass(container, name, "EPA/Tgt")), name).toBe(colour);
    }
    const notes = footnotes(container);
    expect(notes).toContain("2026 average target (0.23 EPA, WRs, TEs and backs, weighted by targets)");
    expect(notes).toContain("within 0.06");
  });

  it("Total EPA on the Efficiency tab takes the colour of the player's EPA/Tgt", () => {
    setURL("/receivers", "tab=efficiency");
    const { container } = renderBoard(<ReceiverLeaderboard data={RECS} throughWeek={2} season={2026} />);
    expect(colourOf(cellClass(container, "Plus Forty", "Total EPA"))).toBe("text-green-600");
    expect(colourOf(cellClass(container, "Plus TwentyNine", "Total EPA"))).toBe("text-gray-700");
    expect(colourOf(cellClass(container, "Plus Ten", "Total EPA"))).toBe("text-red-600");
  });

  it("has no average (and no colour) under 500 targets", () => {
    setURL("/receivers", "tab=efficiency");
    const { container } = renderBoard(<ReceiverLeaderboard data={RECS.slice(0, 4)} throughWeek={2} season={2026} />);
    expect(colourOf(cellClass(container, "Plus Forty", "Total EPA"))).toBe("text-gray-700");
    expect(footnotes(container)).toContain("EPA colours start once 2026 has enough targets to set a league average.");
  });

  it("footnotes divide by team targets and define Route% by dropbacks", () => {
    setURL("/receivers", "");
    const { container } = renderBoard(<ReceiverLeaderboard data={RECS} throughWeek={2} season={2026} />);
    const notes = footnotes(container);
    expect(notes).toContain("player targets / team targets");
    expect(notes).toContain("dropbacks he was on the field for");
    expect(notes).not.toContain("pass attempts");
    expect(notes).not.toContain("exceed typical ranges");
    expect(notes).not.toContain("total snaps");
    expect(notes).not.toMatch(/\\u[0-9a-fA-F]{4}/);
  });

  it("the Efficiency tab's Recv SR% column explains Recv SR%, not the QB Success%", () => {
    setURL("/receivers", "tab=efficiency");
    const { container } = renderBoard(<ReceiverLeaderboard data={RECS} throughWeek={2} season={2026} />);
    const th = container.querySelectorAll("thead th")[col(container, "Recv SR%")];
    expect(th.querySelector('[aria-label="What is Recv SR%?"]')).not.toBeNull();
    expect(th.querySelector('[aria-label="What is Success%?"]')).toBeNull();
  });
});

describe("QB leaderboard: three baselines", () => {
  // 3 QBs x 300 dropbacks, 30 rushes, no scrambles (330 plays each).
  const QBS = [
    qb("q1", "High Passer", { epa_per_db: 0.2, epa_per_play: 0.1, rush_epa_per_play: 0.43 }),
    qb("q2", "Mid Passer", { epa_per_db: 0.05, epa_per_play: 0.05, rush_epa_per_play: 0.29 }),
    qb("q3", "Low Passer", { epa_per_db: -0.1, epa_per_play: 0.0, rush_epa_per_play: 0.15 }),
  ];

  it("EPA/DB and Total EPA use the dropback average, EPA/Play the play average, Rush EPA the QB-rush average", () => {
    setURL("/qb-leaderboard", "tab=epa");
    const { container } = renderBoard(<QBLeaderboard data={QBS} throughWeek={2} season={2026} />);
    const expected: Record<string, [string, string]> = {
      "High Passer": ["text-green-600", "text-green-600"],
      "Mid Passer": ["text-gray-700", "text-gray-700"],
      "Low Passer": ["text-red-600", "text-red-600"],
    };
    for (const [name, [db, rush]] of Object.entries(expected)) {
      expect(colourOf(cellClass(container, name, "EPA/DB")), name).toBe(db);
      expect(colourOf(cellClass(container, name, "Total EPA")), name).toBe(db);
      expect(colourOf(cellClass(container, name, "EPA/Play")), name).toBe(db);
      expect(colourOf(cellClass(container, name, "Rush EPA")), name).toBe(rush);
    }
    // +0.15 per QB rush is red: the average QB rush is +0.29, not zero.
    expect(colourOf(cellClass(container, "Low Passer", "Rush EPA"))).toBe("text-red-600");
    const notes = footnotes(container);
    expect(notes).toContain("2026 league average");
    expect(notes).toContain("0.05 per dropback (EPA/DB and Total EPA)");
    expect(notes).toContain("0.05 per play (EPA/Play)");
    expect(notes).toContain("0.29 per QB rush (Rush EPA)");
    expect(notes).toContain("grey = within 0.03 (0.06 for Rush EPA)");
    expect(notes).not.toMatch(/\\u[0-9a-fA-F]{4}/);
  });

  it("when only the QB-rush floor is not met, Rush EPA stays grey and the legend says so", () => {
    setURL("/qb-leaderboard", "tab=epa");
    const fewRushes = QBS.map((q) => ({ ...q, rush_attempts: 10 })); // 30 rushes < 60
    const { container } = renderBoard(<QBLeaderboard data={fewRushes} throughWeek={2} season={2026} />);
    for (const q of fewRushes) {
      expect(colourOf(cellClass(container, q.player_name, "Rush EPA"))).toBe("text-gray-700");
    }
    expect(colourOf(cellClass(container, "High Passer", "EPA/DB"))).toBe("text-green-600");
    const notes = footnotes(container);
    expect(notes).toContain("not set yet per QB rush (Rush EPA)");
    expect(notes).toContain("0.05 per dropback");
  });

  it("with no averages at all, says colours start later", () => {
    setURL("/qb-leaderboard", "tab=epa");
    const tiny = QBS.map((q) => ({ ...q, dropbacks: 100, attempts: 90, rush_attempts: 5 }));
    const { container } = renderBoard(<QBLeaderboard data={tiny} throughWeek={2} season={2026} />);
    for (const q of tiny) expect(colourOf(cellClass(container, q.player_name, "EPA/DB"))).toBe("text-gray-700");
    expect(footnotes(container)).toContain("EPA colours start once 2026 has enough plays to set league averages.");
  });
});
