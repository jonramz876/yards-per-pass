// Team radar chart and section (team radar spec 2026-10-06 §4, §7, §8), over
// the real 2026 weeks 1-3 radar fixture.
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import rowsJson from "../stats/fixtures/team-radar-2026-w1-3.json";
import * as R from "@/lib/stats/team-radar";
import {
  RADAR_AXES,
  buildTeamRadar,
  teamRadarSlice,
  type RadarSide,
  type RadarSideModel,
  type TeamRadarSlice,
} from "@/lib/stats/team-radar";
import { getTeam } from "@/lib/data/teams";
import TeamRadarChart from "@/components/team/TeamRadarChart";
import TeamRadarSection from "@/components/team/TeamRadarSection";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

type Row = Record<string, unknown>;
const ROWS = rowsJson as Row[];
const MODEL = buildTeamRadar(ROWS);
const BUF = getTeam("BUF")!;
const sliceFor = (teamId: string, rows: Row[] | null = ROWS, season = 2026, covered = [2026]) =>
  teamRadarSlice({ teamId, season, rows, newestSeason: 2026, covered });
const ready = (s: TeamRadarSlice) => {
  if (s.state !== "ready") throw new Error(s.state);
  return s;
};
const bufSide = (side: RadarSide) => MODEL.teams.find((t) => t.team === "BUF")![side];

function chart(side: RadarSideModel, sideKey: RadarSide = "off", size?: "sm" | "lg") {
  return render(<TeamRadarChart side={side} sideKey={sideKey} color="#00338D" label="Buffalo Bills offense radar" size={size} />)
    .container;
}

function section(radar: TeamRadarSlice, teamId = "BUF", defaultSeason = 2026) {
  const team = getTeam(teamId) ?? BUF;
  return render(
    <TooltipProvider>
      <TeamRadarSection radar={radar} team={team} defaultSeason={defaultSeason} />
    </TooltipProvider>,
  ).container;
}

/** Every numeric-looking SVG attribute in the tree, for the no-NaN checks. */
function svgAttrs(c: HTMLElement): string[] {
  const out: string[] = [];
  c.querySelectorAll("svg, svg *").forEach((el) => {
    for (const a of Array.from(el.attributes)) out.push(`${a.name}=${a.value}`);
  });
  return out;
}

const vertexCount = (d: string) => (d.match(/[ML]/g) ?? []).length;

/** A side with the given spokes blanked out. */
function without(side: RadarSideModel, keys: string[]): RadarSideModel {
  return {
    ...side,
    spokes: side.spokes.map((s) => (keys.includes(s.key) ? { ...s, value: null, rank: null, score: null, tied: false, count: null } : s)),
  };
}

