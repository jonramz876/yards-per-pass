// lib/stats/matchup-card.ts — the matchup share card's pure half (matchup card
// spec 2026-10-11 §4, §6.1, §6.3, §6.4, §7, §9): the image query and hrefs,
// the ONE model the image, the share page and both metadata functions print,
// the layout numbers and every sentence.
//
// The rows are the two frozen week 1-3 fixtures joined by (game_id, team_id),
// as in matchup.test.ts; the MatchupLoad around the model is built by hand (no
// fixture holds a schedule).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import statsRowsJson from "./fixtures/team-game-stats-2026-w1-3.json";
import radarRowsJson from "./fixtures/team-radar-2026-w1-3.json";
import { readFont } from "../og/helpers/font-advance";
import * as C from "@/lib/stats/matchup-card";
import type { MatchupCardLoad, MatchupCardModel, MatchupCardPane } from "@/lib/stats/matchup-card";
import * as M from "@/lib/stats/matchup";
import type { MatchupGame, MatchupModel } from "@/lib/stats/matchup";
import type { MatchupLoad } from "@/lib/data/matchup";
import { matchupCardColours, MATCHUP_RING_AMBER, MATCHUP_RING_GREY } from "@/lib/stats/matchup-colours";
import { matchupCardHref, matchupCardPath, parseMatchupSeason } from "@/lib/stats/matchup-links";
import { parseCompareImageQuery, rawQueryOf } from "@/lib/stats/compare-card";
import {
  RADAR_AXES,
  RADAR_CARD_SITE_LINE,
  RADAR_HUB,
  fmtRadarPct,
  plottableScore,
  radarAngle,
  radarPoint,
  radarRadius,
  spokeRankLabel,
  type RadarSpoke,
} from "@/lib/stats/team-radar";
import { textColorForBackground } from "@/lib/stats/formatters";
import { NFL_TEAMS } from "@/lib/data/teams";
import type { Team } from "@/lib/types";

type Row = Record<string, unknown>;
const RADAR_BY_KEY = new Map((radarRowsJson as Row[]).map((r) => [`${r.game_id}|${r.team_id}`, r]));
const ROWS: Row[] = (statsRowsJson as Row[]).map((r) => ({ ...r, ...RADAR_BY_KEY.get(`${r.game_id}|${r.team_id}`) }));

const DASH = "—";
const team = (id: string): Team => {
  const t = NFL_TEAMS.find((x) => x.id === id);
  if (!t) throw new Error(`no team ${id}`);
  return t;
};
const model = (rows: unknown, awayId = "BUF", homeId = "HOU"): MatchupModel =>
  M.buildMatchup({ rows: rows as Row[], season: 2026, awayId, homeId });

const game = (over: Partial<MatchupGame> = {}): MatchupGame => ({
  game_id: "2026_05_BUF_HOU", season: 2026, game_type: "REG", week: 5,
  gameday: "2026-10-08", weekday: "Thursday", gametime: "20:15",
  home_team: "HOU", away_team: "BUF", home_score: null, away_score: null,
  ...over,
});

/** A whole MatchupLoad, as lib/data/matchup.ts hands it over (the card reads a part of it). */
function load(over: Partial<MatchupLoad> & { rows?: unknown; awayId?: string; homeId?: string } = {}): MatchupLoad {
  const { rows, awayId = "BUF", homeId = "HOU", ...rest } = over;
  return {
    state: "ready",
    model: model(rows ?? ROWS, awayId, homeId),
    season: 2026,
    defaultSeason: 2026,
    isLatestSeason: true,
    swap: false,
    game: game({ away_team: awayId, home_team: homeId }),
    records: { away: { wins: 2, losses: 1, ties: 0 }, home: { wins: 1, losses: 1, ties: 1 } },
    lineup: null,
    playersAvailable: false,
    gamesAvailable: true,
    ...rest,
  } as MatchupLoad;
}
const card = (l: MatchupLoad | MatchupCardLoad = load(), awayId = "BUF", homeId = "HOU"): MatchupCardModel =>
  C.buildMatchupCard({ away: team(awayId), home: team(homeId), load: l });
function asCard(m: MatchupCardModel): Extract<MatchupCardModel, { kind: "card" }> {
  expect(m.kind).toBe("card");
  return m as Extract<MatchupCardModel, { kind: "card" }>;
}
function asPlate(m: MatchupCardModel): Extract<MatchupCardModel, { kind: "plate" }> {
  expect(m.kind).toBe("plate");
  return m as Extract<MatchupCardModel, { kind: "plate" }>;
}
function drawn(p: MatchupCardPane): Extract<MatchupCardPane, { drawn: true }> {
  expect(p.drawn).toBe(true);
  return p as Extract<MatchupCardPane, { drawn: true }>;
}

/** Every number in a value is finite, and nothing is undefined, however deep. */
function assertPlain(value: unknown, path = "model"): void {
  if (typeof value === "number") expect(Number.isFinite(value), path).toBe(true);
  else if (Array.isArray(value)) value.forEach((v, i) => assertPlain(v, `${path}[${i}]`));
  else if (value !== null && typeof value === "object") for (const [k, v] of Object.entries(value)) assertPlain(v, `${path}.${k}`);
  else expect(value === undefined, `${path} is undefined`).toBe(false);
}

/* ─── §4.2 row 3, §4.3: URLs ─── */

describe("matchupCardImageHref / parseMatchupImageQuery (§4.2 row 3, §4.3)", () => {
  it("always carries the season; w only for a week 1-22; download last", () => {
    expect(C.matchupCardImageHref("BUF", "LA", 2026)).toBe("/api/matchup-card/BUF/LA?season=2026");
    expect(C.matchupCardImageHref("BUF", "LA", 2026, {})).toBe("/api/matchup-card/BUF/LA?season=2026");
    expect(C.matchupCardImageHref("BUF", "LA", 2026, { week: 5 })).toBe("/api/matchup-card/BUF/LA?season=2026&w=5");
    expect(C.matchupCardImageHref("BUF", "LA", 2026, { week: 5, download: true })).toBe("/api/matchup-card/BUF/LA?season=2026&w=5&download=1");
    expect(C.matchupCardImageHref("BUF", "LA", 2025, { download: true })).toBe("/api/matchup-card/BUF/LA?season=2025&download=1");
    for (const week of [0, 23, 5.5, NaN, null, undefined, "5" as never]) {
      expect(C.matchupCardImageHref("LA", "BUF", 2026, { week }), String(week)).toBe("/api/matchup-card/LA/BUF?season=2026");
    }
  });

  it("every href the page can print parses back (round trip through rawQueryOf)", () => {
    for (const season of [1999, 2025, 2026, 2100]) {
      for (const week of [null, 1, 9, 10, 18, 22]) {
        for (const download of [false, true]) {
          const href = C.matchupCardImageHref("BUF", "LA", season, { week, download });
          expect(C.parseMatchupImageQuery(rawQueryOf(`https://yardsperpass.com${href}`)), href).toEqual({ season, download });
          expect(C.parseMatchupImageQuery(C.rawQueryOf(href)), href).toEqual({ season, download });
        }
      }
    }
  });

  it("no query at all is the newest season", () => {
    expect(C.parseMatchupImageQuery("")).toEqual({ season: null, download: false });
    expect(C.parseMatchupImageQuery(rawQueryOf("https://yardsperpass.com/api/matchup-card/BUF/LA"))).toEqual({ season: null, download: false });
  });

  it.each([
    ["?season=2026&w=0"], ["?season=2026&w=23"], ["?season=2026&w=05"], ["?season=2026&w=5&w=6"], ["?season=2026&season=2025"],
    ["?w=5&season=2026"], ["?download=1&season=2026"], ["?season=2026&download=1&w=5"], ["?season=2026&x=1"], ["?ball=home"],
    ["?&"], ["?"], ["?season=2026&"], ["?season=1998"], ["?season=2101"], ["?season=02026"], ["?season=2026abc"], ["?season="],
    ["?download=2"], ["?download=true"], ["?season=2026&download=1&download=1"], ["?season=%32026"], ["?W=5"], ["?w=5&"],
  ])("%s is not the one spelling", (raw) => {
    expect(C.parseMatchupImageQuery(raw), raw).toBeNull();
  });

  it("it IS the compare card's parser (spec §4.2 row 3), so a season-less w or download is read as the newest season", () => {
    // The page never prints these two (its hrefs always carry the season); they are spellings
    // canonicalImageQuery can produce, and the compare route accepts them the same way.
    expect(C.parseMatchupImageQuery("?w=5")).toEqual({ season: null, download: false });
    expect(C.parseMatchupImageQuery("?download=1")).toEqual({ season: null, download: true });
    for (const raw of ["", "?season=2026", "?season=2026&w=5&download=1", "?w=5", "?x=1", "?&", "?season=2026&w=23"]) {
      expect(C.parseMatchupImageQuery(raw), raw).toEqual(parseCompareImageQuery(raw));
    }
  });

  it("a value that is not a string is refused, without throwing", () => {
    for (const raw of [null, undefined, 5, {}, ["?season=2026"]]) expect(C.parseMatchupImageQuery(raw as never)).toBeNull();
  });
});

describe("matchupCardDownloadFilename (§4.2 row 10)", () => {
  it("<AWAY>-at-<HOME>-<season>-matchup.png, -vs- when the pair has no game", () => {
    expect(C.matchupCardDownloadFilename("BUF", "LA", 2026, true)).toBe("BUF-at-LA-2026-matchup.png");
    expect(C.matchupCardDownloadFilename("KC", "TB", 2025, false)).toBe("KC-vs-TB-2025-matchup.png");
  });

  it("only letters and digits survive: it goes into a header value", () => {
    const name = C.matchupCardDownloadFilename('B"U\r\nF', "L;A/../x", 2026.9 as number, true);
    expect(name).toMatch(/^[A-Z]{1,3}-at-[A-Z]{1,3}-\d+-matchup\.png$/);
    expect(() => C.matchupCardDownloadFilename(null as never, undefined as never, NaN, true)).not.toThrow();
    expect(C.matchupCardDownloadFilename(null as never, undefined as never, NaN, false)).toMatch(/^[A-Z]+-vs-[A-Z]+-\d+-matchup\.png$/);
  });
});

