// /team-stats client table (team stats spec §5.3-5.4) over the real 2026
// weeks 1-3 fixture model.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import rowsJson from "../stats/fixtures/team-game-stats-2026-w1-3.json";
import { buildTeamStats, type TeamStatsModel } from "@/lib/stats/team-stats";
import * as P from "@/lib/stats/team-stats";

const nav = vi.hoisted(() => ({
  params: new URLSearchParams(),
  push: vi.fn(),
  replace: vi.fn(),
  pathname: "/team-stats",
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => nav.params,
  useRouter: () => ({ push: nav.push, replace: nav.replace }),
  usePathname: () => nav.pathname,
}));

import TeamStatsTable from "@/components/tables/TeamStatsTable";

const ROWS = rowsJson as Record<string, unknown>[];
const MODEL = buildTeamStats(ROWS);
const MINUS = "−";
const DASH = "—";

function setURL(query: string) {
  nav.params = new URLSearchParams(query);
}

beforeEach(() => {
  nav.push.mockReset();
  setURL("");
});

function renderTable(
  query = "",
  props: Partial<{ model: TeamStatsModel; season: number; throughWeek: number | null; isLatestSeason: boolean }> = {},
) {
  setURL(query);
  return render(
    <TooltipProvider>
      <TeamStatsTable model={MODEL} season={2026} throughWeek={3} isLatestSeason {...props} />
    </TooltipProvider>,
  );
}

const bodyRows = (c: HTMLElement) => Array.from(c.querySelectorAll<HTMLTableRowElement>("tbody tr"));
const teamRow = (c: HTMLElement, id: string) => {
  const tr = c.querySelector<HTMLTableRowElement>(`tbody tr[data-team="${id}"]`);
  if (!tr) throw new Error(`no row ${id}`);
  return tr;
};
const avgRow = (c: HTMLElement) => {
  const tr = c.querySelector<HTMLTableRowElement>("tbody tr[data-average]");
  if (!tr) throw new Error("no average row");
  return tr;
};
const cell = (tr: HTMLElement, key: string) => {
  const td = tr.querySelector<HTMLTableCellElement>(`td[data-key="${key}"]`);
  if (!td) throw new Error(`no cell ${key}`);
  return td;
};
const header = (c: HTMLElement, key: string) => {
  const th = c.querySelector<HTMLTableCellElement>(`thead th[data-key="${key}"]`);
  if (!th) throw new Error(`no header ${key}`);
  return th;
};
const hasClass = (el: Element, cls: string) => el.className.split(/\s+/).includes(cls);
const footnotes = (c: HTMLElement) =>
  Array.from(c.querySelectorAll("[data-footnotes] p")).map((p) => p.textContent);

describe("TeamStatsTable — default view (Efficiency, Offense)", () => {
  it("33 body rows: 32 teams and the NFL average last", () => {
    const { container } = renderTable();
    const rows = bodyRows(container);
    expect(rows).toHaveLength(33);
    expect(rows[32].textContent).toContain("NFL average");
  });

  it("sorted by EPA/play descending: SF first at +0.330, green; rank 1", () => {
    const { container } = renderTable();
    const first = bodyRows(container)[0];
    expect(first.getAttribute("data-team")).toBe("SF");
    expect(cell(first, "epa").textContent).toBe("+0.330");
    expect(hasClass(cell(first, "epa"), "text-green-600")).toBe(true);
    expect(first.querySelector("td")?.textContent).toBe("1");
    expect(header(container, "epa").textContent).toContain("▼");
  });

  it("CHI shows GP 2; SF toxic +17", () => {
    const { container } = renderTable();
    expect(cell(teamRow(container, "CHI"), "gp").textContent).toBe("2");
    expect(cell(teamRow(container, "SF"), "toxic").textContent).toBe("+17");
  });

  it("average row: 16.5 explosive plays, +0.008 EPA, toxic 0, never coloured", () => {
    const { container } = renderTable();
    const avg = avgRow(container);
    expect(cell(avg, "expl").textContent).toBe("16.5");
    expect(cell(avg, "epa").textContent).toBe("+0.008");
    expect(cell(avg, "toxic").textContent).toBe("0");
    expect(avg.querySelectorAll(".text-green-600, .text-red-600")).toHaveLength(0);
  });

  it("only EPA/play columns ever carry green or red", () => {
    for (const q of ["", "side=def", "tab=downs", "tab=downs&side=def", "tab=cost", "tab=cost&side=def"]) {
      const { container, unmount } = renderTable(q);
      for (const td of Array.from(container.querySelectorAll("td.text-green-600, td.text-red-600"))) {
        expect(["epa", "pass_epa", "rush_epa", "early_epa", "late_epa"], q).toContain(td.getAttribute("data-key"));
      }
      unmount();
    }
  });

  it("only the three allowed tooltips", () => {
    const { container } = renderTable();
    const labels = Array.from(container.querySelectorAll("[aria-label^='What is']")).map((b) => b.getAttribute("aria-label"));
    expect(labels).toEqual(["What is EPA / play?", "What is Success rate?", "What is Explosive plays?"]);
  });

  it("team links: /team/SF on the latest season, ?season=2025 otherwise", () => {
    const { container, unmount } = renderTable();
    expect(teamRow(container, "SF").querySelector("a")?.getAttribute("href")).toBe("/team/SF");
    unmount();
    const past = renderTable("", { season: 2025, isLatestSeason: false });
    expect(teamRow(past.container, "SF").querySelector("a")?.getAttribute("href")).toBe("/team/SF?season=2025");
  });

  it("the table scrolls inside its own box", () => {
    const { container } = renderTable();
    expect(hasClass(container.querySelector("table")!.parentElement!, "overflow-x-auto")).toBe(true);
  });

  it("C1 links Team Tiers to /teams; C2 subtitle", () => {
    const { container, getByText } = renderTable();
    const link = getByText("Team Tiers");
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toBe("/teams");
    expect(link.parentElement?.textContent).toBe(P.TEAM_TIERS_NOTE);
    expect(container.textContent).toContain("What each offense did");
  });
});