describe("TeamRadarChart", () => {
  it("one vertex and one dot per real spoke; the outline closes", () => {
    const c = chart(bufSide("off"));
    const outline = c.querySelector("path[data-radar-outline]")!;
    expect(vertexCount(outline.getAttribute("d")!)).toBe(7);
    expect(outline.getAttribute("d")).toMatch(/Z$/);
    expect(c.querySelectorAll("circle[data-radar-vertex]")).toHaveLength(7);
    expect(outline.getAttribute("stroke")).toBe("#00338D");
  });

  it("three rings: outer, the dashed middle of the league, and the inner ring last place sits on", () => {
    const c = chart(bufSide("off"));
    expect(c.querySelectorAll("path[data-ring]")).toHaveLength(3);
    expect(c.querySelector('path[data-ring="mid"]')!.getAttribute("stroke-dasharray")).toBe("5,3");
    expect(c.querySelector('path[data-ring="outer"]')!.getAttribute("stroke-dasharray")).toBeNull();
    expect(c.querySelectorAll("line[data-radar-axis-line]")).toHaveLength(7);
  });

  it("1st sits on the outer ring and last on the inner ring (BUF explosive run is 1st: its dot is the outer ring's top-left vertex)", () => {
    const side = bufSide("off");
    const c = chart(side);
    const i = RADAR_AXES.findIndex((a) => a.key === "expl_rush");
    expect(side.spokes[i].rank).toBe(1);
    const dot = c.querySelectorAll("circle[data-radar-vertex]")[i];
    const outer = c.querySelector('path[data-ring="outer"]')!.getAttribute("d")!;
    expect(outer).toContain(`${dot.getAttribute("cx")},${dot.getAttribute("cy")}`);

    const last = { ...side, spokes: side.spokes.map((s) => ({ ...s, rank: s.pool, score: 0 })) };
    const cl = chart(last);
    const inner = cl.querySelector('path[data-ring="inner"]')!.getAttribute("d")!;
    cl.querySelectorAll("circle[data-radar-vertex]").forEach((d) => {
      expect(inner).toContain(`${d.getAttribute("cx")},${d.getAttribute("cy")}`);
    });
  });

  it("two-line labels: the name, then value · rank; a tied rank prints T-", () => {
    const c = chart(bufSide("off"));
    const labels = Array.from(c.querySelectorAll("text[data-axis]")).map((t) => t.textContent);
    expect(labels).toEqual(RADAR_AXES.map((a) => a.label));
    const values = Array.from(c.querySelectorAll("text[data-axis-value]")).map((t) => t.textContent);
    expect(values[0]).toBe("10.7% · 2nd");
    expect(values[6]).toBe("20.0% · 1st");
    const tied = { ...bufSide("off"), spokes: bufSide("off").spokes.map((s, i) => (i === 3 ? { ...s, value: 0, rank: 30, tied: true } : s)) };
    expect(chart(tied).querySelectorAll("text[data-axis-value]")[3].textContent).toBe("0.0% · T-30th");
  });

  it("the defense chart's fourth label is Takeaway rate", () => {
    const labels = Array.from(chart(bufSide("def"), "def").querySelectorAll("text[data-axis]")).map((t) => t.textContent);
    expect(labels[3]).toBe("Takeaway rate");
    expect(labels.filter((_, i) => i !== 3)).toEqual(RADAR_AXES.filter((_, i) => i !== 3).map((a) => a.label));
  });

  it("a missing spoke gets no vertex and a gray label; the outline bridges its neighbours", () => {
    const c = chart(without(bufSide("off"), ["stuff"]));
    expect(vertexCount(c.querySelector("path[data-radar-outline]")!.getAttribute("d")!)).toBe(6);
    expect(c.querySelectorAll("circle[data-radar-vertex]")).toHaveLength(6);
    const missing = c.querySelectorAll('text[data-missing-axis="true"]');
    expect(missing).toHaveLength(1);
    expect(missing[0].textContent).toBe("Stuff rate");
    expect(missing[0].getAttribute("fill")).toBe("#cbd5e1");
    expect(c.querySelectorAll("text[data-axis-value]")[4].textContent).toBe("—");
  });

  it("fewer than 4 real spokes: no chart at all (the section shows R20 and the table)", () => {
    expect(chart(without(bufSide("off"), ["stuff", "sack", "to", "rush_sr"])).querySelector("svg")).toBeNull();
    expect(chart(without(bufSide("off"), ["stuff", "sack", "to"])).querySelector("svg")).not.toBeNull();
  });

  it("no NaN, undefined or Infinity in any attribute — real rows, missing spokes, junk scores, a short colour", () => {
    const junk: RadarSideModel = {
      gp: 1,
      spokes: bufSide("off").spokes.map((s, i) => ({ ...s, score: [NaN, Infinity, -1, 2, null, 0.5, 1][i] as number | null })),
    };
    for (const side of [bufSide("off"), bufSide("def"), without(bufSide("off"), ["stuff", "to"]), junk]) {
      for (const size of ["sm", "lg"] as const) {
        const attrs = svgAttrs(chart(side, "off", size)).join("\n");
        expect(attrs).not.toMatch(/NaN|undefined|Infinity/);
      }
    }
    const short = render(<TeamRadarChart side={bufSide("off")} sideKey="off" color="" label="x" />).container;
    expect(svgAttrs(short).join("\n")).not.toMatch(/NaN|undefined/);
  });

  it("is labelled for screen readers and has a size prop", () => {
    const sm = chart(bufSide("off")).querySelector("svg")!;
    expect(sm.getAttribute("role")).toBe("img");
    expect(sm.getAttribute("aria-label")).toBe("Buffalo Bills offense radar");
    expect(sm.getAttribute("viewBox")).toBe("0 0 420 340");
    expect(chart(bufSide("off"), "off", "lg").querySelector("svg")!.getAttribute("viewBox")).not.toBe("0 0 420 340");
  });
});

