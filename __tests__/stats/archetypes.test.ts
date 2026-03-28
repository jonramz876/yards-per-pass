import { describe, it, expect } from "vitest";
import { classifyQB, classifyWR, classifyTE, classifyRB } from "@/lib/stats/archetypes";

// ---------------------------------------------------------------------------
// classifyQB
// ---------------------------------------------------------------------------
describe("classifyQB", () => {
  // Axes: [Efficiency, Accuracy, Volume, Depth, BallSecurity, Consistency, Rush]

  it("returns null for 6-element array (requires 7)", () => {
    expect(classifyQB([80, 80, 80, 80, 80, 80])).toBeNull();
  });

  it("returns Dual Threat for elite rusher with strong passing", () => {
    // rush >= 80, eff >= 60, above60 >= 4
    const result = classifyQB([70, 65, 70, 65, 50, 60, 85]);
    expect(result).not.toBeNull();
    expect(result!.label).toBe("Dual Threat");
  });

  it("returns Mobile Playmaker for good rusher with passing volume", () => {
    // rush >= 65, eff >= 60, vol >= 55
    const result = classifyQB([65, 50, 60, 50, 50, 50, 70]);
    expect(result).not.toBeNull();
    expect(result!.label).toBe("Mobile Playmaker");
  });

  it("returns Complete Passer when 4+ axes >= 70 and none below 30", () => {
    const result = classifyQB([80, 80, 80, 80, 80, 80, 40]);
    expect(result).not.toBeNull();
    expect(result!.label).toBe("Complete Passer");
  });

  it("returns null when all percentiles are at 20 (no match)", () => {
    expect(classifyQB([20, 20, 20, 20, 20, 20, 20])).toBeNull();
  });

  it("returns Gunslinger for high depth + volume + low ball security", () => {
    // depth >= 65, vol >= 55, ballSec <= 45
    const result = classifyQB([50, 40, 60, 75, 30, 40, 20]);
    expect(result).not.toBeNull();
    expect(result!.label).toBe("Gunslinger");
  });

  it("returns Surgeon for high accuracy + consistency + efficiency", () => {
    // acc >= 70, cons >= 65, eff >= 55
    const result = classifyQB([60, 75, 40, 40, 50, 70, 20]);
    expect(result).not.toBeNull();
    expect(result!.label).toBe("Surgeon");
  });

  it("returns Distributor for high volume + accuracy + low depth", () => {
    // vol >= 70, acc >= 60, depth <= 45
    const result = classifyQB([45, 65, 75, 40, 50, 50, 20]);
    expect(result).not.toBeNull();
    expect(result!.label).toBe("Distributor");
  });

  it("returns Game Manager for high consistency + ball security + low volume", () => {
    // cons >= 65, ballSec >= 65, vol <= 45
    const result = classifyQB([40, 40, 40, 40, 70, 70, 20]);
    expect(result).not.toBeNull();
    expect(result!.label).toBe("Game Manager");
  });

  it("returns Playmaker for high efficiency + volume + consistency", () => {
    // eff >= 70, vol >= 70, cons >= 60
    const result = classifyQB([75, 50, 75, 40, 50, 65, 20]);
    expect(result).not.toBeNull();
    expect(result!.label).toBe("Playmaker");
  });

  it("returns Sniper for high depth + ball security + low rush", () => {
    // depth >= 65, ballSec >= 65, rush < 75
    const result = classifyQB([40, 40, 40, 70, 70, 40, 20]);
    expect(result).not.toBeNull();
    expect(result!.label).toBe("Sniper");
  });

  it("does NOT return Sniper when rush >= 75 (mobile QB exclusion)", () => {
    // Same as Sniper test but rush = 80 → should NOT match Sniper
    const result = classifyQB([40, 40, 40, 70, 70, 40, 80]);
    // With rush=80 but eff<60, won't match Dual Threat or Mobile Playmaker either
    // Falls through to Improviser or null
    expect(result === null || result.label !== "Sniper").toBe(true);
  });

  it("all archetypes have a glossaryAnchor field", () => {
    const completePasser = classifyQB([80, 80, 80, 80, 80, 80, 40]);
    expect(completePasser!.glossaryAnchor).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// classifyWR
// ---------------------------------------------------------------------------
describe("classifyWR", () => {
  // Axes: [Volume, Efficiency, Catch, Downfield, AfterCatch, Consistency]

  it("returns Alpha WR1 when 4+ axes >= 70, vol >= 65, none below 30", () => {
    const result = classifyWR([80, 80, 80, 80, 80, 80]);
    expect(result).not.toBeNull();
    expect(result!.label).toBe("Alpha WR1");
  });

  it("returns null when all percentiles are at 20", () => {
    expect(classifyWR([20, 20, 20, 20, 20, 20])).toBeNull();
  });

  it("returns YAC Monster for high YAC + low downfield", () => {
    // yac >= 75, downfield <= 50
    const result = classifyWR([50, 50, 50, 40, 80, 50]);
    expect(result).not.toBeNull();
    expect(result!.label).toBe("YAC Monster");
  });

  it("returns Target Magnet for very high volume", () => {
    // vol >= 80 (and not matching earlier patterns)
    const result = classifyWR([85, 40, 40, 40, 40, 40]);
    expect(result).not.toBeNull();
    expect(result!.label).toBe("Target Magnet");
  });

  it("returns Contested Catch WR for high downfield + catch rate", () => {
    // downfield >= 65, catch >= 60
    const result = classifyWR([50, 50, 65, 70, 40, 50]);
    expect(result).not.toBeNull();
    expect(result!.label).toBe("Contested Catch WR");
  });

  it("returns Field Stretcher for high downfield + low catch rate", () => {
    // downfield >= 75, catch <= 50
    const result = classifyWR([50, 50, 45, 80, 40, 50]);
    expect(result).not.toBeNull();
    expect(result!.label).toBe("Field Stretcher");
  });

  it("returns Possession Receiver for high catch + consistency + low downfield", () => {
    // catch >= 70, cons >= 60, downfield <= 45
    const result = classifyWR([50, 50, 75, 40, 40, 65]);
    expect(result).not.toBeNull();
    expect(result!.label).toBe("Possession Receiver");
  });
});

// ---------------------------------------------------------------------------
// classifyTE
// ---------------------------------------------------------------------------
describe("classifyTE", () => {
  // Axes: [Volume, Efficiency, Catch, Downfield, AfterCatch, Consistency]

  it("returns Elite TE1 when 4+ axes >= 70, vol >= 60, none below 30", () => {
    const result = classifyTE([80, 80, 80, 80, 80, 80]);
    expect(result).not.toBeNull();
    expect(result!.label).toBe("Elite TE1");
  });

  it("returns null when all percentiles are at 40 (no match)", () => {
    expect(classifyTE([40, 40, 40, 40, 40, 40])).toBeNull();
  });

  it("returns Seam Stretcher for high downfield + efficiency", () => {
    // downfield >= 70, eff >= 50
    const result = classifyTE([40, 55, 40, 75, 40, 40]);
    expect(result).not.toBeNull();
    expect(result!.label).toBe("Seam Stretcher");
  });

  it("returns YAC Weapon for high YAC + low downfield", () => {
    // yac >= 70, downfield <= 55
    const result = classifyTE([40, 40, 40, 50, 75, 40]);
    expect(result).not.toBeNull();
    expect(result!.label).toBe("YAC Weapon");
  });

  it("returns Security Blanket for high catch + volume", () => {
    // catch >= 70, vol >= 55
    const result = classifyTE([60, 40, 75, 40, 40, 40]);
    expect(result).not.toBeNull();
    expect(result!.label).toBe("Security Blanket");
  });

  it("returns Blocking TE for very low volume + consistency", () => {
    // vol <= 25, cons <= 35
    const result = classifyTE([20, 40, 40, 40, 40, 30]);
    expect(result).not.toBeNull();
    expect(result!.label).toBe("Blocking TE");
  });
});

// ---------------------------------------------------------------------------
// classifyRB
// ---------------------------------------------------------------------------
describe("classifyRB", () => {
  // Axes: [Volume, Efficiency, Power, Explosiveness, Receiving, Consistency]

  it("returns Three-Down Back when all conditions met", () => {
    // vol >= 55, rec >= 60, cons >= 55, 2+ of [eff,power,explosive,cons] >= 55, none below 30
    const result = classifyRB([70, 60, 60, 60, 70, 60]);
    expect(result).not.toBeNull();
    expect(result!.label).toBe("Three-Down Back");
  });

  it("returns null when all percentiles are at 40", () => {
    expect(classifyRB([40, 40, 40, 40, 40, 40])).toBeNull();
  });

  it("returns Elite Runner for 3+ rush axes >= 70 and vol >= 55", () => {
    // rushAxes = [eff, power, explosive, cons], 3+ >= 70
    const result = classifyRB([60, 75, 75, 75, 30, 75]);
    expect(result).not.toBeNull();
    expect(result!.label).toBe("Elite Runner");
  });

  it("returns Workhorse for high volume + moderate eff + low receiving", () => {
    // vol >= 70, eff >= 45, rec <= 45
    const result = classifyRB([75, 50, 50, 40, 35, 50]);
    expect(result).not.toBeNull();
    expect(result!.label).toBe("Workhorse");
  });

  it("returns Home Run Hitter for high explosiveness + low consistency", () => {
    // explosive >= 75, cons <= 45
    const result = classifyRB([40, 40, 40, 80, 40, 35]);
    expect(result).not.toBeNull();
    expect(result!.label).toBe("Home Run Hitter");
  });

  it("returns Pass-Catching Back for high receiving + low volume", () => {
    // rec >= 75, vol <= 50
    const result = classifyRB([45, 40, 40, 40, 80, 40]);
    expect(result).not.toBeNull();
    expect(result!.label).toBe("Pass-Catching Back");
  });

  it("returns Power Back for high power + vol + low explosiveness", () => {
    // power >= 70, vol >= 50, explosive <= 55
    const result = classifyRB([55, 40, 75, 50, 40, 40]);
    expect(result).not.toBeNull();
    expect(result!.label).toBe("Power Back");
  });

  it("returns Bell Cow for extreme volume", () => {
    // vol >= 85 (and doesn't match earlier patterns due to low other stats)
    const result = classifyRB([90, 30, 40, 40, 40, 40]);
    expect(result).not.toBeNull();
    expect(result!.label).toBe("Bell Cow");
  });
});