describe("the share page's href is matchup-links' (re-exported here: one definition)", () => {
  it("is the same function", () => {
    expect(C.matchupCardHref).toBe(matchupCardHref);
    expect(C.matchupCardPath).toBe(matchupCardPath);
    expect(C.matchupCardHref("BUF", "LA", { season: 2025, defaultSeason: 2026 })).toBe("/card/matchup/BUF/LA?season=2025");
    expect(parseMatchupSeason("2025")).toBe(2025);
  });
});

/* ─── F6: the header's sentence moves to lib/stats/matchup.ts ─── */

describe("matchupNoGameText (F6: was a private constant of the header)", () => {
  it("is the header's sentence, unchanged", () => {
    expect(M.matchupNoGameText(2026)).toBe("No 2026 game between these teams");
    expect(M.matchupNoGameText(2025)).toBe("No 2025 game between these teams");
  });

  it("the header imports it and no longer has its own copy", () => {
    const source = readFileSync(join(process.cwd(), "components/matchup/MatchupHeader.tsx"), "utf8");
    expect(source).toContain("matchupNoGameText");
    expect(source).not.toMatch(/between these teams/);
  });
});

/* ─── §9: every sentence ─── */

describe("copy (§9: each K string, literally)", () => {
  it("K1 / K1b: the title, absolute, and the short preview title", () => {
    expect(C.matchupCardTitle("Buffalo Bills", "Los Angeles Rams", 2026, true)).toBe("Buffalo Bills at Los Angeles Rams: Matchup Card 2026 — Yards Per Pass");
    expect(C.matchupCardTitle("Kansas City Chiefs", "Tampa Bay Buccaneers", 2025, false)).toBe(
      "Kansas City Chiefs vs Tampa Bay Buccaneers: Matchup Card 2025 — Yards Per Pass",
    );
    expect(C.matchupCardPreviewTitle("Buffalo Bills", "Los Angeles Rams", true)).toBe("Buffalo Bills at Los Angeles Rams");
    expect(C.matchupCardPreviewTitle("Kansas City Chiefs", "Tampa Bay Buccaneers", false)).toBe("Kansas City Chiefs vs Tampa Bay Buccaneers");
  });

  it("K2: the description; the week clause is dropped when unknown", () => {
    expect(C.matchupCardDescription("BUF", "LA", 5)).toBe(
      "BUF offense over the LA defense and LA offense over the BUF defense, by league rank through Week 5: the rate and the rank for seven stats.",
    );
    expect(C.matchupCardDescription("BUF", "LA", null)).toBe(
      "BUF offense over the LA defense and LA offense over the BUF defense, by league rank: the rate and the rank for seven stats.",
    );
  });

  it("K3: the sub-band line, empty parts dropped", () => {
    expect(C.matchupCardSubLine({ game: game(), season: 2026, throughWeek: 5 })).toBe("Week 5 · Thu Oct 8 · 8:15 PM ET · 2026 through Week 5");
    expect(C.matchupCardSubLine({ game: game({ away_score: 24, home_score: 16 }), season: 2026, throughWeek: 5 })).toBe(
      "Week 5 · Thu Oct 8 · Final: BUF 24, HOU 16 · 2026 through Week 5",
    );
    expect(C.matchupCardSubLine({ game: null, season: 2026, throughWeek: 5 })).toBe("No 2026 game between these teams · 2026 through Week 5");
    expect(C.matchupCardSubLine({ game: null, season: 2025, throughWeek: null })).toBe("No 2025 game between these teams · 2025 season");
    expect(C.matchupCardSubLine({ game: game({ gameday: null, weekday: null, gametime: null }), season: 2026, throughWeek: null })).toBe("Week 5 · 2026 season");
    expect(C.matchupCardSubLine({ game: game({ game_type: "CON", week: 21, gameday: "2027-01-24", weekday: "Sunday", away_score: 38, home_score: 35 }), season: 2026, throughWeek: 18 })).toBe(
      "Conference Championship · Sun Jan 24 · Final: BUF 38, HOU 35 · 2026 through Week 18",
    );
    // a row with nothing usable at all still has the season
    expect(C.matchupCardSubLine({ game: game({ week: NaN, gameday: null, gametime: null }), season: 2026, throughWeek: 3 })).toBe("2026 through Week 3");
  });

  it("K3's season part alone (the plate's sub-band)", () => {
    expect(C.matchupCardSeasonLine(2026, 5)).toBe("2026 through Week 5");
    expect(C.matchupCardSeasonLine(2026, null)).toBe("2026 season");
  });

  it("K4, K5: how to read it, and the legend line with the ring's own word and the real pool", () => {
    expect(C.MATCHUP_CARD_HOW_TO).toBe("Each label: the stat · its league rank · farther out = better rank");
    expect(C.matchupCardLegendLine(32, MATCHUP_RING_AMBER)).toBe(
      "Solid line, round dots = offense. Dashed line, squares = defense. Outer ring = 1st of 32, amber dotted ring = middle of the league.",
    );
    expect(C.matchupCardLegendLine(30, MATCHUP_RING_GREY)).toBe(
      "Solid line, round dots = offense. Dashed line, squares = defense. Outer ring = 1st of 30, grey dotted ring = middle of the league.",
    );
    expect(C.matchupRingWord(MATCHUP_RING_AMBER)).toBe("amber");
    expect(C.matchupRingWord(MATCHUP_RING_GREY)).toBe("grey");
  });

  it("K6, K7: the heading and the image's alt text", () => {
    expect(C.matchupCardHeading("Buffalo Bills", "Los Angeles Rams", 2026, true)).toBe("Buffalo Bills at Los Angeles Rams: matchup card, 2026");
    expect(C.matchupCardHeading("Kansas City Chiefs", "Tampa Bay Buccaneers", 2026, false)).toBe("Kansas City Chiefs vs Tampa Bay Buccaneers: matchup card, 2026");
    expect(C.matchupCardAlt("Buffalo Bills", "Los Angeles Rams", 2026, true)).toBe("Buffalo Bills at Los Angeles Rams matchup card, 2026");
    expect(C.matchupCardAlt("Kansas City Chiefs", "Tampa Bay Buccaneers", 2026, false)).toBe("Kansas City Chiefs vs Tampa Bay Buccaneers matchup card, 2026");
  });

  it("K8: only for a team not in its primary colour", () => {
    expect(C.matchupCardColourNote("Los Angeles Rams", "secondary-darkened")).toBe(
      "Los Angeles Rams are drawn in their second colour on this card so the two teams never share one.",
    );
    expect(C.matchupCardColourNote("Buffalo Bills", "secondary")).toBe(
      "Buffalo Bills are drawn in their second colour on this card so the two teams never share one.",
    );
    expect(C.matchupCardColourNote("Pittsburgh Steelers", "primary-darkened")).toBe(
      "Pittsburgh Steelers are drawn in a darker shade of their colour on this card so the two teams never share one.",
    );
    expect(C.matchupCardColourNote("Buffalo Bills", "primary")).toBeNull();
    // the neutrals belong to no team and no real pair uses them: nothing to say
    expect(C.matchupCardColourNote("Buffalo Bills", "grey")).toBeNull();
    expect(C.matchupCardColourNote("Buffalo Bills", "ink")).toBeNull();
  });

  it("K9, K10, K11, K14, K15, K16 and the site name", () => {
    expect(C.MATCHUP_CARD_FULL_LINK_TEXT).toBe("See the full matchup →");
    expect(C.matchupCardTeamLinkText("Buffalo Bills")).toBe("Buffalo Bills team page →");
    expect(C.MATCHUP_CARD_NOT_FOUND_TITLE).toBe("Matchup Card Not Found — Yards Per Pass");
    expect(C.MATCHUP_CARD_UNAVAILABLE).toBe("The matchup card is unavailable right now. Try again in a few minutes.");
    expect(C.MATCHUP_CARD_IMAGE_UNAVAILABLE).toBe("Matchup card image temporarily unavailable. Try again in a few minutes.");
    expect(C.matchupCardLegendWords("BUF", "LA")).toEqual({ off: "BUF offense", over: "over", def: "LA defense" });
    expect(C.matchupCardPaneCaption("BUF", "LA")).toBe("BUF offense over LA defense");
    expect(C.MATCHUP_CARD_SEAM_AT).toBe("AT");
    expect(C.MATCHUP_CARD_SEAM_VS).toBe("VS");
    expect(C.MATCHUP_CARD_SITE_NAME).toBe("YARDSPERPASS.COM");
  });

  it("K12 is matchup-links' (the Share block's client file imports it from there)", () => {
    expect(C.MATCHUP_SHARE_HEADING).toBe("Share this matchup");
    expect(C.MATCHUP_OPEN_CARD_TEXT).toBe("Open share card →");
  });
});

/* ─── §6.3: the layout numbers ─── */

