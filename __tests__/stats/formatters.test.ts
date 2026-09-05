import { describe, it, expect } from "vitest";
import { textColorForBackground } from "@/lib/stats/formatters";

describe("textColorForBackground", () => {
  it("returns white on dark team colors", () => {
    expect(textColorForBackground("#00338D")).toBe("#ffffff"); // BUF navy
  });
  it("returns near-black on light team colors", () => {
    expect(textColorForBackground("#FB4F14")).toBe("#0f172a"); // CIN orange
  });
  it("tolerates malformed input", () => {
    expect(textColorForBackground("")).toBe("#ffffff");
  });

  // Threshold regression guard — real NFL primaries from lib/data/teams.ts.
  // Each expectation matches the color that actually wins the WCAG contrast
  // ratio against the given background, so tuning the threshold cannot
  // silently break a team's card band.
  it("picks white on genuinely dark team primaries", () => {
    expect(textColorForBackground("#97233F")).toBe("#ffffff"); // ARI cardinal
    expect(textColorForBackground("#101820")).toBe("#ffffff"); // CAR/PIT black
    expect(textColorForBackground("#0076B6")).toBe("#ffffff"); // DET blue
    expect(textColorForBackground("#203731")).toBe("#ffffff"); // GB forest green
    expect(textColorForBackground("#000000")).toBe("#ffffff"); // LV black
  });
  it("picks near-black on genuinely light team colors", () => {
    expect(textColorForBackground("#FFB612")).toBe("#0f172a"); // PIT gold
    expect(textColorForBackground("#D3BC8D")).toBe("#0f172a"); // NO gold
    expect(textColorForBackground("#008E97")).toBe("#0f172a"); // MIA aqua
    expect(textColorForBackground("#A5ACAF")).toBe("#0f172a"); // LV silver
  });
  it("accepts hex without a leading # and is case-insensitive", () => {
    expect(textColorForBackground("00338d")).toBe("#ffffff");
    expect(textColorForBackground("#fb4f14")).toBe("#0f172a");
  });
});
