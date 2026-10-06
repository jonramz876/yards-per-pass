// lib/og/team-radar-image.tsx — the element tree of the 1200×630 share card
// (team radar spec 2026-10-06 §5, §7; PR 3). @vercel/og cannot render on
// Windows, so nothing here produces a PNG: these tests read the tree Satori
// will be handed, and hold it to Satori's rules (flexbox only, svg <path> /
// <line> / <circle> only, no svg <text>, labels as positioned divs).
import { describe, it, expect, vi } from "vitest";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import rowsJson from "../stats/fixtures/team-radar-2026-w1-3.json";
import { getTeam, NFL_TEAMS } from "@/lib/data/teams";
import * as R from "@/lib/stats/team-radar";
import { RADAR_AXES, teamRadarSlice, type RadarSide, type TeamRadarSlice } from "@/lib/stats/team-radar";
import { textColorForBackground } from "@/lib/stats/formatters";
import {
  RADAR_IMAGE_SANS_FONT_PATH,
  radarImageFonts,
  teamRadarCardImage,
  teamRadarPlateImage,
} from "@/lib/og/team-radar-image";

type Row = Record<string, unknown>;
type Ready = Extract<TeamRadarSlice, { state: "ready" }>;
const ROWS = rowsJson as Row[];

function sliceFor(teamId: string, rows: Row[] = ROWS): Ready {
  const s = teamRadarSlice({ teamId, season: 2026, rows, newestSeason: 2026, covered: [2026] });
  if (s.state !== "ready") throw new Error(s.state);
  return s;
}
const card = (teamId: string, side: RadarSide, slice = sliceFor(teamId)) =>
  teamRadarCardImage({ team: getTeam(teamId)!, side, slice });

/** Every element in the tree (plain JSX only: the image uses no components). */
function walk(node: ReactNode, out: ReactElement<Record<string, unknown>>[] = []): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) node.forEach((n) => walk(n, out));
  else if (isValidElement(node)) {
    const el = node as ReactElement<Record<string, unknown>>;
    expect(typeof el.type, "the image must be plain elements, no components").toBe("string");
    out.push(el);
    walk(el.props.children as ReactNode, out);
  }
  return out;
}
const textOf = (node: ReactNode): string =>
  Array.isArray(node) ? node.map(textOf).join("") : isValidElement(node) ? textOf((node as ReactElement<{ children?: ReactNode }>).props.children) : node == null || typeof node === "boolean" ? "" : String(node);
const byData = (els: ReactElement<Record<string, unknown>>[], key: string) => els.filter((e) => e.props[key] !== undefined);
const style = (e: ReactElement<Record<string, unknown>>) => (e.props.style ?? {}) as Record<string, unknown>;