describe("MATCHUP_CARD_LAYOUT (§6.3)", () => {
  const L = C.MATCHUP_CARD_LAYOUT;

  it("five blocks that sum to 630, on a 1200 wide card", () => {
    expect([L.band, L.rule, L.subBand, L.body, L.footer]).toEqual([76, 5, 32, 397, 120]);
    expect(L.band + L.rule + L.subBand + L.body + L.footer).toBe(L.height);
    expect(L.height).toBe(630);
    expect(L.width).toBe(1200);
  });

  it("the keep-clear line is 510: band + rule + sub-band + body", () => {
    expect(C.MATCHUP_CARD_KEEP_CLEAR_Y).toBe(510);
    expect(C.MATCHUP_CARD_KEEP_CLEAR_Y).toBe(L.band + L.rule + L.subBand + L.body);
  });

  it("two panes and a divider fill the width; a pane is a legend row over the radar", () => {
    expect(L.pane.width * 2 + L.divider).toBe(L.width);
    expect(L.pane.legend + L.pane.radar).toBe(L.body);
    expect([L.pane.width, L.pane.legend, L.pane.radar, L.divider]).toEqual([599, 34, 363, 2]);
    expect(C.MATCHUP_CARD_PANE_TOP).toBe(L.band + L.rule + L.subBand + L.pane.legend);
    expect(C.MATCHUP_CARD_PANE_TOP).toBe(147);
  });

  it("a label is a fixed 60 px column of three rows: 18 / 21 / 21", () => {
    expect(L.label.rows).toEqual([18, 21, 21]);
    expect(L.label.rows.reduce((a, b) => a + b, 0)).toBe(L.label.height);
    expect(L.label.height).toBe(60);
    expect([L.label.nameSize, L.label.statSize, L.label.mark, L.label.markGap, L.label.topWidth]).toEqual([14, 17, 11, 6, 180]);
  });

  it("the band, the seam box and the sub-band", () => {
    expect([L.half, L.padX, L.nameBox.width, L.nameBox.height]).toEqual([600, 40, 520, 32]);
    expect(L.half * 2).toBe(L.width);
    expect(L.seam).toEqual({ left: 568, top: 11, width: 64, height: 54 });
    expect(L.seam.left + L.seam.width / 2).toBe(L.width / 2);
    expect([L.subLineMaxWidth, L.subLineMaxWidthAlone, L.plateMessageWidth, L.paneMessageWidth]).toEqual([512, 900, 900, 460]);
    // at their caps the three sub-band items still cannot meet: 512 + K4's 432 + the site name's 160 = 1,104 of 1,120
    expect(L.subLineMaxWidth + 432 + 160).toBeLessThanOrEqual(L.width - 2 * L.padX);
  });

  it("the markers as drawn (chaos F3: the clearance test below stands on these)", () => {
    expect(L.marker).toEqual({ dot: 6, dotStroke: 1.3, square: 5.5, squareStroke: 2.6 });
    expect(L.marker.dot).toBe(C.MATCHUP_CARD_RADAR.dot);
  });

  it("the radar geometry", () => {
    expect(C.MATCHUP_CARD_RADAR).toEqual({ w: 599, h: 363, cx: 300, cy: 189, r: 116, gap: 10, lh: 21, f: 17, sw: 1.5, dot: 6 });
    expect(C.MATCHUP_CARD_RADAR.w).toBe(L.pane.width);
    expect(C.MATCHUP_CARD_RADAR.h).toBe(L.pane.radar);
  });

  it("band name size: 24 up to 16 characters, 20 up to 26, 16 beyond", () => {
    expect(C.matchupBandNameSize("x".repeat(16))).toBe(24);
    expect(C.matchupBandNameSize("x".repeat(17))).toBe(20);
    expect(C.matchupBandNameSize("x".repeat(26))).toBe(20);
    expect(C.matchupBandNameSize("x".repeat(27))).toBe(16);
    expect(C.matchupBandNameSize("")).toBe(24);
    expect(C.matchupBandNameSize("CLEVELAND BROWNS")).toBe(24);
    expect(C.matchupBandNameSize("WASHINGTON COMMANDERS")).toBe(20);
  });
});

/* ─── §6.4: the seven label boxes ─── */

type Box = { left: number; top: number; width: number; height: number; align: "start" | "center" | "end" };
type Pt = readonly [number, number];

function segmentDistance(p1: Pt, p2: Pt, p3: Pt, p4: Pt): number {
  const pointSeg = (p: Pt, a: Pt, b: Pt) => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = dx * dx + dy * dy;
    const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len));
    return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
  };
  const cross = (a: Pt, b: Pt, c: Pt) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const d1 = cross(p3, p4, p1);
  const d2 = cross(p3, p4, p2);
  const d3 = cross(p1, p2, p3);
  const d4 = cross(p1, p2, p4);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return 0;
  return Math.min(pointSeg(p1, p3, p4), pointSeg(p2, p3, p4), pointSeg(p3, p1, p2), pointSeg(p4, p1, p2));
}
/** Inside a convex polygon (or on its edge). */
function inPolygon(p: Pt, poly: Pt[]): boolean {
  let sign = 0;
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const c = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    if (c === 0) continue;
    if (sign === 0) sign = Math.sign(c);
    else if (Math.sign(c) !== sign) return false;
  }
  return true;
}
const corners = (b: Box): Pt[] => [[b.left, b.top], [b.left + b.width, b.top], [b.left + b.width, b.top + b.height], [b.left, b.top + b.height]];
const overlap = (a: Box, b: Box) =>
  a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;

describe("the seven label boxes (§6.4: pinned; the keep-clear margin is half a pixel)", () => {
  const G = C.MATCHUP_CARD_RADAR;
  const L = C.MATCHUP_CARD_LAYOUT;
  const BOXES: Box[] = RADAR_AXES.map((_, i) => C.matchupCardLabelBox(i));
  const RING: Pt[] = RADAR_AXES.map((_, i) => radarPoint(G, G.r, i));

  // i, left, width, top, bottom, align, bottom on the card
  const TABLE: [number, number, number, number, number, Box["align"], number][] = [
    [0, 210.0, 180.0, 3.0, 63.0, "center", 210.0],
    [1, 398.5, 200.5, 50.4, 110.4, "start", 257.4],
    [2, 422.8, 176.2, 187.0, 247.0, "start", 394.0],
    [3, 354.7, 244.3, 302.5, 362.5, "start", 509.5],
    [4, 0.0, 245.3, 302.5, 362.5, "end", 509.5],
    [5, 0.0, 177.2, 187.0, 247.0, "end", 394.0],
    [6, 0.0, 201.5, 50.4, 110.4, "end", 257.4],
  ];

  it.each(TABLE)("spoke %i: left %f, width %f, top %f, bottom %f, %s", (i, left, width, top, bottom, align, cardBottom) => {
    const b = BOXES[i];
    expect(Math.abs(b.left - left)).toBeLessThan(0.1);
    expect(Math.abs(b.width - width)).toBeLessThan(0.1);
    expect(Math.abs(b.top - top)).toBeLessThan(0.1);
    expect(Math.abs(b.top + b.height - bottom)).toBeLessThan(0.1);
    expect(b.height).toBe(60);
    expect(b.align).toBe(align);
    expect(Math.abs(C.MATCHUP_CARD_PANE_TOP + b.top + b.height - cardBottom)).toBeLessThan(0.1);
  });

  it("the exported table is the function's", () => {
    expect(C.MATCHUP_CARD_LABEL_BOXES).toEqual(BOXES);
    expect(C.MATCHUP_CARD_LABEL_BOXES).toHaveLength(7);
  });

  it("each box is anchored on its spoke's point at r + gap from the centre", () => {
    BOXES.forEach((b, i) => {
      const [x, y] = radarPoint(G, G.r + G.gap, i);
      const cos = Math.cos(radarAngle(i));
      if (cos > 0.3) expect(b.left).toBeCloseTo(x, 9);
      else if (cos < -0.3) expect(b.left + b.width).toBeCloseTo(x, 9);
      else expect(b.left + b.width / 2).toBeCloseTo(x, 9);
      expect(y).toBeGreaterThanOrEqual(b.top - 1e-9);
      expect(y).toBeLessThanOrEqual(b.top + b.height + 1e-9);
    });
  });

  it("no two boxes of a pane intersect; the top box clears its neighbours by 8.5 px", () => {
    for (let i = 0; i < 7; i += 1) for (let j = i + 1; j < 7; j += 1) expect(overlap(BOXES[i], BOXES[j]), `${i} / ${j}`).toBe(false);
    expect(BOXES[1].left - (BOXES[0].left + BOXES[0].width)).toBeCloseTo(8.5, 1);
    expect(BOXES[0].left - (BOXES[6].left + BOXES[6].width)).toBeCloseTo(8.5, 1);
  });

  it("pane 0's boxes never meet pane 1's (601 px to the right)", () => {
    const offset = L.pane.width + L.divider;
    expect(offset).toBe(601);
    for (const a of BOXES) for (const b of BOXES) expect(overlap(a, { ...b, left: b.left + offset })).toBe(false);
  });

  it("every box is inside its pane", () => {
    for (const b of BOXES) {
      expect(b.left).toBeGreaterThanOrEqual(0);
      expect(b.top).toBeGreaterThanOrEqual(0);
      expect(b.left + b.width).toBeLessThanOrEqual(G.w + 1e-9);
      expect(b.top + b.height).toBeLessThanOrEqual(G.h + 1e-9);
    }
  });

  it("no box touches the outer ring: no corner inside it, no ring point inside a box, no edge crossing, 9 px clear", () => {
    let nearest = Infinity;
    BOXES.forEach((b, i) => {
      const cs = corners(b);
      for (const c of cs) expect(inPolygon(c, RING), `box ${i} corner in the ring`).toBe(false);
      for (const p of RING) {
        expect(p[0] > b.left && p[0] < b.left + b.width && p[1] > b.top && p[1] < b.top + b.height, `ring point in box ${i}`).toBe(false);
      }
      let d = Infinity;
      for (let e = 0; e < 4; e += 1) {
        for (let k = 0; k < RING.length; k += 1) {
          d = Math.min(d, segmentDistance(cs[e], cs[(e + 1) % 4], RING[k], RING[(k + 1) % RING.length]));
        }
      }
      expect(d, `box ${i}`).toBeGreaterThanOrEqual(9);
      nearest = Math.min(nearest, d);
    });
    // the Sacks and Run success boxes, level with their ring points: (r + gap − r) × cos = 9.75
    expect(nearest).toBeGreaterThan(9.7);
    expect(nearest).toBeLessThan(9.8);
  });

  it("every box's bottom on the card is at or above the keep-clear line; the lowest is half a pixel above", () => {
    const bottoms = BOXES.map((b) => C.MATCHUP_CARD_PANE_TOP + b.top + b.height);
    for (const y of bottoms) expect(y).toBeLessThanOrEqual(C.MATCHUP_CARD_KEEP_CLEAR_Y);
    expect(C.MATCHUP_CARD_KEEP_CLEAR_Y - Math.max(...bottoms)).toBeCloseTo(0.5, 1);
  });
});