describe("TeamRadarSection — ready", () => {
  const c = () => section(ready(sliceFor("BUF")));
  const rowsOf = (el: HTMLElement, side: RadarSide) =>
    Array.from(el.querySelectorAll<HTMLTableRowElement>(`[data-radar-side="${side}"] tbody tr`));
  const cells = (tr: HTMLTableRowElement) => Array.from(tr.querySelectorAll("td")).map((td) => td.textContent ?? "");

  it("is anchored #team-radar, with the band and the lead (R1)", () => {
    const el = c();
    expect(el.querySelector('[id="team-radar"]')).not.toBeNull();
    expect(el.querySelector("h3")!.textContent).toContain("Team Radar");
    expect(el.querySelector("h3")!.textContent).toContain("2026 · Through Week 3");
    expect(el.querySelector("[data-radar-lead]")!.textContent).toBe("How the Buffalo Bills rank among all 32 teams, through 3 games.");
  });

  it("links to Team Stats, carrying a past season", () => {
    const a = c().querySelector<HTMLAnchorElement>("a[data-radar-compare]")!;
    expect(a.textContent).toContain("Compare all teams on Team Stats");
    expect(a.getAttribute("href")).toBe("/team-stats");
    const past = section({ ...ready(sliceFor("BUF")), season: 2025, isLatestSeason: false }, "BUF", 2026);
    expect(past.querySelector("a[data-radar-compare]")!.getAttribute("href")).toBe("/team-stats?season=2025");
  });

  it("two sides, each with its heading, subtitle (R2), radar and a 7-row table", () => {
    const el = c();
    const off = el.querySelector('[data-radar-side="off"]')!;
    const def = el.querySelector('[data-radar-side="def"]')!;
    expect(off.querySelector("h4")!.textContent).toBe("Offense");
    expect(def.querySelector("h4")!.textContent).toBe("Defense");
    expect(off.querySelector("[data-radar-subtitle]")!.textContent).toBe("What the offense did");
    expect(def.querySelector("[data-radar-subtitle]")!.textContent).toBe("What opponents did against this defense");
    expect(off.querySelector("svg")!.getAttribute("aria-label")).toBe("Buffalo Bills offense radar");
    expect(def.querySelector("svg")!.getAttribute("aria-label")).toBe("Buffalo Bills defense radar");
    expect(rowsOf(el, "off")).toHaveLength(7);
    expect(rowsOf(el, "def")).toHaveLength(7);
    expect(Array.from(off.querySelectorAll("thead th")).map((th) => th.textContent)).toEqual(["Stat", "BUF", "Rank", "NFL avg"]);
  });

  it("table rows: value, rank and NFL average for every spoke (BUF offense, real numbers)", () => {
    const el = c();
    const s = ready(sliceFor("BUF"));
    rowsOf(el, "off").forEach((tr, i) => {
      const [stat, value, rank, avg] = cells(tr);
      expect(stat).toContain(RADAR_AXES[i].label);
      expect(stat).toContain(RADAR_AXES[i].subline);
      expect(value).toBe(R.fmtRadarPct(s.off.spokes[i].value));
      expect(rank).toBe(R.spokeRankLabel(s.off.spokes[i]));
      expect(avg).toBe(R.fmtRadarPct(s.league[RADAR_AXES[i].key]));
    });
    const first = cells(rowsOf(el, "off")[0]);
    expect(first.slice(1)).toEqual(["10.7%", "2nd", "7.3%"]);
    expect(cells(rowsOf(el, "off")[4]).slice(1)).toEqual(["7.7%", "1st", "17.5%"]);
  });

  it("a plain ratio's counts sit beside its sub-line, as in the mockup; a weighted rate has none", () => {
    const el = c();
    const s = ready(sliceFor("BUF"));
    const [n, d] = s.off.spokes[0].count!;
    expect(cells(rowsOf(el, "off")[0])[0]).toContain(`Completions of 20+ yards ÷ pass plays (${n} of ${d})`);
    expect(cells(rowsOf(el, "off")[1])[0]).not.toMatch(/\(\d+ of \d+\)/);
  });

  it("the defense table's fourth row is Takeaway rate with the opponents' sub-line (R7, review M2)", () => {
    const row = cells(rowsOf(c(), "def")[3])[0];
    expect(row).toContain("Takeaway rate");
    expect(row).toContain("Opponent turnovers ÷ opponent drives");
    expect(cells(rowsOf(c(), "off")[3])[0]).toContain("Turnovers ÷ drives");
    expect(cells(rowsOf(c(), "off")[3])[0]).not.toContain("Opponent");
  });

  it("rank chips: green in the top third, red in the bottom third, neutral between", () => {
    const el = c();
    const s = ready(sliceFor("BUF"));
    rowsOf(el, "off").forEach((tr, i) => {
      const chip = tr.querySelector("[data-rank-tone]")!;
      expect(chip.getAttribute("data-rank-tone")).toBe(R.rankTone(s.off.spokes[i].rank, s.off.spokes[i].pool));
    });
    expect(rowsOf(el, "off")[6].querySelector("[data-rank-tone]")!.getAttribute("data-rank-tone")).toBe("good");
    expect(rowsOf(el, "off")[2].querySelector("[data-rank-tone]")!.getAttribute("data-rank-tone")).toBe("bad");
  });

  it("the three new tooltips sit on Sack rate, Turnover / Takeaway rate and Stuff rate (R17-R19), on both tables", () => {
    const el = c();
    for (const side of ["off", "def"] as const) {
      const rows = rowsOf(el, side);
      expect(rows[2].querySelector('[aria-label="What is Team sack rate?"]')).not.toBeNull();
      expect(rows[3].querySelector('[aria-label="What is Team turnover rate?"]')).not.toBeNull();
      expect(rows[4].querySelector('[aria-label="What is Team stuff rate?"]')).not.toBeNull();
      expect(rows[0].querySelector("[aria-label^='What is']")).toBeNull();
    }
  });

  it("footnotes R3, R4, R5, R5b and the early-season note, in order", () => {
    const notes = Array.from(c().querySelectorAll("[data-radar-footnotes] p")).map((p) => p.textContent);
    expect(notes).toEqual(R.teamRadarFootnotes({ teamsPlayed: 32, throughWeek: 3, isLatestSeason: true }));
    expect(notes).toHaveLength(5);
    expect(notes[4]).toBe("With only 3 weeks played, one game moves a team a long way.");
  });

  it("PR 2 has no Share buttons and no link to a share page", () => {
    const el = c();
    expect(el.textContent).not.toMatch(/Share/);
    expect(el.querySelector('a[href*="/card/"]')).toBeNull();
    expect(el.querySelectorAll("button[data-share], a[data-share]")).toHaveLength(0);
  });

  it("renders no literal escape and no NaN / undefined / null text anywhere", () => {
    for (const id of ["BUF", "PHI", "SF", "CHI"]) {
      const el = section(ready(sliceFor(id)), id);
      expect(el.textContent).not.toMatch(/\\u[0-9a-fA-F]{4}/);
      expect(el.textContent).not.toMatch(/NaN|undefined|null|Infinity/);
      expect(svgAttrs(el).join("\n")).not.toMatch(/NaN|undefined|Infinity/);
    }
  });

  it("every one of the 32 teams renders both radars with seven vertices", () => {
    for (const t of MODEL.teams) {
      const el = section(ready(sliceFor(t.team)), t.team);
      const outlines = el.querySelectorAll("path[data-radar-outline]");
      expect(outlines, t.team).toHaveLength(2);
      outlines.forEach((p) => expect(vertexCount(p.getAttribute("d")!), t.team).toBe(7));
    }
  });
});

