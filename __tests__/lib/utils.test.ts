import { describe, it, expect } from "vitest";
import { canonicalSeason, playerHref } from "@/lib/utils";

const SEASONS = [2026, 2025, 2024, 2023, 2022, 2021, 2020];

describe("playerHref", () => {
  it("carries a past season", () => {
    expect(playerHref("brock-bowers", 2024, 2026)).toBe("/player/brock-bowers?season=2024");
  });

  it("stays bare on the default season (the canonical URL)", () => {
    expect(playerHref("brock-bowers", 2026, 2026)).toBe("/player/brock-bowers");
  });

  it("stays bare when no season is given", () => {
    expect(playerHref("x")).toBe("/player/x");
    expect(playerHref("x", null, 2026)).toBe("/player/x");
    expect(playerHref("x", undefined, 2026)).toBe("/player/x");
  });

  it("an unknown default still carries the season (D7)", () => {
    expect(playerHref("x", 2025)).toBe("/player/x?season=2025");
    expect(playerHref("x", 2025, null)).toBe("/player/x?season=2025");
  });

  it("works for the player_id fallback and the oldest season", () => {
    expect(playerHref("00-0034857", 2020, 2026)).toBe("/player/00-0034857?season=2020");
  });

  it("never links a non-positive or non-integer season (M1)", () => {
    expect(playerHref("x", 0, 2026)).toBe("/player/x");
    expect(playerHref("x", NaN, 2026)).toBe("/player/x");
    expect(playerHref("x", 0)).toBe("/player/x");
  });
});

describe("canonicalSeason", () => {
  it.each([
    [undefined, null],
    ["2025", 2025],
    ["2020", 2020],
    ["2026", null],
    ["abc", null],
    ["1999", null],
    ["99999999999", null],
    ["-5", null],
    ["2025abc", 2025],
  ] as const)("%s → %s", (param, expected) => {
    expect(canonicalSeason(param, SEASONS)).toBe(expected);
  });

  it("no known seasons → bare", () => {
    expect(canonicalSeason("2025", [])).toBeNull();
  });
});
