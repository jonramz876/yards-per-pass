// Team radar PR 3 (share cards): the pure pieces added to
// lib/stats/team-radar.ts — the URL words, the share copy (spec §8 R2, R8,
// R14, R14b, R16), the hrefs, and the chart geometry the SVG chart and the
// 1200×630 image both draw from.
import { describe, it, expect } from "vitest";
import rowsJson from "./fixtures/team-radar-2026-w1-3.json";
import * as R from "@/lib/stats/team-radar";
import { RADAR_AXES, buildTeamRadar, type RadarSideModel } from "@/lib/stats/team-radar";

type Row = Record<string, unknown>;
const MODEL = buildTeamRadar(rowsJson as Row[]);
const BUF = MODEL.teams.find((t) => t.team === "BUF")!;

function without(side: RadarSideModel, keys: string[]): RadarSideModel {
  return {
    ...side,
    spokes: side.spokes.map((s) => (keys.includes(s.key) ? { ...s, value: null, rank: null, score: null, tied: false, count: null } : s)),
  };
}

describe("the side segment of a share URL", () => {
  it("is exactly offense or defense; anything else is no side", () => {
    expect(R.parseRadarSide("offense")).toBe("off");
    expect(R.parseRadarSide("defense")).toBe("def");
    for (const junk of ["Offense", "DEFENSE", "sideways", "off", "def", "", " offense", "offense ", "offense/", undefined, null, 7]) {
      expect(R.parseRadarSide(junk as string), String(junk)).toBeNull();
    }
    expect(R.radarSideSlug("off")).toBe("offense");
    expect(R.radarSideSlug("def")).toBe("defense");
  });
});

describe("share copy (spec §8)", () => {
  it("R2 card table header: the offense subtitle, and the short defense one", () => {
    expect(R.RADAR_CARD_SUBTITLE).toEqual({ off: "What the offense did", def: "What opponents did" });
  });

  it("R8 card footer prints N, the teams that have played", () => {
    expect(R.radarCardFooter(32)).toBe("Farther out = better rank among the 32 teams · dashed ring = middle of the league");
    expect(R.radarCardFooter(14)).toBe("Farther out = better rank among the 14 teams · dashed ring = middle of the league");
  });

  it("R14 title: the side word comes from the validated side", () => {
    expect(R.radarShareTitle("Buffalo Bills", "off", 2026)).toBe("Buffalo Bills Offense Radar 2026 — Yards Per Pass");
    expect(R.radarShareTitle("Buffalo Bills", "def", 2025)).toBe("Buffalo Bills Defense Radar 2025 — Yards Per Pass");
  });

  it("R14b description, offense and defense, all seven spokes, 32 teams", () => {
    expect(R.radarShareDescription("Buffalo Bills", "off", 3, 32, BUF.off)).toBe(
      "Buffalo Bills offense through Week 3: explosive pass and run rates, pass and run success, sack rate, stuff rate and turnover rate, ranked against every NFL team.",
    );
    expect(R.radarShareDescription("Buffalo Bills", "def", 3, 32, BUF.def)).toBe(
      "Buffalo Bills defense through Week 3: the explosive plays and success rates it allowed, and its sack, stuff and takeaway rates, ranked against every NFL team.",
    );
  });

  it("R14b: 'every NFL team' only when 32 have played", () => {
    expect(R.radarShareDescription("Buffalo Bills", "off", 1, 14, BUF.off)).toMatch(/ranked against the 14 teams that have played\.$/);
    expect(R.radarShareDescription("Buffalo Bills", "def", 1, 31, BUF.def)).toMatch(/ranked against the 31 teams that have played\.$/);
    expect(R.radarShareDescription("Buffalo Bills", "off", 1, 14, BUF.off)).not.toMatch(/every NFL team/);
  });

  it("R14b: a missing spoke is dropped from the list", () => {
    expect(R.radarShareDescription("Buffalo Bills", "off", 3, 32, without(BUF.off, ["stuff"]))).toBe(
      "Buffalo Bills offense through Week 3: explosive pass and run rates, pass and run success, sack rate and turnover rate, ranked against every NFL team.",
    );
    expect(R.radarShareDescription("Buffalo Bills", "off", 3, 32, without(BUF.off, ["expl_rush", "pass_sr", "to"]))).toBe(
      "Buffalo Bills offense through Week 3: explosive pass rate, run success, sack rate and stuff rate, ranked against every NFL team.",
    );
    expect(R.radarShareDescription("Buffalo Bills", "def", 3, 32, without(BUF.def, ["stuff"]))).toBe(
      "Buffalo Bills defense through Week 3: the explosive plays and success rates it allowed, and its sack and takeaway rates, ranked against every NFL team.",
    );
    expect(R.radarShareDescription("Buffalo Bills", "def", 3, 32, without(BUF.def, ["stuff", "to", "expl_pass", "expl_rush"]))).toBe(
      "Buffalo Bills defense through Week 3: the success rates it allowed, and its sack rate, ranked against every NFL team.",
    );
    expect(R.radarShareDescription("Buffalo Bills", "def", 3, 32, without(BUF.def, ["stuff", "to", "sack"]))).toBe(
      "Buffalo Bills defense through Week 3: the explosive plays and success rates it allowed, ranked against every NFL team.",
    );
  });

  it("R14b: no week known, no 'through Week' clause; never prints null, NaN or undefined", () => {
    const text = R.radarShareDescription("Buffalo Bills", "off", null, 32, BUF.off);
    expect(text).toMatch(/^Buffalo Bills offense: explosive pass/);
    for (const w of [null, NaN, undefined]) {
      expect(R.radarShareDescription("Buffalo Bills", "def", w as number | null, 32, BUF.def)).not.toMatch(/null|NaN|undefined/);
    }
  });

  it("R16 buttons and links", () => {
    expect(R.radarShareButtonText("off")).toBe("Share offense radar");
    expect(R.radarShareButtonText("def")).toBe("Share defense radar");
    expect(R.radarOtherSideLinkText("Buffalo Bills", "def")).toBe("See the Buffalo Bills defense radar →");
    expect(R.radarOtherSideLinkText("Buffalo Bills", "off")).toBe("See the Buffalo Bills offense radar →");
    expect(R.radarTeamPageLinkText("Buffalo Bills")).toBe("View the full Buffalo Bills page →");
    expect(R.RADAR_COPY_LINK_TEXT).toBe("Copy Link");
    expect(R.RADAR_COPIED_TEXT).toBe("Copied!");
    expect(R.RADAR_DOWNLOAD_TEXT).toBe("Download Image");
  });

  it("the image route's failed-read sentence", () => {
    expect(R.RADAR_IMAGE_UNAVAILABLE).toBe("Team radar image temporarily unavailable. Try again in a few minutes.");
  });

  it("the card band's right-hand text names the side, the season and the week", () => {
    expect(R.radarCardBandAside("off", 2026, 3)).toBe("Offense Radar · 2026 · Through Week 3");
    expect(R.radarCardBandAside("def", 2025, null)).toBe("Defense Radar · 2025");
  });
});