/* ─── §6.1: the model ─── */

describe("buildMatchupCard: the card (§6.1)", () => {
  const LOAD = load();
  const CARD = asCard(card(LOAD));
  const MODEL = LOAD.model as MatchupModel;
  const G = C.MATCHUP_CARD_RADAR;
  const line = (s: Pick<RadarSpoke, "value" | "rank" | "tied">) =>
    s.value === null || s.rank === null ? DASH : `${fmtRadarPct(s.value)} · ${spokeRankLabel(s)}`;

  it("is plain data: no NaN, no undefined, and the same on every call", () => {
    assertPlain(CARD);
    expect(card(LOAD)).toEqual(CARD);
    expect(JSON.parse(JSON.stringify(CARD))).toEqual(CARD);
  });

  it("season, week and game facts", () => {
    expect(CARD.season).toBe(2026);
    expect(CARD.defaultSeason).toBe(2026);
    expect(CARD.throughWeek).toBe(3);
    expect(CARD.hasGame).toBe(true);
  });

  it("the colours are the colour rule's, and a team's colour is the same in both panes", () => {
    expect(CARD.colours).toEqual(matchupCardColours(team("BUF"), team("HOU")));
    const [p0, p1] = CARD.panes;
    expect(p0.offColor).toBe(CARD.colours.away);
    expect(p1.defColor).toBe(CARD.colours.away);
    expect(p0.defColor).toBe(CARD.colours.home);
    expect(p1.offColor).toBe(CARD.colours.home);
  });

  it("pane 0 is the away team's ball, pane 1 the home team's", () => {
    expect([CARD.panes[0].offId, CARD.panes[0].defId]).toEqual(["BUF", "HOU"]);
    expect([CARD.panes[1].offId, CARD.panes[1].defId]).toEqual(["HOU", "BUF"]);
  });

  it("the band: upper-cased names, their size, the card colours, readable text, the rule, the record", () => {
    expect(CARD.band.away).toEqual({
      id: "BUF", name: "BUFFALO BILLS", nameSize: 24, color: CARD.colours.away,
      textColor: textColorForBackground(CARD.colours.away).toUpperCase(), ruleColor: CARD.colours.awayRule, meta: "2-1 · away",
    });
    expect(CARD.band.home).toEqual({
      id: "HOU", name: "HOUSTON TEXANS", nameSize: 24, color: CARD.colours.home,
      textColor: textColorForBackground(CARD.colours.home).toUpperCase(), ruleColor: CARD.colours.homeRule, meta: "1-1-1 · home",
    });
    expect(CARD.band.seam).toBe("AT");
  });

  it("every colour in the model is upper-case #RRGGBB, the band text too (review nit 9); band text is ink on a light card colour", () => {
    const seen = new Set<string>();
    for (const a of NFL_TEAMS) {
      const h = a.id === "BUF" ? "HOU" : "BUF";
      for (const [x, y] of [[a.id, h], [h, a.id]]) {
        const c = asCard(card(load({ awayId: x, homeId: y }), x, y));
        for (const half of [c.band.away, c.band.home]) {
          for (const hex of [half.color, half.textColor, half.ruleColor]) expect(hex, `${x} at ${y}`).toMatch(/^#[0-9A-F]{6}$/);
          expect(["#FFFFFF", "#0F172A"]).toContain(half.textColor);
          seen.add(half.textColor);
        }
        for (const p of c.panes) for (const hex of [p.offColor, p.defColor]) expect(hex).toMatch(/^#[0-9A-F]{6}$/);
      }
    }
    // chaos F12: not always white
    expect(Array.from(seen).sort()).toEqual(["#0F172A", "#FFFFFF"]);
  });

  it("seven labels per pane in RADAR_AXES order, named as the overlay names them, at the pinned boxes", () => {
    for (const pane of CARD.panes) {
      const p = drawn(pane);
      expect(p.labels.map((l) => l.key)).toEqual(RADAR_AXES.map((a) => a.key));
      expect(p.labels.map((l) => l.name)).toEqual(["Explosive pass", "Pass success", "Sacks", "Turnovers", "Stuffs", "Run success", "Explosive run"]);
      expect(p.labels.map((l) => l.box)).toEqual(C.MATCHUP_CARD_LABEL_BOXES);
    }
  });

  it("every label line is fmtRadarPct + spokeRankLabel of the model's own spoke", () => {
    const sides = [MODEL.awayBall!.overlay, MODEL.homeBall!.overlay];
    CARD.panes.forEach((pane, n) => {
      const p = drawn(pane);
      p.labels.forEach((l, i) => {
        expect(l.offLine, `pane ${n} ${l.key} off`).toBe(line(sides[n].off!.spokes[i]));
        expect(l.defLine, `pane ${n} ${l.key} def`).toBe(line(sides[n].def!.spokes[i]));
        expect(l.offLine).toMatch(/^\d{1,3}\.\d% · (T-)?\d{1,2}(st|nd|rd|th)$/);
        expect(l.defLine).toMatch(/^\d{1,3}\.\d% · (T-)?\d{1,2}(st|nd|rd|th)$/);
      });
    });
  });

  it("vertices are radarPoint(G, r × radarRadius(plottableScore), i), one per plottable spoke", () => {
    const sides = [MODEL.awayBall!.overlay, MODEL.homeBall!.overlay];
    CARD.panes.forEach((pane, n) => {
      const p = drawn(pane);
      for (const [unit, spokes] of [[p.off, sides[n].off!.spokes], [p.def, sides[n].def!.spokes]] as const) {
        expect(unit).toHaveLength(7);
        unit.forEach((v) => {
          const i = RADAR_AXES.findIndex((a) => a.key === v.key);
          const [x, y] = radarPoint(G, G.r * radarRadius(plottableScore(spokes[i]) as number), i);
          expect(v.x).toBe(x);
          expect(v.y).toBe(y);
          // between the hub ring and the outer ring
          const d = Math.hypot(v.x - G.cx, v.y - G.cy);
          expect(d).toBeGreaterThanOrEqual(G.r * RADAR_HUB - 1e-9);
          expect(d).toBeLessThanOrEqual(G.r + 1e-9);
        });
      }
    });
  });

  it("the radius comes from the spoke's own pool, not from 32 (F7)", () => {
    const spoke = MODEL.awayBall!.overlay.off!.spokes[0];
    const [x, y] = radarPoint(G, G.r * radarRadius((spoke.pool - (spoke.rank as number)) / (spoke.pool - 1)), 0);
    const v = drawn(CARD.panes[0]).off[0];
    expect(v.x).toBeCloseTo(x, 9);
    expect(v.y).toBeCloseTo(y, 9);
  });

  it("K3, K4, K5 and the page's strings, from the same model", () => {
    expect(CARD.subLine).toBe("Week 5 · Thu Oct 8 · 8:15 PM ET · 2026 through Week 3");
    expect(CARD.showHowTo).toBe(true);
    expect(CARD.legendLine).toBe(C.matchupCardLegendLine(MODEL.teamsPlayed, CARD.colours.ring));
    expect(CARD.legendLine).toContain(`1st of ${MODEL.teamsPlayed},`);
    expect(CARD.title).toBe("Buffalo Bills at Houston Texans: Matchup Card 2026 — Yards Per Pass");
    expect(CARD.previewTitle).toBe("Buffalo Bills at Houston Texans");
    expect(CARD.description).toBe(C.matchupCardDescription("BUF", "HOU", 3));
    expect(CARD.alt).toBe("Buffalo Bills at Houston Texans matchup card, 2026");
  });

  it("a played game prints its final score as the page header does (F5)", () => {
    const played = asCard(card(load({ game: game({ away_score: 24, home_score: 16 }) })));
    expect(played.subLine).toBe(`Week 5 · ${M.formatKickoff(game({ away_score: 24, home_score: 16 }))} · 2026 through Week 3`);
    expect(played.subLine).toContain("Final: BUF 24, HOU 16");
    expect(played.showHowTo).toBe(true);
  });

  it("a playoff game drops K4 (the left line would not fit beside it)", () => {
    const playoff = asCard(card(load({ game: game({ game_type: "CON", week: 21 }) })));
    expect(playoff.showHowTo).toBe(false);
    expect(playoff.subLine.startsWith("Conference Championship · ")).toBe(true);
    // a blank or lower-case type reads REG, through the one normaliser
    expect(asCard(card(load({ game: game({ game_type: "" }) }))).showHowTo).toBe(true);
    expect(asCard(card(load({ game: game({ game_type: " wc " }) }))).showHowTo).toBe(false);
  });

  it("a pair with no game: VS, no venue beside the record, the no-game sentence, K4 kept, 'vs' in every title", () => {
    const c = asCard(card(load({ game: null })));
    expect(c.hasGame).toBe(false);
    expect(c.band.seam).toBe("VS");
    expect(c.band.away.meta).toBe("2-1");
    expect(c.band.home.meta).toBe("1-1-1");
    expect(c.subLine).toBe("No 2026 game between these teams · 2026 through Week 3");
    expect(c.showHowTo).toBe(true);
    expect(c.title).toBe("Buffalo Bills vs Houston Texans: Matchup Card 2026 — Yards Per Pass");
    expect(c.previewTitle).toBe("Buffalo Bills vs Houston Texans");
    expect(c.alt).toBe("Buffalo Bills vs Houston Texans matchup card, 2026");
  });

  it("a past season is carried as it is", () => {
    const c = asCard(card(load({ season: 2026, defaultSeason: 2027, isLatestSeason: false })));
    expect(c.season).toBe(2026);
    expect(c.defaultSeason).toBe(2027);
  });

  it("a week outside 1-22 prints no week and sends none", () => {
    const l = load();
    const c = asCard(card({ ...l, model: { ...(l.model as MatchupModel), throughWeek: 23 } } as MatchupLoad));
    expect(c.throughWeek).toBeNull();
    expect(c.subLine).toBe("Week 5 · Thu Oct 8 · 8:15 PM ET · 2026 season");
    expect(c.description).toBe(C.matchupCardDescription("BUF", "HOU", null));
  });

  it("the band uses the card colours, not the primaries, when a team is not in its primary (BUF at LA)", () => {
    const c = asCard(card(load({ awayId: "BUF", homeId: "LA" }), "BUF", "LA"));
    expect(c.colours.home).toBe("#CC8200");
    expect(c.band.home.color).toBe("#CC8200");
    expect(c.band.home.ruleColor).toBe("#003594");
    expect(c.band.home.name).toBe("LOS ANGELES RAMS");
    expect(c.legendLine).toContain("grey dotted ring");
    expect(c.panes[0].defColor).toBe("#CC8200");
  });

  it("a tied rank prints T-, somewhere in the fixture, and always as the model's own spoke says", () => {
    let tied = 0;
    for (const t of NFL_TEAMS.filter((x) => x.id !== "BUF")) {
      const l = load({ awayId: t.id, homeId: "BUF" });
      const c = asCard(card(l, t.id, "BUF"));
      const overlay = (l.model as MatchupModel).awayBall!.overlay;
      drawn(c.panes[0]).labels.forEach((label, i) => {
        expect(label.offLine).toBe(line(overlay.off!.spokes[i]));
        if (overlay.off!.spokes[i].tied) {
          expect(label.offLine).toMatch(/ · T-\d/);
          tied += 1;
        } else {
          expect(label.offLine).not.toContain("T-");
        }
      });
    }
    expect(tied).toBeGreaterThan(0);
  });

  it("every team's upper-cased name gets a size, for all 32", () => {
    for (const t of NFL_TEAMS) {
      const other = t.id === "BUF" ? "HOU" : "BUF";
      const c = asCard(card(load({ awayId: t.id, homeId: other }), t.id, other));
      expect(c.band.away.name).toBe(t.name.toUpperCase());
      expect(c.band.away.nameSize).toBe(C.matchupBandNameSize(t.name.toUpperCase()));
      expect(c.band.away.id).toBe(t.id);
    }
  });
});

describe("buildMatchupCard: missing spokes and panes that cannot be drawn (§6.1, §6.5, §7)", () => {
  it("a spoke with no value has no vertex and a dash line; the outline bridges it", () => {
    const rows = ROWS.map((r) => (r.team_id === "BUF" ? { ...r, designed_runs: null, total_drives: 0 } : r));
    const l = load({ rows });
    const c = asCard(card(l));
    const p = drawn(c.panes[0]);
    const off = (l.model as MatchupModel).awayBall!.overlay.off!;
    expect(p.off.map((v) => v.key)).toEqual(["expl_pass", "pass_sr", "sack", "rush_sr", "expl_rush"]);
    expect(p.labels.find((x) => x.key === "to")!.offLine).toBe(DASH);
    expect(p.labels.find((x) => x.key === "stuff")!.offLine).toBe(DASH);
    expect(p.labels.find((x) => x.key === "sack")!.offLine).not.toBe(DASH);
    p.labels.forEach((label, i) => {
      const has = plottableScore(off.spokes[i]) !== null;
      expect(p.off.some((v) => v.key === label.key), label.key).toBe(has);
      expect(label.offLine === DASH, label.key).toBe(!has);
    });
    for (const v of p.off) expect(Number.isFinite(v.x) && Number.isFinite(v.y)).toBe(true);
    assertPlain(c);
  });

  it("one pane undrawn: that pane carries its sentence, the other still draws, and it is still a card", () => {
    const three = ROWS.map((r) => (r.team_id === "BUF" ? { ...r, pass_plays: 0, attempts: 0, sacks: 0, total_drives: 0 } : r));
    const l = load({ rows: three });
    expect((l.model as MatchupModel).awayBall!.overlay.drawn).toBe(false);
    expect((l.model as MatchupModel).homeBall!.overlay.drawn).toBe(true);
    const c = asCard(card(l));
    expect(c.panes[0]).toEqual({
      drawn: false, offId: "BUF", defId: "HOU", offColor: c.colours.away, defColor: c.colours.home, message: M.MATCHUP_NO_OVERLAY_NOTE,
    });
    expect(drawn(c.panes[1]).labels).toHaveLength(7);
    assertPlain(c);
  });

  it("neither pane drawn: a plate with the overlay sentence", () => {
    const rows = ROWS.map((r) => (r.team_id === "BUF" || r.team_id === "HOU" ? { ...r, pass_plays: 0, attempts: 0, sacks: 0, total_drives: 0 } : r));
    const p = asPlate(card(load({ rows })));
    expect(p.message).toBe(M.MATCHUP_NO_OVERLAY_NOTE);
    expect(p.description).toBe(M.MATCHUP_NO_OVERLAY_NOTE);
  });

  it("a team with no games: a plate with that team's sentence (the away team's first when both)", () => {
    const noBuf = ROWS.filter((r) => r.team_id !== "BUF" && r.opponent_id !== "BUF");
    const a = asPlate(card(load({ rows: noBuf })));
    expect(a.message).toBe("The Buffalo Bills have not played a 2026 game yet.");
    const noHou = ROWS.filter((r) => r.team_id !== "HOU" && r.opponent_id !== "HOU");
    expect(asPlate(card(load({ rows: noHou }))).message).toBe("The Houston Texans have not played a 2026 game yet.");
    const neither = ROWS.filter((r) => !["BUF", "HOU"].includes(r.team_id as string) && !["BUF", "HOU"].includes(r.opponent_id as string));
    expect(asPlate(card(load({ rows: neither }))).message).toBe("The Buffalo Bills have not played a 2026 game yet.");
  });

  it("small-pool: a plate with the page's own sentence", () => {
    const few = ROWS.filter((r) => ["2026_01_BUF_HOU"].includes(r.game_id as string));
    const l = load({ rows: few });
    expect((l.model as MatchupModel).state).toBe("small-pool");
    const p = asPlate(card({ ...l, state: "small-pool" } as MatchupLoad));
    expect(p.message).toBe(M.MATCHUP_SMALL_POOL_NOTE);
    expect(p.throughWeek).toBe(1);
  });

  it("uncovered: a plate with the page's heading; the model is null, so no week", () => {
    const base = load();
    const uncovered = { ...base, state: "uncovered", model: null, firstSeason: 2026, season: 2025 } as MatchupLoad;
    const p = asPlate(card(uncovered));
    expect(p.message).toBe("Team matchups start with the 2026 season");
    expect(p.throughWeek).toBeNull();
    expect(p.season).toBe(2025);
    const unknown = asPlate(card({ ...uncovered, firstSeason: null } as MatchupLoad));
    expect(unknown.message).toBe(M.matchupUncoveredHeading(2025, null));
    expect(unknown.message).toBe("Team matchups aren’t available for the 2025 season");
  });

  it("handed a load whose games could not be read: a plate saying K11 (callers check first)", () => {
    const p = asPlate(card(load({ gamesAvailable: false, game: null, records: null })));
    expect(p.message).toBe(C.MATCHUP_CARD_UNAVAILABLE);
    expect(p.band.away.meta).toBe("");
    expect(p.band.home.meta).toBe("");
  });

  it("a plate keeps the band, the colours and the page's strings", () => {
    const few = ROWS.filter((r) => r.game_id === "2026_01_BUF_HOU");
    const p = asPlate(card({ ...load({ rows: few }), state: "small-pool" } as MatchupLoad));
    const c = asCard(card());
    expect(p.colours).toEqual(c.colours);
    expect(p.band).toEqual(c.band);
    expect(p.hasGame).toBe(true);
    expect(p.title).toBe(c.title);
    expect(p.previewTitle).toBe(c.previewTitle);
    expect(p.alt).toBe(c.alt);
    expect(p.description).toBe(p.message);
    expect(Object.keys(p).sort()).toEqual(
      ["alt", "band", "colours", "defaultSeason", "description", "hasGame", "kind", "message", "previewTitle", "reason", "season", "throughWeek", "title"],
    );
    assertPlain(p);
  });

  it("a plate says why it is one, so the image route can tell a real plate from an unavailable one (review nit 5)", () => {
    const base = load();
    const few = ROWS.filter((r) => r.game_id === "2026_01_BUF_HOU");
    const zeroed = ROWS.map((r) => (r.team_id === "BUF" || r.team_id === "HOU" ? { ...r, pass_plays: 0, attempts: 0, sacks: 0, total_drives: 0 } : r));
    const noBuf = ROWS.filter((r) => r.team_id !== "BUF" && r.opponent_id !== "BUF");
    expect(asPlate(card({ ...load({ rows: few }), state: "small-pool" } as MatchupLoad)).reason).toBe("small-pool");
    expect(asPlate(card({ ...base, state: "uncovered", model: null, firstSeason: 2026, season: 2025 } as MatchupLoad)).reason).toBe("uncovered");
    expect(asPlate(card(load({ rows: zeroed }))).reason).toBe("no-radar");
    expect(asPlate(card(load({ rows: noBuf }))).reason).toBe("no-radar");
    expect(asPlate(card(load({ gamesAvailable: false, game: null, records: null }))).reason).toBe("unavailable");
    expect(asPlate(card({ ...base, model: null } as never)).reason).toBe("unavailable");
    // unavailable wins over every state: such a plate must never be stored
    expect(asPlate(card({ ...base, state: "uncovered", model: null, firstSeason: 2026, gamesAvailable: false } as MatchupLoad)).reason).toBe("unavailable");
  });

  it("the model's two teams must be the two teams passed, in that order: else the unavailable plate (review should-fix 2)", () => {
    const l = load({ awayId: "BUF", homeId: "HOU" });
    expect(asPlate(card(l, "HOU", "BUF"))).toMatchObject({ reason: "unavailable", message: C.MATCHUP_CARD_UNAVAILABLE });
    expect(asPlate(card(l, "BUF", "LA")).reason).toBe("unavailable");
    expect(asPlate(card(l, "LA", "HOU")).reason).toBe("unavailable");
    expect(card(l, "BUF", "HOU").kind).toBe("card");
  });

  it("a game row that is not this pair in this order is no game: VS, no venue, no score (chaos F10)", () => {
    for (const other of [
      game({ away_team: "HOU", home_team: "BUF", away_score: 24, home_score: 16 }),
      game({ away_team: "BUF", home_team: "LA" }),
      game({ away_team: "buf", home_team: "HOU" }),
      game({ away_team: "BUF ✓", home_team: "HOU" }),
      {} as MatchupGame,
    ]) {
      const c = asCard(card(load({ game: other })));
      expect(c.hasGame).toBe(false);
      expect(c.band.seam).toBe("VS");
      expect(c.band.away.meta).toBe("2-1");
      expect(c.subLine).toBe("No 2026 game between these teams · 2026 through Week 3");
      expect(c.title).toContain(" vs ");
    }
  });

  it("nothing from a game row reaches the card unchecked: an unknown game type prints no round name, an impossible week no week", () => {
    const pre = asCard(card(load({ game: game({ game_type: "PRE" }) })));
    expect(pre.subLine).toBe("Thu Oct 8 · 8:15 PM ET · 2026 through Week 3");
    expect(pre.hasGame).toBe(true);
    expect(pre.showHowTo).toBe(true);
    for (const game_type of ["PRÉ-SAISON ✓", "x".repeat(300), "<b>", "POST"]) {
      const c = asCard(card(load({ game: game({ game_type }) })));
      expect(c.subLine, game_type).toBe("Thu Oct 8 · 8:15 PM ET · 2026 through Week 3");
    }
    for (const week of [0, 23, 1.5, -1, NaN, "5" as never]) {
      expect(asCard(card(load({ game: game({ week }) }))).subLine, String(week)).toBe("Thu Oct 8 · 8:15 PM ET · 2026 through Week 3");
    }
    // the four playoff rounds and a regular-season week are the only names there are
    expect(C.matchupCardSubLine({ game: game({ game_type: "SB", week: 22 }), season: 2026, throughWeek: 18 })).toBe(
      "Super Bowl · Thu Oct 8 · 8:15 PM ET · 2026 through Week 18",
    );
    expect(C.matchupCardSubLine({ game: game({ week: 22 }), season: 2026, throughWeek: 18 })).toBe("Week 22 · Thu Oct 8 · 8:15 PM ET · 2026 through Week 18");
  });

  it("the Final line prints team ids as letters only, whatever the row holds (the builder only ever passes the two validated ids)", () => {
    const line = C.matchupCardSubLine({
      game: game({ away_team: "B<U>F✓", home_team: "ho\nu", away_score: 24, home_score: 16 }), season: 2026, throughWeek: 5,
    });
    expect(line).toBe("Week 5 · Thu Oct 8 · Final: BUF 24, HOU 16 · 2026 through Week 5");
    const played = asCard(card(load({ game: game({ away_score: 24, home_score: 16 }) })));
    expect(played.subLine).toContain("Final: BUF 24, HOU 16");
  });

  it("never throws on a load that is not what it should be", () => {
    const base = load();
    for (const broken of [
      { ...base, model: null },
      { ...base, records: null },
      { ...base, model: { ...(base.model as MatchupModel), awayBall: null, homeBall: null } },
      { ...base, game: {} },
      { ...base, state: "something-else" },
    ]) {
      expect(() => card(broken as never)).not.toThrow();
      assertPlain(card(broken as never));
    }
  });

  it("the load type the builder reads is a part of MatchupLoad (the loader's answer is passed as it is)", () => {
    const whole: MatchupLoad = load();
    const part: MatchupCardLoad = whole;
    expect(card(part)).toEqual(card(whole));
  });
});

/* ─── After the PR 1 code review and chaos pass ─── */

describe("a short pool (review should-fix 1: spec F7 and F8 held with a pool of 31)", () => {
  const G = C.MATCHUP_CARD_RADAR;
  // BUF's offense has no turnover rate and no stuff rate, so the other 31 offenses are a pool of 31 on those two spokes
  const rows = ROWS.map((r) => (r.team_id === "BUF" ? { ...r, designed_runs: null, total_drives: 0 } : r));
  const STUFF = RADAR_AXES.findIndex((a) => a.key === "stuff");
  const TO = RADAR_AXES.findIndex((a) => a.key === "to");

  it("the vertex is at (pool − rank) / (pool − 1) of its own pool, not the 32-based point, and the label has no 'of N'", () => {
    let checked = 0;
    for (const t of NFL_TEAMS.filter((x) => x.id !== "BUF")) {
      const l = load({ rows, awayId: t.id, homeId: "BUF" });
      const m = l.model as MatchupModel;
      expect(m.teamsPlayed).toBe(32);
      const pane = drawn(asCard(card(l, t.id, "BUF")).panes[0]);
      for (const i of [STUFF, TO]) {
        const spoke = m.awayBall!.overlay.off!.spokes[i];
        expect(spoke.pool, `${t.id} ${spoke.key}`).toBe(31);
        const rank = spoke.rank as number;
        const v = pane.off.find((x) => x.key === spoke.key)!;
        const [x, y] = radarPoint(G, G.r * radarRadius((31 - rank) / 30), i);
        expect(v.x).toBeCloseTo(x, 9);
        expect(v.y).toBeCloseTo(y, 9);
        const label = pane.labels[i].offLine;
        expect(label).toBe(`${fmtRadarPct(spoke.value)} · ${spokeRankLabel(spoke)}`);
        expect(label).not.toContain(" of ");
        if (rank > 1) {
          const [x32, y32] = radarPoint(G, G.r * radarRadius((32 - rank) / 31), i);
          expect(Math.hypot(v.x - x32, v.y - y32), `${t.id} ${spoke.key} rank ${rank}`).toBeGreaterThan(0.05);
          checked += 1;
        }
      }
    }
    // most of the 62 spokes are not ranked 1st, so the two radii really were told apart
    expect(checked).toBeGreaterThan(30);
  });
});

describe("one rule for a missing spoke (chaos F2): no value, no rank or no score = a dash AND no vertex", () => {
  const SACK = RADAR_AXES.findIndex((a) => a.key === "sack");
  const withSpoke = (patch: Record<string, unknown>) => {
    const l = load();
    const m = JSON.parse(JSON.stringify(l.model)) as MatchupModel;
    Object.assign(m.awayBall!.overlay.off!.spokes[SACK], patch);
    return drawn(asCard(card({ ...l, model: m } as MatchupLoad)).panes[0]);
  };

  it("an untouched spoke has both", () => {
    const p = withSpoke({});
    expect(p.off.some((v) => v.key === "sack")).toBe(true);
    expect(p.labels[SACK].offLine).not.toBe(DASH);
  });

  it.each([
    ["rank null", { rank: null }],
    ["score null", { score: null }],
    ["value null", { value: null }],
    ["value NaN", { value: NaN }],
    ["value Infinity", { value: Infinity }],
    ["value a string", { value: "0.5" }],
    ["value undefined", { value: undefined }],
    ["rank NaN", { rank: NaN }],
    ["rank a string", { rank: "3" }],
    ["rank undefined", { rank: undefined }],
    ["score NaN", { score: NaN }],
    ["score Infinity", { score: Infinity }],
    ["score a string", { score: "0.5" }],
    ["score undefined", { score: undefined }],
  ])("%s: a dash and no vertex", (_name, patch) => {
    const p = withSpoke(patch);
    expect(p.labels[SACK].offLine).toBe(DASH);
    expect(p.off.some((v) => v.key === "sack")).toBe(false);
    expect(p.off).toHaveLength(6);
    // the defense line of the same spoke is another team's and is untouched
    expect(p.labels[SACK].defLine).not.toBe(DASH);
    expect(p.def.some((v) => v.key === "sack")).toBe(true);
    assertPlain(p);
  });

  it("a score outside 0-1 is clamped, as on the page's chart", () => {
    const G = C.MATCHUP_CARD_RADAR;
    const over = withSpoke({ score: 1.5 }).off.find((v) => v.key === "sack")!;
    expect(Math.hypot(over.x - G.cx, over.y - G.cy)).toBeCloseTo(G.r, 9);
    const under = withSpoke({ score: -2 }).off.find((v) => v.key === "sack")!;
    expect(Math.hypot(under.x - G.cx, under.y - G.cy)).toBeCloseTo(G.r * RADAR_HUB, 9);
  });

  it("a label's name never falls back to the radar's own axis name ('Sack rate'): the card's words are the overlay's (review nit 6)", () => {
    const l = load();
    const m = JSON.parse(JSON.stringify(l.model)) as MatchupModel;
    m.awayBall!.overlay.spokes = [];
    const p = drawn(asCard(card({ ...l, model: m } as MatchupLoad)).panes[0]);
    expect(p.labels.map((x) => x.name)).toEqual(["Explosive pass", "Pass success", "Sacks", "Turnovers", "Stuffs", "Run success", "Explosive run"]);
  });
});

describe("markers and label boxes (chaos F3): the tightest spot on the card", () => {
  const G = C.MATCHUP_CARD_RADAR;
  const K = C.MATCHUP_CARD_LAYOUT.marker;
  const BOXES = C.MATCHUP_CARD_LABEL_BOXES;

  it("at every rank of every pool from 1 to 40, no marker comes within 1 px of any label box", () => {
    // as drawn: the fill plus half the stroke
    const squareHalf = K.square + K.squareStroke / 2;
    const dotRadius = K.dot + K.dotStroke / 2;
    let square = { d: Infinity, spoke: -1, box: -1, rank: 0 };
    let dot = { d: Infinity, spoke: -1, box: -1, rank: 0 };
    for (let pool = 1; pool <= 40; pool += 1) {
      for (let rank = 1; rank <= pool; rank += 1) {
        const score = pool === 1 ? 1 : (pool - rank) / (pool - 1);
        for (let i = 0; i < 7; i += 1) {
          const [x, y] = radarPoint(G, G.r * radarRadius(score), i);
          BOXES.forEach((b, j) => {
            const dx = Math.max(b.left - x, 0, x - (b.left + b.width));
            const dy = Math.max(b.top - y, 0, y - (b.top + b.height));
            const sq = Math.hypot(Math.max(dx - squareHalf, 0), Math.max(dy - squareHalf, 0));
            const dt = Math.hypot(dx, dy) - dotRadius;
            if (sq < square.d) square = { d: sq, spoke: i, box: j, rank };
            if (dt < dot.d) dot = { d: dt, spoke: i, box: j, rank };
          });
        }
      }
    }
    expect(square.d).toBeGreaterThanOrEqual(1);
    expect(dot.d).toBeGreaterThanOrEqual(1);
    // a defense square at 1st on Pass success (or Explosive run), against that spoke's own box: 1.02 px
    expect(square.d).toBeCloseTo(1.02, 2);
    expect([1, 6]).toContain(square.spoke);
    expect(square.box).toBe(square.spoke);
    expect(square.rank).toBe(1);
    // an offense dot at 1st on Sacks (or Run success): 3.10 px
    expect(dot.d).toBeCloseTo(3.1, 2);
    expect([2, 5]).toContain(dot.spoke);
  });
});

describe("matchupCardImageHref never prints a season its own parser refuses (chaos F5)", () => {
  it.each([[1998], [2101], [0], [-2026], [2026.5], [NaN], [Infinity], [1e21], [null], [undefined], ["2026"], [{}]])(
    "season %s is left out, and what is printed parses",
    (season) => {
      for (const week of [null, 5]) {
        for (const download of [false, true]) {
          const href = C.matchupCardImageHref("BUF", "LA", season as never, { week, download });
          expect(href).not.toContain("season");
          expect(href).not.toMatch(/undefined|NaN|Infinity|null/);
          expect(C.parseMatchupImageQuery(rawQueryOf(href)), href).toEqual({ season: null, download });
        }
      }
    },
  );

  it("a real season is printed as before, and options may be null", () => {
    for (const season of [1999, 2025, 2026, 2100]) {
      expect(C.matchupCardImageHref("BUF", "LA", season, { week: 5 })).toBe(`/api/matchup-card/BUF/LA?season=${season}&w=5`);
    }
    expect(C.matchupCardImageHref("BUF", "LA", 2026, null as never)).toBe("/api/matchup-card/BUF/LA?season=2026");
  });
});

/* ─── §6.3, §6.4: text fit at real glyph widths ─── */

const SANS = readFont(join(process.cwd(), "node_modules", "next", "dist", "compiled", "@vercel", "og", "noto-sans-v27-latin-regular.ttf"));
const PIXEL = readFont(join(process.cwd(), "app", "fonts", "PressStart2P-Regular.ttf"));
const SPARE = 6;

const WORST_REG_GAME = game({
  week: 18, gameday: "2027-01-10", weekday: "Saturday", away_team: "WAS", home_team: "NYG", away_score: 38, home_score: 35,
});
const WORST_PLAYOFF_GAME = game({
  game_type: "CON", week: 21, gameday: "2027-01-24", weekday: "Sunday", away_team: "WAS", home_team: "LAC", away_score: 38, home_score: 35,
});

describe("text fit at real glyph widths (§6.3, §6.4; 6 px to spare)", () => {
  const L = C.MATCHUP_CARD_LAYOUT;
  const BOXES = C.MATCHUP_CARD_LABEL_BOXES;
  const mark = L.label.mark + L.label.markGap;

  it("these are the two files the image registers", () => {
    const source = readFileSync(join(process.cwd(), "lib/og/team-radar-image.tsx"), "utf8");
    expect(source).toContain('"noto-sans-v27-latin-regular.ttf"');
    expect(source).toContain('"PressStart2P-Regular.ttf"');
    expect(SANS.unitsPerEm).toBeGreaterThan(0);
  });

  it("the widest stat line, with its mark, fits the narrowest side box and the top box", () => {
    const widest = SANS.width("100.0% · T-32nd", L.label.statSize);
    expect(widest).toBeCloseTo(126.3, 1);
    const narrowest = Math.min(...BOXES.filter((b) => b.align !== "center").map((b) => b.width));
    expect(narrowest).toBeCloseTo(176.2, 1);
    expect(widest + mark + SPARE).toBeLessThanOrEqual(narrowest);
    expect(widest + mark + SPARE).toBeLessThanOrEqual(L.label.topWidth);
    // every line the two formatters can print is no wider than that one
    for (let rank = 1; rank <= 32; rank += 1) {
      for (const tied of [false, true]) {
        for (const value of [0, 0.0704, 0.113, 0.888, 1]) {
          const text = `${fmtRadarPct(value)} · ${spokeRankLabel({ rank, tied })}`;
          expect(SANS.width(text, L.label.statSize), text).toBeLessThanOrEqual(widest + 1e-9);
        }
      }
    }
  });

  it("every spoke name fits its own box at 14 px ('Explosive pass' is the widest, 95 px)", () => {
    const c = asCard(card());
    const names = drawn(c.panes[0]).labels.map((l) => l.name);
    expect(SANS.width("Explosive pass", L.label.nameSize)).toBeCloseTo(94.7, 1);
    names.forEach((name, i) => {
      expect(SANS.width(name, L.label.nameSize)).toBeLessThanOrEqual(SANS.width("Explosive pass", L.label.nameSize));
      expect(SANS.width(name, L.label.nameSize) + SPARE, name).toBeLessThanOrEqual(BOXES[i].width);
    });
  });

  it("Press Start 2P is one em wide for A-Z, 0-9 and space", () => {
    for (const ch of "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ") expect(PIXEL.width(ch, 20), ch).toBe(20);
  });

  it("every one of the 32 upper-cased team names fits the 520 px box at its size", () => {
    let longest = 0;
    for (const t of NFL_TEAMS) {
      const name = t.name.toUpperCase();
      const size = C.matchupBandNameSize(name);
      expect(PIXEL.width(name, size) + SPARE, name).toBeLessThanOrEqual(L.nameBox.width);
      expect(size, name).toBeGreaterThanOrEqual(20); // the third step is for a renamed team, not today's names
      longest = Math.max(longest, name.length);
    }
    expect(longest).toBe(21); // WASHINGTON COMMANDERS: 420 px at 20
    expect(PIXEL.width("WASHINGTON COMMANDERS", C.matchupBandNameSize("WASHINGTON COMMANDERS"))).toBe(420);
    // the worst a renamed team could do at each step still fits
    expect(PIXEL.width("X".repeat(16), 24)).toBeLessThanOrEqual(L.nameBox.width);
    expect(PIXEL.width("X".repeat(26), 20)).toBeLessThanOrEqual(L.nameBox.width);
  });

  it("the band meta fits under the name ('12-4-1 · home' is 103 px at 16)", () => {
    expect(SANS.width("12-4-1 · home", 16)).toBeCloseTo(103.1, 1);
    expect(SANS.width("12-4-1 · home", 16) + SPARE).toBeLessThanOrEqual(L.nameBox.width);
  });

  it("the sub-band: the WIDEST regular-season K3 there can be, K4 and the site name fit in 1,120 with 12 px to spare each way (chaos F1)", () => {
    // Searched, not guessed: every weekday, every month, every ordered pair of the 32 ids, a played and an
    // unplayed game. Digits are all one width in this font (asserted), so one two-digit week, day and score
    // stands for all of them, and the widest week / through-week is any two-digit one.
    const digit = SANS.width("0", 15);
    for (const d of "123456789") expect(SANS.width(d, 15)).toBe(digit);
    const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const ids = NFL_TEAMS.map((t) => t.id);
    let widest = { w: 0, text: "" };
    let widestInSeason = { w: 0, text: "" };
    let widestUnplayed = 0;
    for (const weekday of WEEKDAYS) {
      for (let month = 1; month <= 12; month += 1) {
        const gameday = `2026-${String(month).padStart(2, "0")}-28`;
        const unplayed = C.matchupCardSubLine({ game: game({ week: 18, gameday, weekday, gametime: "12:30" }), season: 2026, throughWeek: 18 });
        widestUnplayed = Math.max(widestUnplayed, SANS.width(unplayed, 15));
        for (const away_team of ids) {
          for (const home_team of ids) {
            if (away_team === home_team) continue;
            const text = C.matchupCardSubLine({
              game: game({ week: 18, gameday, weekday, away_team, home_team, away_score: 38, home_score: 35 }), season: 2026, throughWeek: 18,
            });
            const w = SANS.width(text, 15);
            if (w > widest.w) widest = { w, text };
            // the months a regular season is played in
            if ([9, 10, 11, 12, 1].includes(month) && w > widestInSeason.w) widestInSeason = { w, text };
          }
        }
      }
    }
    expect(widest.text).toBe("Week 18 · Mon May 28 · Final: HOU 38, WAS 35 · 2026 through Week 18");
    expect(widest.w).toBeCloseTo(498.5, 1);
    expect(widestInSeason.text).toBe("Week 18 · Mon Nov 28 · Final: HOU 38, WAS 35 · 2026 through Week 18");
    expect(widestInSeason.w).toBeCloseTo(496.9, 1);
    // the pair the spec first named is 19 px narrower
    expect(SANS.width(C.matchupCardSubLine({ game: WORST_REG_GAME, season: 2026, throughWeek: 18 }), 15)).toBeCloseTo(477.7, 1);
    expect(widestUnplayed).toBeLessThan(widest.w);
    expect(SANS.width(C.matchupCardSubLine({ game: null, season: 2026, throughWeek: 18 }), 15)).toBeLessThan(widest.w);

    const available = L.width - 2 * L.padX;
    expect(available).toBe(1120);
    const w4 = SANS.width(C.MATCHUP_CARD_HOW_TO, 15);
    const site = PIXEL.width(C.MATCHUP_CARD_SITE_NAME, 10);
    expect(w4).toBeCloseTo(432.0, 1);
    expect(site).toBe(160);
    const WIDE_SPARE = 12;
    // in its own box, and between the three items of the row
    expect(widest.w + WIDE_SPARE).toBeLessThanOrEqual(L.subLineMaxWidth);
    expect(widest.w + w4 + site + 2 * WIDE_SPARE).toBeLessThanOrEqual(available);
  });

  it("a playoff K3 does not fit beside K4, which is why it is dropped; alone it fits its 900 px", () => {
    const k3 = C.matchupCardSubLine({ game: WORST_PLAYOFF_GAME, season: 2026, throughWeek: 18 });
    const w3 = SANS.width(k3, 15);
    expect(w3).toBeCloseTo(605.7, 1);
    expect(w3 + SANS.width(C.MATCHUP_CARD_HOW_TO, 15) + 160).toBeGreaterThan(1120);
    expect(w3 + SPARE).toBeLessThanOrEqual(L.subLineMaxWidthAlone);
    expect(w3 + 160 + SPARE).toBeLessThanOrEqual(1120);
  });

  it("K5 fits the footer and leaves the bottom-left corner empty (it starts right of x = 250)", () => {
    for (const ring of [MATCHUP_RING_AMBER, MATCHUP_RING_GREY]) {
      const w = SANS.width(C.matchupCardLegendLine(32, ring), 15);
      expect(w + SPARE).toBeLessThanOrEqual(1120);
      expect(L.width - L.padX - w).toBeGreaterThan(250);
    }
    expect(SANS.width(C.matchupCardLegendLine(32, MATCHUP_RING_AMBER), 15)).toBeCloseTo(907.3, 1);
  });
});

/* ─── §6.2: every character the image can print has a glyph in its own family ─── */

describe("glyph coverage (§6.2: a missing glyph would make next/og fetch a font at request time)", () => {
  const ROUND_GAMES = ["REG", "WC", "DIV", "CON", "SB"].map((game_type) => game({ game_type }));
  const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const MONTH_GAMES = Array.from({ length: 12 }, (_, m) =>
    game({ gameday: `2026-${String(m + 1).padStart(2, "0")}-28`, weekday: WEEKDAYS[m % 7], gametime: m % 2 ? "13:00" : "00:05" }),
  );

  const sans: string[] = [
    // K3 in all its forms
    ...ROUND_GAMES.map((g) => M.gameWeekLabel(g)),
    ...ROUND_GAMES.map((g) => C.matchupCardSubLine({ game: g, season: 2026, throughWeek: 18 })),
    ...MONTH_GAMES.map((g) => C.matchupCardSubLine({ game: g, season: 2026, throughWeek: 9 })),
    ...WEEKDAYS.map((weekday) => M.formatKickoff(game({ weekday }))),
    C.matchupCardSubLine({ game: WORST_REG_GAME, season: 2026, throughWeek: 18 }),
    C.matchupCardSubLine({ game: WORST_PLAYOFF_GAME, season: 2026, throughWeek: 18 }),
    ...NFL_TEAMS.map((t) => M.formatKickoff(game({ away_team: t.id, home_team: t.id === "BUF" ? "HOU" : "BUF", away_score: 0, home_score: 109 }))),
    C.matchupCardSubLine({ game: null, season: 2026, throughWeek: 18 }),
    C.matchupCardSubLine({ game: null, season: 2026, throughWeek: null }),
    C.matchupCardSeasonLine(2026, 22),
    C.matchupCardSeasonLine(1999, null),
    // K4, K5 with both ring words, K15
    C.MATCHUP_CARD_HOW_TO,
    C.matchupCardLegendLine(32, MATCHUP_RING_AMBER),
    C.matchupCardLegendLine(8, MATCHUP_RING_GREY),
    ...NFL_TEAMS.flatMap((t) => Object.values(C.matchupCardLegendWords(t.id, t.id))),
    // the plate sentences and the pane sentences
    M.MATCHUP_SMALL_POOL_NOTE,
    M.matchupUncoveredHeading(2025, 2026),
    M.matchupUncoveredHeading(2025, null),
    M.MATCHUP_NO_OVERLAY_NOTE,
    ...NFL_TEAMS.map((t) => M.matchupNoGamesNote(t.name, 2026)),
    // the labels
    ...drawn(asCard(card()).panes[0]).labels.map((l) => l.name),
    DASH,
    ...[0, 1, 0.5, 0.0704, 0.113].map((v) => fmtRadarPct(v)),
    ...Array.from({ length: 32 }, (_, i) => [spokeRankLabel({ rank: i + 1, tied: false }), spokeRankLabel({ rank: i + 1, tied: true })]).flat(),
    ...[0, 1, 0.5].flatMap((v) => [`${fmtRadarPct(v)} · ${spokeRankLabel({ rank: 32, tied: true })}`]),
    // the band meta
    "0-0", "12-4-1", "17-0 · away", "12-4-1 · home", "3-1 · away", "9-8 · home",
  ];
  const pixel: string[] = [
    C.MATCHUP_CARD_SEAM_AT,
    C.MATCHUP_CARD_SEAM_VS,
    C.MATCHUP_CARD_SITE_NAME,
    RADAR_CARD_SITE_LINE,
    ...NFL_TEAMS.map((t) => t.name.toUpperCase()),
  ];

  it("the lists are real: every K3 form is in them", () => {
    expect(sans).toContain("Wild Card");
    expect(sans).toContain("Divisional");
    expect(sans).toContain("Conference Championship");
    expect(sans).toContain("Super Bowl");
    expect(sans.some((s) => /Final: /.test(s))).toBe(true);
    expect(sans.some((s) => / (AM|PM) ET/.test(s))).toBe(true);
    for (const month of ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]) {
      expect(sans.some((s) => s.includes(` ${month} 28`)), month).toBe(true);
    }
    for (const day of ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]) expect(sans.some((s) => s.includes(`${day} Oct 8`)), day).toBe(true);
    for (const s of [...sans, ...pixel]) expect(typeof s === "string" && s.length > 0, JSON.stringify(s)).toBe(true);
  });

  it("Noto Sans has a glyph for every character of every string set in it", () => {
    for (const s of sans) for (const ch of Array.from(s)) expect(SANS.has(ch), `${JSON.stringify(ch)} in ${JSON.stringify(s)}`).toBe(true);
  });

  it("Press Start 2P has a glyph for every character of every string set in it", () => {
    for (const s of pixel) for (const ch of Array.from(s)) expect(PIXEL.has(ch), `${JSON.stringify(ch)} in ${JSON.stringify(s)}`).toBe(true);
  });

  it("the only non-ASCII characters on the image are the middle dot, the em dash and the curly apostrophe", () => {
    const nonAscii = new Set<string>();
    for (const s of [...sans, ...pixel]) for (const ch of Array.from(s)) if ((ch.codePointAt(0) as number) > 0x7e) nonAscii.add(ch);
    expect(Array.from(nonAscii).sort()).toEqual(["·", "—", "’"].sort());
    for (const s of pixel) for (const ch of Array.from(s)) if ((ch.codePointAt(0) as number) > 0x7e) expect(ch).toBe("·");
  });

  it("the arrow is not in Noto Sans, so K9 and K12 stay in HTML", () => {
    expect(SANS.has("→")).toBe(false);
    expect(C.MATCHUP_CARD_FULL_LINK_TEXT).toContain("→");
    expect(C.MATCHUP_OPEN_CARD_TEXT).toContain("→");
    for (const s of [...sans, ...pixel]) expect(s).not.toContain("→");
  });
});

/* ─── the module's place in the graph ─── */

describe("lib/stats/matchup-card.ts is pure (§3)", () => {
  const source = readFileSync(join(process.cwd(), "lib/stats/matchup-card.ts"), "utf8");
  const imports = Array.from(source.matchAll(/from\s+["']([^"']+)["']/g)).map((m) => m[1]);

  it("imports only the modules the spec allows: nothing from lib/data, no React, Next, Supabase or component", () => {
    const allowed = [
      "@/lib/types", "@/lib/stats/matchup", "@/lib/stats/team-radar", "@/lib/stats/formatters", "@/lib/stats/box-score",
      "@/lib/stats/compare-links", "@/lib/stats/compare-card", "@/lib/stats/matchup-colours", "@/lib/stats/matchup-links",
    ];
    expect(imports.length).toBeGreaterThan(0);
    for (const i of imports) expect(allowed, i).toContain(i);
    for (const i of imports) expect(i).not.toMatch(/lib\/data|supabase|^react|^next|components\//);
    expect(source).not.toContain("use client");
    expect(source).not.toMatch(/\brequire\(|\bimport\(/);
  });

  it("never reads the clock", () => {
    expect(source).not.toMatch(/new Date\(|Date\.now\(|Date\.parse\(/);
  });
});