describe("TeamRadarSection — missing spokes", () => {
  const nullStuff = ROWS.map((r) => ({ ...r, designed_runs: null, stuffed_runs: null }));

  it("the NULL window: stuff is a gray row of dashes on both tables (NFL average too), six vertices, no '0.0%'", () => {
    const el = section(ready(sliceFor("BUF", nullStuff)));
    for (const side of ["off", "def"] as const) {
      const tr = el.querySelectorAll<HTMLTableRowElement>(`[data-radar-side="${side}"] tbody tr`)[4];
      expect(tr.getAttribute("data-missing")).toBe("true");
      expect(Array.from(tr.querySelectorAll("td")).slice(1).map((td) => td.textContent)).toEqual(["—", "—", "—"]);
      expect(vertexCount(el.querySelector(`[data-radar-side="${side}"] path[data-radar-outline]`)!.getAttribute("d")!)).toBe(6);
    }
  });

  it("a spoke whose pool is smaller than N prints the pool beside the rank", () => {
    const rows = ROWS.map((r) => (r.team_id === "ARI" ? { ...r, designed_runs: null, stuffed_runs: null } : r));
    const el = section(ready(sliceFor("BUF", rows)));
    const off = el.querySelectorAll<HTMLTableRowElement>('[data-radar-side="off"] tbody tr');
    expect(off[4].querySelectorAll("td")[2].textContent).toBe("1st of 31");
    expect(off[0].querySelectorAll("td")[2].textContent).toBe("2nd");
    // the league average for stuff is missing whenever any row in the season is NULL
    expect(off[4].querySelectorAll("td")[3].textContent).toBe("—");
  });

  it("R20: with 3 real spokes a side shows the sentence and its table, no radar; with 4 it draws", () => {
    const s = ready(sliceFor("BUF"));
    const three = section({ ...s, off: without(s.off, ["stuff", "sack", "to", "rush_sr"]) });
    const off3 = three.querySelector('[data-radar-side="off"]')!;
    expect(off3.querySelector("svg")).toBeNull();
    expect(off3.querySelector("[data-radar-table-only]")!.textContent).toBe(
      "Not enough of these rates are available yet to draw the offense radar.",
    );
    expect(off3.querySelectorAll("tbody tr")).toHaveLength(7);
    expect(three.querySelector('[data-radar-side="def"] svg')).not.toBeNull();
    expect(three.querySelector('[data-radar-side="def"] [data-radar-table-only]')).toBeNull();

    const four = section({ ...s, def: without(s.def, ["stuff", "sack", "to"]) });
    expect(four.querySelector('[data-radar-side="def"] svg')).not.toBeNull();
    expect(four.querySelector("[data-radar-table-only]")).toBeNull();

    const defThree = section({ ...s, def: without(s.def, ["stuff", "sack", "to", "rush_sr"]) });
    expect(defThree.querySelector('[data-radar-side="def"] [data-radar-table-only]')!.textContent).toBe(
      "Not enough of these rates are available yet to draw the defense radar.",
    );
  });

  it("a team with 1 game, in a 14-team week: the lead and footnote print 14, never 32", () => {
    const fourteen = ROWS.filter((r) => r.week === 1).slice(0, 14);
    const id = fourteen[0].team_id as string;
    const el = section(ready(sliceFor(id, fourteen)), id);
    expect(el.querySelector("[data-radar-lead]")!.textContent).toMatch(/rank among the 14 teams that have played, through 1 game\.$/);
    expect(el.querySelector("[data-radar-footnotes] p")!.textContent).toContain("among the 14 teams that have played");
    expect(el.textContent).not.toMatch(/all 32 teams/);
  });
});

