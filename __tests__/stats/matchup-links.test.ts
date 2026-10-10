// lib/stats/matchup-links.ts (team matchup spec 2026-10-10 §4.1 step 3, §4.3,
// §7.1): the links and URL words of /matchup. Browser code imports this module
// and nothing heavier, so it must import NOTHING itself.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  MATCHUP_SEASON_MAX,
  MATCHUP_SEASON_MIN,
  flipBall,
  matchupHref,
  parseBall,
  parseMatchupSeason,
  parseMatchupTeamId,
} from "@/lib/stats/matchup-links";
import { parseRadarTeamId } from "@/lib/stats/team-radar";
import { SEASON_PARAM_MAX, SEASON_PARAM_MIN } from "@/lib/stats/team-stats";

describe("parseMatchupSeason (§4.1 step 3: a single string of exactly four digits, 1999-2100)", () => {
  it("accepts a plain four-digit season in range", () => {
    expect(parseMatchupSeason("2026")).toBe(2026);
    expect(parseMatchupSeason("1999")).toBe(1999);
    expect(parseMatchupSeason("2100")).toBe(2100);
  });

  it.each([
    ["02026"], ["2026abc"], ["2025.9"], [" 2026"], ["2026 "], ["2026\n"], [""], ["1998"], ["2101"],
    ["abc"], ["+2026"], ["-2026"], ["2e3"], ["99999999999999999999"], ["٢٠٢٦"],
  ])("%j is absent (never parseInt's 'close enough')", (raw) => {
    expect(parseMatchupSeason(raw)).toBeNull();
  });

  it("a repeated key (an array), undefined and null are absent", () => {
    expect(parseMatchupSeason(["2026"])).toBeNull();
    expect(parseMatchupSeason(["2026", "2025"])).toBeNull();
    expect(parseMatchupSeason([])).toBeNull();
    expect(parseMatchupSeason(undefined)).toBeNull();
    expect(parseMatchupSeason(null)).toBeNull();
  });

  it("anything that is not a string is absent, without throwing", () => {
    for (const raw of [2026, 2026.5, NaN, {}, true, () => "2026"]) {
      expect(parseMatchupSeason(raw as never)).toBeNull();
    }
  });

  it("the range is the site's own (the module may import nothing, so the two numbers are written again and held here)", () => {
    expect(MATCHUP_SEASON_MIN).toBe(SEASON_PARAM_MIN);
    expect(MATCHUP_SEASON_MAX).toBe(SEASON_PARAM_MAX);
  });
});

describe("parseBall / flipBall (§4.3)", () => {
  it("is home only for exactly \"home\"", () => {
    expect(parseBall("home")).toBe("home");
    for (const raw of ["HOME", "Home", " home", "home ", "away", "", "1", undefined, null]) {
      expect(parseBall(raw)).toBe("away");
    }
  });

  it("a repeated key is absent (away), whatever it holds", () => {
    expect(parseBall(["home"])).toBe("away");
    expect(parseBall(["home", "away"])).toBe("away");
    expect(parseBall([])).toBe("away");
  });

  it("flips", () => {
    expect(flipBall("away")).toBe("home");
    expect(flipBall("home")).toBe("away");
  });
});

describe("matchupHref (§7.1: the playerHref rule for the season; season before ball)", () => {
  it("bare", () => {
    expect(matchupHref("BUF", "LA")).toBe("/matchup/BUF/LA");
    expect(matchupHref("BUF", "LA", {})).toBe("/matchup/BUF/LA");
  });

  it("a past season carries ?season=; the default season does not", () => {
    expect(matchupHref("BUF", "LA", { season: 2025, defaultSeason: 2026 })).toBe("/matchup/BUF/LA?season=2025");
    expect(matchupHref("BUF", "LA", { season: 2026, defaultSeason: 2026 })).toBe("/matchup/BUF/LA");
  });

  it("an unknown default still carries the season (playerHref's rule)", () => {
    expect(matchupHref("BUF", "LA", { season: 2026 })).toBe("/matchup/BUF/LA?season=2026");
    expect(matchupHref("BUF", "LA", { season: 2026, defaultSeason: null })).toBe("/matchup/BUF/LA?season=2026");
  });

  it("ball=home only for home", () => {
    expect(matchupHref("BUF", "LA", { ball: "home" })).toBe("/matchup/BUF/LA?ball=home");
    expect(matchupHref("BUF", "LA", { ball: "away" })).toBe("/matchup/BUF/LA");
  });

  it("both: season first, then ball", () => {
    expect(matchupHref("NE", "BUF", { season: 2025, defaultSeason: 2026, ball: "home" })).toBe(
      "/matchup/NE/BUF?season=2025&ball=home",
    );
  });

  it("a season that is not a positive whole number never becomes a link", () => {
    for (const season of [2025.5, NaN, Infinity, 0, -2025, null, undefined, "2025" as never]) {
      expect(matchupHref("BUF", "LA", { season, defaultSeason: 2026 })).toBe("/matchup/BUF/LA");
    }
    expect(matchupHref("BUF", "LA", { season: 2025.5, defaultSeason: 2026, ball: "home" })).toBe("/matchup/BUF/LA?ball=home");
  });

  it("keeps the order asked for (away first)", () => {
    expect(matchupHref("LA", "BUF")).toBe("/matchup/LA/BUF");
  });
});