describe("TeamStatsTable — Defense", () => {
  it("MIN first at −0.204 in green; LV second; SF −0.009 grey against +0.008", () => {
    const { container } = renderTable("side=def");
    const rows = bodyRows(container);
    expect(rows[0].getAttribute("data-team")).toBe("MIN");
    expect(cell(rows[0], "epa").textContent).toBe(`${MINUS}0.204`);
    expect(hasClass(cell(rows[0], "epa"), "text-green-600")).toBe(true);
    expect(rows[1].getAttribute("data-team")).toBe("LV");
    const sf = cell(teamRow(container, "SF"), "epa");
    expect(sf.textContent).toBe(`${MINUS}0.009`);
    expect(hasClass(sf, "text-gray-700")).toBe(true);
    expect(header(container, "epa").textContent).toContain("▲");
  });

  it("no Toxic column; C3 and the Defense subtitle shown", () => {
    const { container } = renderTable("side=def");
    expect(container.querySelector("thead th[data-key='toxic']")).toBeNull();
    expect(footnotes(container)).toContain(P.DEFENSE_NOTE);
    expect(footnotes(container)).not.toContain(P.TOXIC_NOTE);
    expect(container.textContent).toContain("What opponents did against each team");
  });

  it("?side=def&sort=toxic falls back to EPA", () => {
    const { container } = renderTable("side=def&sort=toxic");
    expect(hasClass(header(container, "epa"), "bg-navy/60")).toBe(true);
    expect(bodyRows(container)[0].getAttribute("data-team")).toBe("MIN");
  });
});

describe("TeamStatsTable — URL", () => {
  it("a header click pushes ?sort=…; a second click adds &dir=…", () => {
    const { container } = renderTable("season=2026");
    fireEvent.click(header(container, "pass_epa"));
    expect(nav.push).toHaveBeenLastCalledWith("/team-stats?season=2026&sort=pass_epa", { scroll: false });
    fireEvent.click(header(container, "pass_epa"));
    expect(nav.push).toHaveBeenLastCalledWith("/team-stats?season=2026&sort=pass_epa&dir=asc", { scroll: false });
  });

  it("the side toggle pushes side=def and drops dir", () => {
    const { getByRole } = renderTable("sort=sr&dir=asc");
    fireEvent.click(getByRole("button", { name: "Defense" }));
    expect(nav.push).toHaveBeenLastCalledWith("/team-stats?side=def&sort=sr", { scroll: false });
  });

  it("switching side off a column that doesn't exist there resets to EPA", () => {
    const { getByRole } = renderTable("sort=toxic");
    fireEvent.click(getByRole("button", { name: "Defense" }));
    expect(nav.push).toHaveBeenLastCalledWith("/team-stats?side=def", { scroll: false });
  });

  it("a tab switch pushes tab=downs and resets the sort", () => {
    const { getByRole, container } = renderTable("sort=sr&dir=asc");
    fireEvent.click(getByRole("button", { name: "Early vs Late Downs" }));
    expect(nav.push).toHaveBeenLastCalledWith("/team-stats?tab=downs", { scroll: false });
    expect(hasClass(header(container, "early_epa"), "bg-navy/60")).toBe(true);
  });

  it("junk params are the default view", () => {
    const { container } = renderTable("side=zzz&tab=zzz&sort=zzz&dir=zzz");
    expect(bodyRows(container)[0].getAttribute("data-team")).toBe("SF");
    expect(hasClass(header(container, "epa"), "bg-navy/60")).toBe(true);
  });
});