describe("share hrefs", () => {
  it("the team page link carries a past season and lands on the radar section", () => {
    expect(R.radarTeamPageHref("BUF", 2026, 2026)).toBe("/team/BUF#team-radar");
    expect(R.radarTeamPageHref("BUF", 2025, 2026)).toBe("/team/BUF?season=2025#team-radar");
  });

  it("the image URL always names the season (a file-convention image gets no query, so the page links the route itself)", () => {
    expect(R.radarImageHref("BUF", "off", 2026)).toBe("/api/team-radar/BUF/offense?season=2026");
    expect(R.radarImageHref("BUF", "def", 2025)).toBe("/api/team-radar/BUF/defense?season=2025");
  });

  it("the preview image URL adds the week so each week is a new URL (review M7); the download adds download=1", () => {
    expect(R.radarImageHref("BUF", "off", 2026, { week: 3 })).toBe("/api/team-radar/BUF/offense?season=2026&w=3");
    expect(R.radarImageHref("BUF", "off", 2026, { week: null })).toBe("/api/team-radar/BUF/offense?season=2026");
    expect(R.radarImageHref("BUF", "off", 2026, { week: NaN })).toBe("/api/team-radar/BUF/offense?season=2026");
    expect(R.radarImageHref("BUF", "off", 2026, { download: true })).toBe("/api/team-radar/BUF/offense?season=2026&download=1");
  });

  it("the download's file name", () => {
    expect(R.radarDownloadFilename("BUF", "off", 2026)).toBe("BUF-offense-2026-radar.png");
    expect(R.radarDownloadFilename("PIT", "def", 2025)).toBe("PIT-defense-2025-radar.png");
  });

  it("a file name can never carry a quote, a slash or a line break (it goes into a header)", () => {
    const name = R.radarDownloadFilename('B"U\r\nF/..', "off", 2026);
    expect(name).toBe("BUF-offense-2026-radar.png");
    expect(R.radarDownloadFilename("", "def", 2026)).toBe("team-defense-2026-radar.png");
  });
});

