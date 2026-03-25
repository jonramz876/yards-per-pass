import { describe, it, expect } from "vitest";
import {
  computePercentile,
  computeRank,
  ordinal,
  chipColor,
  getHeatmapPercentile,
  getHeatmapStyle,
} from "@/lib/stats/percentiles";

// ---------------------------------------------------------------------------
// computePercentile
// ---------------------------------------------------------------------------
describe("computePercentile", () => {
  it("returns 0 for an empty array", () => {
    expect(computePercentile([], 50)).toBe(0);
  });

  it("returns 0 for NaN value", () => {
    expect(computePercentile([1, 2, 3], NaN)).toBe(0);
  });

  it("returns 0 when value is the minimum (nothing below it)", () => {
    expect(computePercentile([10, 20, 30, 40, 50], 10)).toBe(0);
  });

  it("returns 100 when value is above the max", () => {
    // All 5 values are below 60 → 5/5 = 100
    expect(computePercentile([10, 20, 30, 40, 50], 60)).toBe(100);
  });

  it("returns correct percentile for the max value in the array", () => {
    // 4 values below 50 → 4/5 = 80
    expect(computePercentile([10, 20, 30, 40, 50], 50)).toBe(80);
  });

  it("returns correct percentile for the median value", () => {
    // [10,20,30,40,50], value=30 → 2 below → 2/5 = 40
    expect(computePercentile([10, 20, 30, 40, 50], 30)).toBe(40);
  });

  it("returns 0 when value is below the range", () => {
    expect(computePercentile([10, 20, 30], 5)).toBe(0);
  });

  it("works with a single-element array where value matches", () => {
    // Nothing below 42 → 0/1 = 0
    expect(computePercentile([42], 42)).toBe(0);
  });

  it("works with a single-element array where value is above", () => {
    // 1 below → 1/1 = 100
    expect(computePercentile([42], 99)).toBe(100);
  });

  it("handles duplicate values", () => {
    // [10,10,10,20,20], value=20 → 3 below → 3/5 = 60
    expect(computePercentile([10, 10, 10, 20, 20], 20)).toBe(60);
  });
});

// ---------------------------------------------------------------------------
// computeRank
// ---------------------------------------------------------------------------
describe("computeRank", () => {
  it("returns rank 1 for the highest value", () => {
    expect(computeRank([50, 40, 30, 20, 10], 50)).toBe(1);
  });

  it("returns last rank for the lowest value", () => {
    expect(computeRank([50, 40, 30, 20, 10], 10)).toBe(5);
  });

  it("returns correct rank for a middle value", () => {
    // 2 values above 30 → rank 3
    expect(computeRank([50, 40, 30, 20, 10], 30)).toBe(3);
  });

  it("handles tied values — they share the same rank", () => {
    // [50,50,30,10], value=50 → 0 above → rank 1
    expect(computeRank([50, 50, 30, 10], 50)).toBe(1);
  });

  it("returns array length for NaN value", () => {
    expect(computeRank([10, 20, 30], NaN)).toBe(3);
  });

  it("returns 1 when value is above all entries", () => {
    expect(computeRank([10, 20, 30], 100)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// ordinal
// ---------------------------------------------------------------------------
describe("ordinal", () => {
  it("handles 1st through 4th", () => {
    expect(ordinal(1)).toBe("1st");
    expect(ordinal(2)).toBe("2nd");
    expect(ordinal(3)).toBe("3rd");
    expect(ordinal(4)).toBe("4th");
  });

  it("handles teens (11th, 12th, 13th)", () => {
    expect(ordinal(11)).toBe("11th");
    expect(ordinal(12)).toBe("12th");
    expect(ordinal(13)).toBe("13th");
  });

  it("handles 21st, 22nd, 23rd", () => {
    expect(ordinal(21)).toBe("21st");
    expect(ordinal(22)).toBe("22nd");
    expect(ordinal(23)).toBe("23rd");
  });

  it("handles 101st", () => {
    expect(ordinal(101)).toBe("101st");
  });

  it("handles 111th (teen exception in hundreds)", () => {
    expect(ordinal(111)).toBe("111th");
  });

  it("handles 0th", () => {
    expect(ordinal(0)).toBe("0th");
  });
});

// ---------------------------------------------------------------------------
// chipColor
// ---------------------------------------------------------------------------
describe("chipColor", () => {
  it("returns green for top 10%", () => {
    expect(chipColor(1, 32)).toBe("#16a34a");
  });

  it("returns red for bottom 10%", () => {
    expect(chipColor(32, 32)).toBe("#dc2626");
  });

  it("returns dark slate for middle ranks", () => {
    expect(chipColor(16, 32)).toBe("#1e293b");
  });
});

// ---------------------------------------------------------------------------
// getHeatmapPercentile
// ---------------------------------------------------------------------------
describe("getHeatmapPercentile", () => {
  it("returns -1 for NaN value", () => {
    expect(getHeatmapPercentile([1, 2, 3], NaN)).toBe(-1);
  });

  it("returns -1 for empty array", () => {
    expect(getHeatmapPercentile([], 5)).toBe(-1);
  });

  it("returns correct percentile for a valid value", () => {
    expect(getHeatmapPercentile([10, 20, 30, 40, 50], 30)).toBe(40);
  });
});

// ---------------------------------------------------------------------------
// getHeatmapStyle
// ---------------------------------------------------------------------------
describe("getHeatmapStyle", () => {
  it("returns empty object for negative percentile (sentinel)", () => {
    expect(getHeatmapStyle(-1)).toEqual({});
  });

  it("returns green styling for 90th+ percentile", () => {
    const style = getHeatmapStyle(95);
    expect(style).toHaveProperty("fontWeight", 600);
    expect(style.color).toBe("#15803d");
  });

  it("returns red styling for 10th or below percentile", () => {
    const style = getHeatmapStyle(5);
    expect(style).toHaveProperty("fontWeight", 600);
    expect(style.color).toBe("#dc2626");
  });

  it("returns empty object for middle percentiles", () => {
    expect(getHeatmapStyle(50)).toEqual({});
  });

  it("inverts when inverted=true (low percentile becomes green)", () => {
    // percentile=5, inverted → effective = 95 → green
    const style = getHeatmapStyle(5, true);
    expect(style.color).toBe("#15803d");
  });
});
