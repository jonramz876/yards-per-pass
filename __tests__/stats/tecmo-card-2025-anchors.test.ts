// Frozen reproduction of the OVR v3 study on the real 2025 QB season.
//
// `fixtures/qb-2025-pool.json` is the actual 2025 nflverse-derived
// `qb_season_stats` pool (78 QBs, trimmed to the columns buildQBCardData
// reads), captured PRE-kneel-fix. The expected displays are the anchors from
// the six-season OVR study that chose this formula — the study's raw blends
// run through the Madden display map.
//
// THE FIXTURE IS DELIBERATELY FROZEN. When the 2020-2025 kneel backfill lands
// it will change what ingest writes for these same players (rush EPA and
// epa_per_play both move), and the live site's 2025 numbers will drift a point
// or two away from the values below. That is expected and is NOT a reason to
// re-capture this file: these tests pin the FORMULA, not the data. Re-capture
// only if the formula itself is intentionally changed, and then re-derive the
// anchors from a fresh study rather than from the code being tested.
import { describe, it, expect } from "vitest";
import { buildQBCardData, qbEligible } from "@/lib/stats/tecmo-card";
import type { QBSeasonStat } from "@/lib/types";
import poolFixture from "./fixtures/qb-2025-pool.json";

/**
 * JSON has no NaN, so the fixture stores a missing stat as null. The live app
 * gets NaN instead (parseNumericFields converts a null DB value), and the OVR
 * builders branch on NaN — so convert here to exercise the same code paths.
 */
const NUMERIC_FIELDS = [
  "games", "completions", "attempts", "dropbacks", "epa_per_db", "epa_per_play",
  "cpoe", "completion_pct", "success_rate", "passing_yards", "touchdowns",
  "interceptions", "sacks", "adot", "passer_rating", "any_a", "rush_attempts",
  "rush_yards", "rush_tds", "rush_epa_per_play", "fumbles", "fumbles_lost",
  "scramble_pct",
] as const;

const POOL: QBSeasonStat[] = (poolFixture as Record<string, unknown>[]).map((row) => {
  const out: Record<string, unknown> = { ...row, season: 2025 };
  for (const key of NUMERIC_FIELDS) out[key] = row[key] == null ? NaN : Number(row[key]);
  return out as unknown as QBSeasonStat;
});

const ovrOf = (name: string) => {
  const me = POOL.find((q) => q.player_name === name);
  if (!me) throw new Error(`fixture has no QB named ${name}`);
  return buildQBCardData(me, POOL, 2025).ovr;
};

describe("OVR v3 on the real 2025 QB season (frozen anchors)", () => {
  it("reproduces the study's nine anchor QBs", () => {
    // Study blends (column `ovr_W_soft3`, unrounded) through
    //   display = min(99, round(77 + (blend - 50) * 0.45))
    expect(ovrOf("D.Maye")).toBe(97);       // blend 93.7020 -> 96.666
    expect(ovrOf("J.Allen")).toBe(94);      // blend 87.6483 -> 93.942
    expect(ovrOf("P.Mahomes")).toBe(92);    // blend 83.6195 -> 92.129
    expect(ovrOf("M.Stafford")).toBe(92);   // blend 84.1239 -> 92.356
    expect(ovrOf("B.Purdy")).toBe(91);      // blend 81.5127 -> 91.181, on 9 games
    expect(ovrOf("J.Burrow")).toBe(86);     // blend 69.1359 -> 85.611, on 8 games
    expect(ovrOf("J.McCarthy")).toBe(71);   // blend 37.4071 -> 71.333
    expect(ovrOf("C.Ward")).toBe(67);       // blend 26.7795 -> 66.551

    // Lamar is the one anchor where the spec's own item-5 table and item-1
    // formula disagree, so it is worth pinning explicitly. The study script
    // stored `ovr_W_soft3` ALREADY ROUNDED (min(99, js_round(blend))), and the
    // item-5 list was produced by mapping that rounded column:
    //     77 + (67 - 50) * 0.45 = 84.65 -> 85
    // Item 1 mandates a single round at the display step, and his unrounded
    // blend is 66.6530:
    //     77 + (66.6530 - 50) * 0.45 = 84.494 -> 84
    // He is the only 2025 QB the double round moves. 84 is correct here; a 85
    // means a round crept back into the blend.
    expect(ovrOf("L.Jackson")).toBe(84);
  });

  it("grades every qualified QB and dashes every non-qualifier", () => {
    const graded = POOL.map((me) => ({
      eligible: qbEligible(me),
      ovr: buildQBCardData(me, POOL, 2025).ovr,
    }));
    expect(graded).toHaveLength(78);
    expect(graded.filter((g) => g.eligible)).toHaveLength(57);
    expect(graded.filter((g) => !g.eligible)).toHaveLength(21);
    // Eligibility is the only thing that decides whether a number is shown:
    // no qualifier falls through to a dash, no non-qualifier gets a score.
    expect(graded.filter((g) => g.ovr !== null)).toHaveLength(57);
    expect(graded.every((g) => (g.ovr === null) === !g.eligible)).toBe(true);
  });

  it("keeps every graded QB an integer inside the Madden range", () => {
    for (const me of POOL.filter(qbEligible)) {
      const ovr = buildQBCardData(me, POOL, 2025).ovr!;
      expect(Number.isInteger(ovr)).toBe(true);
      expect(ovr).toBeLessThanOrEqual(99);
      // The scale's floor is round(77 - 50*0.45) = 55 at a blend of 0; no real
      // qualifier should ever render a 0-ish grade the way v2 did.
      expect(ovr).toBeGreaterThanOrEqual(55);
    }
  });
});