describe("teamRadarCardImage — Satori's rules", () => {
  const els = walk(card("BUF", "off"));

  it("only div, svg, path, line and circle: no polygon, no svg text, no img, no span", () => {
    expect(Array.from(new Set(els.map((e) => e.type as string))).sort()).toEqual(["circle", "div", "line", "path", "svg"]);
    const html = renderToStaticMarkup(card("BUF", "off"));
    expect(html).not.toMatch(/<text|<tspan|<polygon|<img|<span/);
  });

  it("every div is display:flex (Satori rejects a div with children otherwise)", () => {
    for (const e of els.filter((x) => x.type === "div")) expect(style(e).display, textOf(e).slice(0, 40)).toBe("flex");
  });

  it("no class names, no CSS variables, no grid", () => {
    const html = renderToStaticMarkup(card("BUF", "off"));
    expect(html).not.toMatch(/class=|var\(--|display:\s*grid/);
  });

  it("the root is the full 1200×630 canvas on white", () => {
    expect(style(els[0])).toMatchObject({ width: "100%", height: "100%", display: "flex", flexDirection: "column", backgroundColor: "#ffffff" });
  });

  it("no NaN, undefined, null or Infinity anywhere, for all 32 teams on both sides", () => {
    for (const t of NFL_TEAMS) {
      for (const side of ["off", "def"] as const) {
        const html = renderToStaticMarkup(card(t.id, side));
        expect(html, `${t.id} ${side}`).not.toMatch(/NaN|undefined|null|Infinity/);
        expect(html).not.toMatch(/\\u[0-9a-fA-F]{4}/);
      }
    }
  });
});

describe("teamRadarCardImage — what it prints (BUF offense, real 2026 weeks 1-3)", () => {
  const slice = sliceFor("BUF");
  const els = walk(card("BUF", "off", slice));
  const buf = getTeam("BUF")!;

  it("the band: team name, side, season and week, in the team's colour with readable text, over a secondary-colour rule", () => {
    const band = byData(els, "data-band")[0];
    expect(style(band).backgroundColor).toBe(buf.primaryColor);
    expect(style(band).color).toBe(textColorForBackground(buf.primaryColor));
    expect(style(band).height).toBe(72);
    expect(textOf(byData(els, "data-band-team")[0])).toBe("BUFFALO BILLS");
    expect(textOf(byData(els, "data-band-aside")[0])).toBe("OFFENSE RADAR · 2026 · THROUGH WEEK 3");
    expect(style(byData(els, "data-band-rule")[0])).toMatchObject({ height: 4, backgroundColor: buf.secondaryColor });
  });

  it("seven spoke labels as positioned divs over the svg: the name, then value · rank", () => {
    const labels = byData(els, "data-axis-label");
    expect(labels.map((l) => l.props["data-axis-label"])).toEqual(RADAR_AXES.map((a) => a.key));
    labels.forEach((l, i) => {
      expect(style(l).position).toBe("absolute");
      expect(textOf(byData(walk(l), "data-axis-name")[0])).toBe(RADAR_AXES[i].label);
      expect(textOf(byData(walk(l), "data-axis-value")[0])).toBe(R.fmtRadarPct(slice.off.spokes[i].value));
      expect(textOf(byData(walk(l), "data-axis-rank")[0])).toBe(`· ${R.spokeRankLabel(slice.off.spokes[i])}`);
    });
    expect(textOf(labels[0])).toBe("Explosive pass10.7%· 2nd");
    expect(textOf(labels[6])).toBe("Explosive run20.0%· 1st");
  });

  it("every label box stays inside the 640-wide radar pane", () => {
    for (const l of byData(els, "data-axis-label")) {
      const s = style(l) as { left: number; width: number; top: number };
      expect(s.left).toBeGreaterThanOrEqual(0);
      expect(s.left + s.width).toBeLessThanOrEqual(R.RADAR_SIZES.card.w);
      expect(s.top).toBeGreaterThanOrEqual(0);
      const worst = "100.0% · T-32nd".length * R.RADAR_SIZES.card.f * R.RADAR_LABEL_CHAR_WIDTH;
      expect(s.width).toBeGreaterThanOrEqual(worst);
    }
  });

  it("the table: header, then seven rows of label, value, rank and NFL average", () => {
    expect(byData(els, "data-table-head").map(textOf)).toEqual(["WHAT THE OFFENSE DID", "BUF", "RANK", "NFL AVG"]);
    const rows = byData(els, "data-row");
    expect(rows).toHaveLength(7);
    rows.forEach((row, i) => {
      const cells = walk(row);
      expect(textOf(byData(cells, "data-cell-label")[0])).toBe(RADAR_AXES[i].label);
      expect(textOf(byData(cells, "data-cell-value")[0])).toBe(R.fmtRadarPct(slice.off.spokes[i].value));
      expect(textOf(byData(cells, "data-cell-rank")[0])).toBe(R.rankCellLabel(slice.off.spokes[i], slice.teamsPlayed));
      expect(textOf(byData(cells, "data-cell-avg")[0])).toBe(R.fmtRadarPct(slice.league[RADAR_AXES[i].key]));
    });
    const first = walk(rows[0]);
    expect(["data-cell-value", "data-cell-rank", "data-cell-avg"].map((k) => textOf(byData(first, k)[0]))).toEqual(["10.7%", "2nd", "7.3%"]);
    const stuff = walk(rows[4]);
    expect(["data-cell-value", "data-cell-rank", "data-cell-avg"].map((k) => textOf(byData(stuff, k)[0]))).toEqual(["7.7%", "1st", "17.5%"]);
  });

  it("rank colours follow the page's thirds: green, red, neutral", () => {
    const rows = byData(els, "data-row");
    const tone = (i: number) => style(byData(walk(rows[i]), "data-cell-rank")[0]).color;
    expect(R.rankTone(slice.off.spokes[6].rank, slice.off.spokes[6].pool)).toBe("good");
    expect(tone(6)).toBe("#047857");
    expect(R.rankTone(slice.off.spokes[2].rank, slice.off.spokes[2].pool)).toBe("bad");
    expect(tone(2)).toBe("#b91c1c");
  });

  it("the footer: R8 with N, then the site line", () => {
    expect(textOf(byData(els, "data-footer")[0])).toBe("Farther out = better rank among the 32 teams · dashed ring = middle of the league");
    expect(textOf(byData(els, "data-site")[0])).toBe("YARDSPERPASS.COM · DATA: NFLVERSE");
  });

  it("the defense card: Takeaway rate, the short header, the defense numbers", () => {
    const def = walk(card("BUF", "def", slice));
    expect(textOf(byData(def, "data-band-aside")[0])).toBe("DEFENSE RADAR · 2026 · THROUGH WEEK 3");
    expect(textOf(byData(def, "data-table-head")[0])).toBe("WHAT OPPONENTS DID");
    expect(textOf(byData(walk(byData(def, "data-row")[3]), "data-cell-label")[0])).toBe("Takeaway rate");
    expect(textOf(byData(walk(byData(def, "data-axis-label")[3]), "data-axis-name")[0])).toBe("Takeaway rate");
    expect(textOf(byData(walk(byData(def, "data-row")[0]), "data-cell-value")[0])).toBe(R.fmtRadarPct(slice.def.spokes[0].value));
  });
});

describe("teamRadarCardImage — the radar drawing", () => {
  const g = R.RADAR_SIZES.card;
  const els = walk(card("BUF", "off"));
  const paths = els.filter((e) => e.type === "path");
  const d = (key: string) => String(paths.find((p) => p.props["data-ring"] === key || p.props[key] !== undefined)!.props.d);

  it("three rings (outer, the amber middle of the league, inner), seven axis lines, one outline, seven dots", () => {
    expect(paths.filter((p) => p.props["data-ring"] !== undefined)).toHaveLength(3);
    expect(els.filter((e) => e.type === "line")).toHaveLength(7);
    expect(byData(els, "data-radar-outline")).toHaveLength(1);
    expect(els.filter((e) => e.type === "circle")).toHaveLength(7);
    expect(paths.find((p) => p.props["data-ring"] === "mid")!.props.stroke).toBe("#f59e0b");
  });

  it("the same shape as the page's chart: each dot sits at radarPoint for its score", () => {
    const side = sliceFor("BUF").off;
    const dots = els.filter((e) => e.type === "circle");
    side.spokes.forEach((s, i) => {
      const [x, y] = R.radarPoint(g, g.r * R.radarRadius(R.plottableScore(s)!), i);
      expect(Number(dots[i].props.cx)).toBeCloseTo(x, 1);
      expect(Number(dots[i].props.cy)).toBeCloseTo(y, 1);
    });
    const i = RADAR_AXES.findIndex((a) => a.key === "expl_rush");
    expect(side.spokes[i].rank).toBe(1);
    expect(d("outer")).toContain(`${Number(dots[i].props.cx).toFixed(1)},${Number(dots[i].props.cy).toFixed(1)}`);
  });

  it("the outline is a closed path with one vertex per real spoke", () => {
    const outline = String(byData(els, "data-radar-outline")[0].props.d);
    expect((outline.match(/[ML]/g) ?? []).length).toBe(7);
    expect(outline).toMatch(/Z$/);
  });

  it("stroke colour rule (radarStrokeColor): every team's outline and dots are 3:1 or better on white", () => {
    for (const t of NFL_TEAMS) {
      const tree = walk(card(t.id, "off"));
      const outline = byData(tree, "data-radar-outline")[0];
      const expected = R.radarStrokeColor(t.primaryColor, t.secondaryColor);
      expect(outline.props.stroke, t.id).toBe(expected);
      expect(R.contrastOnWhite(String(outline.props.stroke)), t.id).toBeGreaterThanOrEqual(3);
      expect(new Set(tree.filter((e) => e.type === "circle").map((c) => c.props.fill)), t.id).toEqual(new Set([expected]));
    }
  });

  it("PIT (light gold primary): dark secondary outline, gold fill tint, gold band with dark text; BUF keeps its blue", () => {
    const pit = getTeam("PIT")!;
    const tree = walk(card("PIT", "off"));
    const outline = byData(tree, "data-radar-outline")[0];
    expect(outline.props.stroke).toBe(pit.secondaryColor);
    expect(outline.props.fill).toBe(`${pit.primaryColor}22`);
    const band = byData(tree, "data-band")[0];
    expect(style(band).backgroundColor).toBe(pit.primaryColor);
    expect(style(band).color).toBe("#0f172a");
    const buf = getTeam("BUF")!;
    expect(byData(els, "data-radar-outline")[0].props.stroke).toBe(buf.primaryColor);
    expect(style(byData(els, "data-band")[0]).color).toBe("#ffffff");
  });
});

describe("teamRadarCardImage — missing spokes", () => {
  const nullStuff = ROWS.map((r) => ({ ...r, designed_runs: null, stuffed_runs: null }));

  it("the NULL window: stuff has no dot, a gray label with a dash, and a row of dashes (NFL average too)", () => {
    const els = walk(card("BUF", "off", sliceFor("BUF", nullStuff)));
    expect(els.filter((e) => e.type === "circle")).toHaveLength(6);
    expect((String(byData(els, "data-radar-outline")[0].props.d).match(/[ML]/g) ?? []).length).toBe(6);
    const label = byData(els, "data-axis-label")[4];
    expect(textOf(label)).toBe("Stuff rate—");
    expect(style(byData(walk(label), "data-axis-name")[0]).color).toBe("#cbd5e1");
    const row = walk(byData(els, "data-row")[4]);
    expect(["data-cell-value", "data-cell-rank", "data-cell-avg"].map((k) => textOf(byData(row, k)[0]))).toEqual(["—", "—", "—"]);
    // Unknown is never printed as zero.
    expect(textOf(byData(els, "data-row")[4])).not.toMatch(/0\.0%|NaN/);
    expect(textOf(label)).not.toMatch(/%/);
  });

  it("a smaller pool is printed beside the rank", () => {
    const rows = ROWS.map((r) => (r.team_id === "ARI" ? { ...r, designed_runs: null, stuffed_runs: null } : r));
    const els = walk(card("BUF", "off", sliceFor("BUF", rows)));
    expect(textOf(byData(walk(byData(els, "data-row")[4]), "data-cell-rank")[0])).toBe("1st of 31");
  });

  it("fewer than 4 real spokes: no svg at all, R20 in its place, the table still there", () => {
    const rows = ROWS.map((r) => ({ ...r, rush_plays: 0, designed_runs: 0, total_drives: 0, rush_success_rate: null, attempts: 0, sacks: 0 }));
    const els = walk(card("BUF", "off", sliceFor("BUF", rows)));
    expect(els.filter((e) => e.type === "svg")).toHaveLength(0);
    expect(textOf(byData(els, "data-table-only")[0])).toBe("Not enough of these rates are available yet to draw the offense radar.");
    expect(byData(els, "data-row")).toHaveLength(7);
  });

  it("a tied rank prints T-, and a 14-team week prints 14, never 32", () => {
    const fourteen = ROWS.filter((r) => r.week === 1).slice(0, 14);
    const id = fourteen[0].team_id as string;
    const s = teamRadarSlice({ teamId: id, season: 2026, rows: fourteen, newestSeason: 2026, covered: [2026] });
    if (s.state !== "ready") throw new Error(s.state);
    const els = walk(teamRadarCardImage({ team: getTeam(id)!, side: "off", slice: s }));
    expect(textOf(byData(els, "data-footer")[0])).toContain("among the 14 teams");
    expect(textOf(byData(els, "data-band-aside")[0])).toBe("OFFENSE RADAR · 2026 · THROUGH WEEK 1");
    const tied = { ...sliceFor("BUF") };
    tied.off = { ...tied.off, spokes: tied.off.spokes.map((sp, i) => (i === 3 ? { ...sp, value: 0, rank: 30, tied: true } : sp)) };
    const t = walk(card("BUF", "off", tied));
    expect(textOf(byData(t, "data-axis-label")[3])).toBe("Turnover rate0.0%· T-30th");
  });
});

describe("teamRadarPlateImage — the picture when there is no radar to draw", () => {
  const plate = teamRadarPlateImage({ team: getTeam("KC")!, side: "def", season: 2026, message: "The Kansas City Chiefs have not played a 2026 game yet. Their radar appears after their first game." });
  const els = walk(plate);

  it("names the team, the side and season, and says why, on the team's colour", () => {
    const kc = getTeam("KC")!;
    expect(style(els[0]).backgroundColor).toBe(kc.primaryColor);
    expect(style(els[0]).color).toBe(textColorForBackground(kc.primaryColor));
    expect(textOf(byData(els, "data-plate-team")[0])).toBe("KANSAS CITY CHIEFS");
    expect(textOf(byData(els, "data-plate-side")[0])).toBe("DEFENSE RADAR · 2026");
    expect(textOf(byData(els, "data-plate-message")[0])).toBe(
      "The Kansas City Chiefs have not played a 2026 game yet. Their radar appears after their first game.",
    );
    expect(textOf(byData(els, "data-site")[0])).toBe("YARDSPERPASS.COM · DATA: NFLVERSE");
  });

  it("follows the same Satori rules", () => {
    for (const e of els.filter((x) => x.type === "div")) expect(style(e).display).toBe("flex");
    expect(renderToStaticMarkup(plate)).not.toMatch(/<text|<polygon|class=|NaN|undefined/);
  });
});

describe("fonts: bundled files only, never fetched at request time", () => {
  const src = readFileSync(join(__dirname, "..", "..", "lib", "og", "team-radar-image.tsx"), "utf8");

  it("the module makes no network request for a font", () => {
    expect(src).not.toMatch(/fetch\(/);
    expect(src).not.toMatch(/gstatic|googleapis|https?:\/\//);
  });

  it("the readable font is the Noto Sans file that ships inside next/og, and it is on disk at the path the route reads", () => {
    expect(RADAR_IMAGE_SANS_FONT_PATH.join("/")).toBe("node_modules/next/dist/compiled/@vercel/og/noto-sans-v27-latin-regular.ttf");
    expect(existsSync(join(process.cwd(), ...RADAR_IMAGE_SANS_FONT_PATH))).toBe(true);
    expect(existsSync(join(process.cwd(), "app", "fonts", "PressStart2P-Regular.ttf"))).toBe(true);
  });

  it("loads both fonts by the names the image asks for", async () => {
    const fonts = (await radarImageFonts())!;
    expect(fonts.map((f) => f.name).sort()).toEqual(["PressStart", "RadarSans"]);
    for (const f of fonts) expect(f.data.byteLength).toBeGreaterThan(10_000);
    const used = new Set(Array.from(src.matchAll(/fontFamily:\s*([A-Z_]+)/g)).map((m) => m[1]));
    expect(Array.from(used).sort()).toEqual(["PIXEL", "SANS"]);
  });

  it("a font that cannot be read is logged and left out, not thrown (the image still renders)", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const cwd = vi.spyOn(process, "cwd").mockReturnValue(join(__dirname, "no-such-dir"));
    await expect(radarImageFonts()).resolves.toBeUndefined();
    expect(error).toHaveBeenCalled();
    cwd.mockRestore();
    error.mockRestore();
  });
});