describe("chart geometry (shared by the SVG chart and the share image)", () => {
  it("seven spokes, the first straight up, clockwise", () => {
    expect(R.radarAngle(0)).toBeCloseTo(-Math.PI / 2);
    expect(R.radarAngle(1)).toBeGreaterThan(R.radarAngle(0));
    const g = R.RADAR_SIZES.sm;
    const [x, y] = R.radarPoint(g, g.r, 0);
    expect(x).toBeCloseTo(g.cx);
    expect(y).toBeCloseTo(g.cy - g.r);
  });

  it("the small chart is unchanged from PR 2", () => {
    expect(R.RADAR_SIZES.sm).toEqual({ w: 420, h: 340, cx: 210, cy: 168, r: 104, gap: 12, lh: 13, f: 11, sw: 1, dot: 3 });
  });

  it("a path is closed and has one command per point", () => {
    expect(R.radarPathD([[1, 2], [3.14159, 4], [5, 6]])).toBe("M1.0,2.0 L3.1,4.0 L5.0,6.0Z");
  });

  // PR 2's chaos pass (R7): at `lg` the longest label ran about 4 units past
  // both edges of a 640-unit viewBox. jsdom cannot measure text, so this is the
  // same per-character estimate, made a rule: the worst case has to fit.
  // `sm` shipped in PR 2 and is not changed here: it is held to the estimate
  // PR 2's chaos pass used (0.556 of the font size per character, 5 units to
  // spare). The two new sizes are held to the stricter 0.6.
  it.each([
    ["sm", 0.556],
    ["lg", R.RADAR_LABEL_CHAR_WIDTH],
    ["card", R.RADAR_LABEL_CHAR_WIDTH],
  ] as const)("%s: the longest possible label stays inside the drawing, on every spoke, both sides", (size, perChar) => {
    const g = R.RADAR_SIZES[size];
    const worst = ["100.0% · T-32nd", ...RADAR_AXES.map((a) => a.label), ...RADAR_AXES.map((a) => a.defLabel ?? a.label)];
    RADAR_AXES.forEach((_, i) => {
      const p = R.radarLabelPosition(g, i);
      for (const text of worst) {
        const width = text.length * g.f * perChar;
        const left = p.anchor === "start" ? p.x : p.anchor === "end" ? p.x - width : p.x - width / 2;
        expect(left, `${size} spoke ${i} "${text}" left`).toBeGreaterThanOrEqual(0);
        expect(left + width, `${size} spoke ${i} "${text}" right`).toBeLessThanOrEqual(g.w);
      }
      // first line's top and second line's bottom
      expect(p.y1 - g.f, `${size} spoke ${i} top`).toBeGreaterThanOrEqual(0);
      expect(p.y2 + g.f * 0.3, `${size} spoke ${i} bottom`).toBeLessThanOrEqual(g.h);
    });
  });

  it("the estimate is not flattering: 0.6 of the font size per character", () => {
    expect(R.RADAR_LABEL_CHAR_WIDTH).toBeGreaterThanOrEqual(0.6);
  });

  it("labels sit outside the outer ring, anchored away from the centre", () => {
    const g = R.RADAR_SIZES.lg;
    expect(R.radarLabelPosition(g, 0).anchor).toBe("middle");
    expect(R.radarLabelPosition(g, 1).anchor).toBe("start");
    expect(R.radarLabelPosition(g, 2).anchor).toBe("start");
    expect(R.radarLabelPosition(g, 5).anchor).toBe("end");
    expect(R.radarLabelPosition(g, 6).anchor).toBe("end");
    RADAR_AXES.forEach((_, i) => {
      const p = R.radarLabelPosition(g, i);
      expect(p.y2 - p.y1).toBeCloseTo(g.lh);
    });
  });

  it("a score the chart can plot is finite and inside 0-1; anything else is a missing spoke", () => {
    expect(R.plottableScore({ score: 0.5, value: 0.1 })).toBe(0.5);
    expect(R.plottableScore({ score: 2, value: 0.1 })).toBe(1);
    expect(R.plottableScore({ score: -1, value: 0.1 })).toBe(0);
    expect(R.plottableScore({ score: NaN, value: 0.1 })).toBeNull();
    expect(R.plottableScore({ score: Infinity, value: 0.1 })).toBeNull();
    expect(R.plottableScore({ score: null, value: 0.1 })).toBeNull();
    expect(R.plottableScore({ score: 0.5, value: null })).toBeNull();
  });
});