describe("TeamRadarSection — message states (each renders its exact sentence, and no radar or table)", () => {
  const message = (el: HTMLElement) => el.querySelector("[data-radar-message]")?.textContent;
  const bare = (el: HTMLElement) => {
    expect(el.querySelector("svg")).toBeNull();
    expect(el.querySelector("table")).toBeNull();
    expect(el.querySelector('[id="team-radar"]')).not.toBeNull();
    expect(el.textContent).not.toMatch(/Share/);
  };

  it("unavailable → R13 (the hub keeps rendering)", () => {
    const el = section(sliceFor("BUF", null));
    expect(message(el)).toBe("The team radar is unavailable right now.");
    bare(el);
  });

  it("no-games → R10 with the team and season", () => {
    const eight = ROWS.filter((r) => r.week === 1 && r.team_id !== "KC" && r.opponent_id !== "KC").slice(0, 8);
    const el = section(sliceFor("KC", eight), "KC");
    expect(message(el)).toBe("The Kansas City Chiefs have not played a 2026 game yet. Their radar appears after their first game.");
    bare(el);
  });

  it("small-pool → R11, also for a team that has not played while fewer than 8 have", () => {
    const two = ROWS.filter((r) => r.game_id === "2026_01_BUF_HOU");
    expect(message(section(sliceFor("BUF", two)))).toBe(
      "Team radars start once 8 teams have played this season. Until then there are too few teams to rank against.",
    );
    const kc = section(sliceFor("KC", two), "KC");
    expect(message(kc)).toBe("Team radars start once 8 teams have played this season. Until then there are too few teams to rank against.");
    bare(kc);
  });

  it("uncovered → R12 when the first season is known and later; R12b otherwise", () => {
    const r12 = section(sliceFor("BUF", [], 2025, [2026]));
    expect(message(r12)).toBe("Team radars start with the 2026 season.");
    bare(r12);
    expect(message(section(sliceFor("BUF", [], 2025, [])))).toBe("Team radars are not available for the 2025 season.");
    expect(message(section(sliceFor("BUF", [], 2024, [2026, 2023])))).toBe("Team radars are not available for the 2024 season.");
  });

  it("a season later than the newest → R11", () => {
    expect(message(section(sliceFor("BUF", [], 2027)))).toBe(R.RADAR_SMALL_POOL_NOTE);
  });

  it("the band still names the season being viewed", () => {
    expect(section(sliceFor("BUF", [], 2025)).querySelector("h3")!.textContent).toContain("2025");
  });
});