describe("TeamStatsTable — tabs and footnotes", () => {
  it("Downs: NYG late −0.094, SF late +0.763; the average row's Plays is per team", () => {
    const { container } = renderTable("tab=downs");
    expect(cell(teamRow(container, "NYG"), "late_epa").textContent).toBe(`${MINUS}0.094`);
    expect(cell(teamRow(container, "SF"), "late_epa").textContent).toBe("+0.763");
    expect(cell(avgRow(container), "late_plays").textContent).toBe("42.6");
  });

  it("Cost: SF Total −8.08, league −16.02; C6 and C6b", () => {
    const { container } = renderTable("tab=cost");
    expect(cell(teamRow(container, "SF"), "cost_total").textContent).toBe(`${MINUS}8.08`);
    expect(cell(avgRow(container), "cost_total").textContent).toBe(`${MINUS}16.02`);
    expect(footnotes(container)).toEqual([P.COST_NOTE.off, P.STRIP_SACK_COST_NOTE, P.earlySeasonNote(3, true)]);
  });

  it("footnotes in every side × tab state", () => {
    for (const side of ["off", "def"] as const) {
      for (const tab of P.TEAM_STATS_TABS) {
        const q = new URLSearchParams();
        if (side === "def") q.set("side", "def");
        if (tab !== "eff") q.set("tab", tab);
        const { container, unmount } = renderTable(q.toString());
        expect(footnotes(container), `${side} ${tab}`).toEqual(
          P.teamStatsFootnotes({ side, tab, colourOn: true, season: 2026, throughWeek: 3, isLatestSeason: true }),
        );
        unmount();
      }
    }
  });

  it("C7 renders the 0.03 band; C8 names the weeks", () => {
    const { container } = renderTable();
    const notes = footnotes(container).join(" ");
    expect(notes).toContain("grey within 0.03.");
    expect(notes).toContain("With only 3 weeks played");
  });

  it("C8 absent past week 4 or on a past season", () => {
    const { container, unmount } = renderTable("", { throughWeek: 5 });
    expect(footnotes(container).join(" ")).not.toContain("With only");
    unmount();
    const past = renderTable("", { season: 2025, isLatestSeason: false, throughWeek: 3 });
    expect(footnotes(past.container).join(" ")).not.toContain("With only");
  });

  it("C7b: with too few plays there is no colour at all", () => {
    const model = buildTeamStats(ROWS.slice(0, 2));
    const { container } = renderTable("", { model });
    expect(container.querySelectorAll(".text-green-600, .text-red-600")).toHaveLength(0);
    const notes = footnotes(container);
    expect(notes).toContain(P.colourPendingNote(2026));
    expect(notes).not.toContain(P.colourNote());
  });
});

describe("TeamStatsTable — teams without games and unknown ids", () => {
  it("a team that hasn't played shows dashes, rank —, and sits below every team that has", () => {
    const model = buildTeamStats(ROWS.filter((r) => r.week === 1 && r.game_id !== ROWS[0].game_id));
    const { container } = renderTable("", { model });
    const rows = bodyRows(container);
    const ids = rows.map((r) => r.getAttribute("data-team"));
    const idle = [ROWS[0].team_id, ROWS[0].opponent_id] as string[];
    for (const id of idle) {
      const tr = teamRow(container, id);
      expect(ids.indexOf(id)).toBeGreaterThanOrEqual(30);
      expect(tr.querySelector("td")?.textContent).toBe(DASH);
      expect(cell(tr, "gp").textContent).toBe("0");
      expect(cell(tr, "expl").textContent).toBe(DASH);
      expect(cell(tr, "epa").textContent).toBe(DASH);
    }
  });

  it("an id not in NFL_TEAMS: no logo, no link, id text only", () => {
    const model = buildTeamStats([...ROWS, { ...ROWS[0], team_id: "XYZ", game_id: "2026_03_XYZ_SF" }]);
    const { container } = renderTable("", { model });
    const tr = teamRow(container, "XYZ");
    expect(tr.querySelector("a")).toBeNull();
    expect(tr.querySelector("img")).toBeNull();
    expect(tr.textContent).toContain("XYZ");
  });
});