// Chaos pass, PR 1 (spec §17, finding F8): the helper no longer trusts its caller.
describe("chaos F8: matchupHref encodes its segments and only emits a season the route would accept", () => {
  it("a season the route's own rule rejects is left out", () => {
    for (const season of [5, 1998, 2101, 1e21, Number.MAX_SAFE_INTEGER, 20260]) {
      expect(matchupHref("BUF", "LA", { season, defaultSeason: 2026 }), String(season)).toBe("/matchup/BUF/LA");
    }
    expect(matchupHref("BUF", "LA", { season: 1999, defaultSeason: 2026 })).toBe("/matchup/BUF/LA?season=1999");
    expect(matchupHref("BUF", "LA", { season: 2100, defaultSeason: 2026 })).toBe("/matchup/BUF/LA?season=2100");
  });

  it("every season it emits is one parseMatchupSeason reads back", () => {
    for (const season of [1999, 2000, 2025, 2026, 2100]) {
      const href = matchupHref("BUF", "LA", { season });
      expect(parseMatchupSeason(new URLSearchParams(href.split("?")[1]).get("season") ?? undefined)).toBe(season);
    }
  });

  it("a segment cannot add a query, a hash or a path of its own", () => {
    expect(matchupHref("BUF?season=1999#", "LA")).toBe("/matchup/BUF%3Fseason%3D1999%23/LA");
    expect(matchupHref("//evil.com", "LA")).toBe("/matchup/%2F%2Fevil.com/LA");
    expect(matchupHref("BUF", "LA/../../x")).toBe("/matchup/BUF/LA%2F..%2F..%2Fx");
    expect(matchupHref("B F", "L&A=1")).toBe("/matchup/B%20F/L%26A%3D1");
    for (const [a, b] of [["BUF?x=1", "LA"], ["BUF#h", "LA"], ["a/b", "c/d"], ["%00", "\n"]]) {
      const href = matchupHref(a, b, { ball: "home" });
      expect(href.split("?")).toHaveLength(2);
      expect(href).not.toContain("#");
      expect(href.split("?")[0].split("/")).toHaveLength(4);
      expect(href.endsWith("?ball=home")).toBe(true);
    }
  });

  it("real team ids are unchanged, and a value that is not a string does not throw", () => {
    expect(matchupHref("BUF", "LA")).toBe("/matchup/BUF/LA");
    expect(matchupHref("NE", "NYJ", { season: 2025, defaultSeason: 2026, ball: "home" })).toBe("/matchup/NE/NYJ?season=2025&ball=home");
    expect(() => matchupHref(null as never, undefined as never)).not.toThrow();
    expect(() => matchupHref("\ud800", "LA")).not.toThrow();
  });
});

describe("parseMatchupTeamId (§7.1: two or three ASCII letters, tested BEFORE upper-casing)", () => {
  const TABLE: (string | null | undefined)[] = [
    "ſf", // long s: upper-cases to SF
    "pıt", // dotless i: upper-cases to PIT
    "buf", "BUF", "Buf", "la", "LA", "L.A", "", null, undefined,
    "BUFF", "B", "B1", "BU ", " BU", "ÉA", "ab\n", "a-b", "%00", "x".repeat(300),
  ];

  it.each(TABLE.map((raw) => [raw]))("%j: the same answer as parseRadarTeamId", (raw) => {
    expect(parseMatchupTeamId(raw)).toBe(parseRadarTeamId(raw));
  });

  it("the answers themselves", () => {
    expect(parseMatchupTeamId("buf")).toBe("BUF");
    expect(parseMatchupTeamId("BUF")).toBe("BUF");
    expect(parseMatchupTeamId("la")).toBe("LA");
    expect(parseMatchupTeamId("ſf")).toBeNull();
    expect(parseMatchupTeamId("pıt")).toBeNull();
    expect(parseMatchupTeamId("L.A")).toBeNull();
    expect(parseMatchupTeamId("")).toBeNull();
    expect(parseMatchupTeamId(null)).toBeNull();
    expect(parseMatchupTeamId("BUFF")).toBeNull();
    expect(parseMatchupTeamId("B")).toBeNull();
  });

  it("a value that is not a string is no team, without throwing", () => {
    for (const raw of [42, {}, ["BUF"], true]) expect(parseMatchupTeamId(raw as never)).toBeNull();
  });
});

describe("the module imports nothing (§7.1: it is in the browser bundle of the schedule tiles, the toggle and the picker)", () => {
  const source = readFileSync(join(process.cwd(), "lib/stats/matchup-links.ts"), "utf8");

  it("has no import, require or re-export from another module", () => {
    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toMatch(/\bfrom\s+["']/);
    expect(source).not.toMatch(/\brequire\(|\bimport\(/);
    expect(source).not.toContain("use client");
  });
});
