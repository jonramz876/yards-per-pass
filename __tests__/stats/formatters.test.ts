import { describe, it, expect } from "vitest";
import { EM_DASH, formatRate, textColorForBackground } from "@/lib/stats/formatters";

describe("formatRate", () => {
  it("formats a 0–1 rate as a percentage", () => {
    expect(formatRate(0.876)).toBe("87.6%");
  });
  it("honors the decimals argument", () => {
    expect(formatRate(0.876, 0)).toBe("88%");
  });
  it("returns the em dash for NaN", () => {
    expect(formatRate(NaN)).toBe(EM_DASH);
  });
  // Guard is isFinite, not isNaN: a divide-by-zero rate used to render
  // "Infinity%" on the card instead of the em dash every other formatter uses.
  it("returns the em dash for Infinity", () => {
    expect(formatRate(Infinity)).toBe(EM_DASH);
    expect(formatRate(-Infinity)).toBe(EM_DASH);
  });
});

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
