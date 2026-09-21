import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import PlayerTable from "@/components/game/PlayerTable";
import GameMessage from "@/components/game/GameMessage";
import { buildReceivingTable, buildRushingTable, type PlayerCell, type PlayerTableModel } from "@/lib/stats/box-score";
import { BUF_HOU_LINES } from "../../fixtures/box-score-buf-hou";

const M = "\u2212";
const DASH = "\u2014";

describe("PlayerTable", () => {
  const rushing = buildRushingTable(BUF_HOU_LINES, "BUF", "HOU");
  const receiving = buildReceivingTable(BUF_HOU_LINES, "BUF", "HOU", { BUF: 28, HOU: 37 });

  it("bands the title, heads the columns, and groups rows under team sub-headers, away first", () => {
    const { container } = render(<PlayerTable model={rushing} />);
    expect(container.querySelector("h2")?.textContent).toBe("Rushing");
    expect(Array.from(container.querySelectorAll("th")).map((th) => th.textContent)).toEqual(["Player", "CAR", "YDS", "TD", "YPC", "EPA/CAR", "SUCC%"]);
    expect(container.querySelectorAll("th")[0].className).toContain("text-left");
    expect(container.querySelectorAll("th")[1].className).toContain("text-right");
    const teamRows = Array.from(container.querySelectorAll("[data-team-row]"));
    expect(teamRows.map((r) => r.getAttribute("data-team-row"))).toEqual(["BUF", "HOU"]);
    expect((teamRows[0].querySelector("span") as HTMLElement).style.backgroundColor).toBe("rgb(0, 51, 141)");
    expect(teamRows[0].querySelector("td")?.getAttribute("colspan")).toBe("7");
    const order = Array.from(container.querySelectorAll("tbody tr")).map((r) => r.getAttribute("data-team-row") ?? r.getAttribute("data-player-id"));
    expect(order).toEqual(["BUF", "00-0038545", "00-0034857", "00-0039352", "00-0039354", "HOU", "00-0036212", "00-0039916", "00-0039163"]);
  });

  it("links names to player pages with a position tag, colours EPA cells, scrolls sideways", () => {
    const { container } = render(<PlayerTable model={rushing} />);
    const cook = container.querySelector('[data-player-id="00-0038545"]')!;
    expect(cook.querySelector("a")?.getAttribute("href")).toBe("/player/james-cook");
    expect(cook.querySelector("a")?.textContent).toBe("James Cook");
    expect(cook.querySelector("td")?.textContent).toBe("James CookRB");
    expect(Array.from(cook.querySelectorAll("td")).slice(1).map((td) => td.textContent)).toEqual(["13", "57", "0", "4.4", `${M}0.01`, "38%"]);
    // The leaderboards' sign split, not the team band: Cook's −0.01 EPA/CAR
    // is red here and red on the RB leaderboard.
    expect(cook.querySelectorAll("td")[5].className).toContain("text-red-600");
    expect(cook.querySelectorAll("td")[1].className).toContain("text-gray-900");
    const allen = container.querySelector('[data-player-id="00-0034857"]')!;
    expect(allen.querySelectorAll("td")[5].className).toContain("text-red-600");
    expect(container.querySelector("table")?.parentElement?.className).toContain("overflow-x-auto");
  });

  it("shows the team-targets note on Receiving and an unlinked name for a player without a slug", () => {
    const model: PlayerTableModel = {
      ...receiving,
      teams: receiving.teams.map((t, i) => (i === 0 ? { ...t, rows: t.rows.map((r) => (r.player_id === "00-0038557" ? { ...r, slug: null } : r)) } : t)),
    };
    const { container } = render(<PlayerTable model={model} footnote="Footnote text." />);
    expect(container.querySelector('[data-team-row="BUF"]')?.textContent).toBe("BUF · 28 team targets");
    const kincaid = container.querySelector('[data-player-id="00-0038557"]')!;
    expect(kincaid.querySelector("a")).toBeNull();
    expect(kincaid.querySelector("td")?.textContent).toBe("Dalton KincaidTE");
    expect(container.querySelector("p")?.textContent).toBe("Footnote text.");
  });

  it("says so when a team has no line", () => {
    const empty: PlayerTableModel = { key: "passing", title: "Passing", columns: ["Player", "C/ATT"], teams: [{ team_id: "BUF", color: "#00338D", rows: [] }, { team_id: "HOU", color: "#03202F", rows: [] }] };
    const { container } = render(<PlayerTable model={empty} />);
    expect(container.querySelectorAll("[data-empty-team]")).toHaveLength(2);
    expect(container.querySelector("[data-empty-team]")?.textContent).toBe("No passing line for BUF");
  });

  // Spec §11: a null EPA renders grey, not amber. epaPlayerCellClass(null) is
  // pinned in the stats test, but the wiring that decides whether it is called
  // at all — `"epa" in cell ? epaPlayerCellClass(cell.epa) : "text-gray-900"` —
  // was only ever exercised with real numbers, so changing it to
  // `cell.epa != null ? …` would render a null EPA in near-black with nothing
  // failing. Same class as the 2026-09-11 crash the spec names.
  //
  // The real-number case is the leaderboards' colour now, not the team band's:
  // −0.01 is red here exactly as it is on the RB leaderboard.
  it("renders a null or NaN EPA grey, and a real one in the leaderboards' colour", () => {
    const row = (id: string, name: string, epaCell: PlayerCell, ypc: string) => ({
      player_id: id, name, position: "RB", slug: null,
      cells: [{ text: "13" }, { text: "57" }, { text: "0" }, { text: ypc }, epaCell, { text: "38%" }] as PlayerCell[],
    });
    const model: PlayerTableModel = {
      key: "rushing", title: "Rushing",
      columns: ["Player", "CAR", "YDS", "TD", "YPC", "EPA/CAR", "SUCC%"],
      teams: [{
        team_id: "BUF", color: "#00338D",
        rows: [
          row("p-null", "No Epa", { text: DASH, epa: null }, DASH),
          row("p-nan", "Nan Epa", { text: DASH, epa: NaN }, DASH),
          row("p-real", "Real Epa", { text: `${M}0.01`, epa: -0.01 }, "4.4"),
        ],
      }],
    };
    const { container } = render(<PlayerTable model={model} />);
    const epaClass = (id: string) =>
      container.querySelector(`[data-player-id="${id}"]`)!.querySelectorAll("td")[5].className;
    for (const id of ["p-null", "p-nan"]) {
      expect(epaClass(id), id).toContain("text-gray-400");
      expect(epaClass(id), id).not.toContain("amber");
      expect(epaClass(id), id).not.toContain("text-gray-900");
    }
    expect(epaClass("p-real")).toContain("text-red-600");
    expect(epaClass("p-real")).not.toContain("amber");
    // This model carries the numeric cells the guard below needs; it used to
    // run against two empty teams, where no formatting path could produce the
    // words it looks for.
    expect(container.textContent).not.toMatch(/undefined|NaN|null/);
  });
});

describe("GameMessage", () => {
  it("renders the heading, body and team links", () => {
    const { container } = render(
      <GameMessage kind="uncovered" heading="Box scores start with the 2026 season" body="Not yet." links={[{ href: "/team/PHI", label: "Philadelphia Eagles" }, { href: "/team/LAC", label: "Los Angeles Chargers" }]} />
    );
    expect(container.querySelector('[data-game-message="uncovered"] h2')?.textContent).toBe("Box scores start with the 2026 season");
    expect(container.querySelector("p")?.textContent).toBe("Not yet.");
    expect(Array.from(container.querySelectorAll("a")).map((a) => [a.getAttribute("href"), a.textContent])).toEqual([
      ["/team/PHI", "Philadelphia Eagles ›"], ["/team/LAC", "Los Angeles Chargers ›"],
    ]);
  });

  it("renders no link row without links", () => {
    const { container } = render(<GameMessage kind="pending" heading="Stats arrive once play-by-play is published" body="Soon." />);
    expect(container.querySelectorAll("a")).toHaveLength(0);
    expect(container.querySelector('[data-game-message="pending"]')).not.toBeNull();
  });
});
