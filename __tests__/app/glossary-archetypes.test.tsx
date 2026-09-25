// Spec A §4.10 (T7b, T7c): every archetype entry on /glossary states the rule
// lib/stats/archetypes.ts applies. One row per entry (43). Each row checks the
// entry's threshold phrases, then runs the classifier on:
//   - a PASS vector sitting exactly on every threshold -> returns that anchor;
//   - one FAIL vector per threshold, moved one point past it (29 for a "no axis
//     below the 30th" clause) -> does not.
// Axes the rule doesn't name sit at 50 unless that would hit an earlier
// archetype in code order (noted where so). Rows for entries whose text did not
// change pass today by design; moving any threshold in archetypes.ts by one
// point fails that row.
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import GlossaryPage from "@/app/glossary/page";
import { classifyQB, classifyWR, classifyTE, classifyRB, type Archetype } from "@/lib/stats/archetypes";

type Classify = (p: number[]) => Archetype | null;
type Row = {
  anchor: string;
  classify: Classify;
  fragments: string[];
  pass: number[][];
  fail: number[][];
};

// Axis orders (lib/stats/archetypes.ts):
//   QB  [EPA/DB, CPOE, DB/Game, aDOT, Ball Security, Success%, Rush EPA]
//   WR/TE [Tgt/Game, EPA/Tgt, CROE, aDOT, YAC/Rec, YPRR]
//   RB  [Car/Game, EPA/Car, Stuff Avoid, Explosive%, Tgt/Game, Success%]
const GE = "≥";
const LE = "≤";

const QB: Row[] = [
  {
    anchor: "dual-threat", classify: classifyQB,
    fragments: [`Rush EPA ${GE} 80th`, `EPA/DB ${GE} 50th`, `4+ axes ${GE} 60th`],
    pass: [[50, 60, 60, 60, 50, 50, 80]],
    fail: [[50, 60, 60, 60, 50, 50, 79], [49, 60, 60, 60, 50, 50, 80], [50, 60, 60, 59, 50, 50, 80]],
  },
  {
    anchor: "mobile-playmaker", classify: classifyQB,
    fragments: [`Rush EPA ${GE} 70th`, `EPA/DB ${GE} 55th`, `DB/Game ${GE} 50th`, `CPOE ${GE} 70th and Success% ${GE} 65th`],
    pass: [[55, 50, 50, 50, 50, 50, 70]],
    fail: [[55, 50, 50, 50, 50, 50, 69], [54, 50, 50, 50, 50, 50, 70], [55, 50, 49, 50, 50, 50, 70], [55, 70, 50, 50, 50, 65, 70]],
  },
  {
    anchor: "complete-passer", classify: classifyQB,
    fragments: ["4+ of the 7 radar axes at the 70th percentile or above", "none below the 30th", "Ball Security", "Rush EPA", "fewer than 60 rushes (fully counted at 60)"],
    pass: [[70, 70, 70, 70, 50, 50, 50]],
    fail: [[70, 70, 70, 69, 50, 50, 50], [70, 70, 70, 70, 29, 50, 50]],
  },
  {
    anchor: "playmaker", classify: classifyQB,
    fragments: [`EPA/DB ${GE} 70th`, `DB/Game ${GE} 70th`, `Success% ${GE} 60th`],
    pass: [[70, 50, 70, 50, 50, 60, 50]],
    fail: [[69, 50, 70, 50, 50, 60, 50], [70, 50, 69, 50, 50, 60, 50], [70, 50, 70, 50, 50, 59, 50]],
  },
  {
    anchor: "gunslinger", classify: classifyQB,
    fragments: [`aDOT ${GE} 65th`, `DB/Game ${GE} 55th`, `Ball Security ${LE} 45th`],
    pass: [[50, 50, 55, 65, 45, 50, 50]],
    fail: [[50, 50, 55, 64, 45, 50, 50], [50, 50, 54, 65, 45, 50, 50], [50, 50, 55, 65, 46, 50, 50]],
  },
  {
    anchor: "surgeon", classify: classifyQB,
    fragments: [`CPOE ${GE} 70th`, `Success% ${GE} 65th`, `EPA/DB ${GE} 55th`],
    pass: [[55, 70, 50, 50, 50, 65, 50]],
    fail: [[55, 69, 50, 50, 50, 65, 50], [55, 70, 50, 50, 50, 64, 50], [54, 70, 50, 50, 50, 65, 50]],
  },
  {
    anchor: "distributor", classify: classifyQB,
    fragments: [`DB/Game ${GE} 70th`, `CPOE ${GE} 60th`, `aDOT ${LE} 45th`],
    pass: [[50, 60, 70, 45, 50, 50, 50]],
    fail: [[50, 60, 69, 45, 50, 50, 50], [50, 59, 70, 45, 50, 50, 50], [50, 60, 70, 46, 50, 50, 50]],
  },
  {
    anchor: "volume-passer", classify: classifyQB,
    fragments: [`DB/Game ${GE} 80th`, `EPA/DB ${GE} 50th`],
    pass: [[50, 50, 80, 50, 50, 50, 50]],
    fail: [[50, 50, 79, 50, 50, 50, 50], [49, 50, 80, 50, 50, 50, 50]],
  },
  {
    anchor: "game-manager", classify: classifyQB,
    fragments: [`Success% ${GE} 65th`, `Ball Security ${GE} 65th`, `DB/Game ${LE} 45th`],
    pass: [[50, 50, 45, 50, 65, 65, 50]],
    fail: [[50, 50, 45, 50, 65, 64, 50], [50, 50, 45, 50, 64, 65, 50], [50, 50, 46, 50, 65, 65, 50]],
  },
  {
    // CPOE on its threshold (40), Rush EPA one under its "< 75th".
    anchor: "sniper", classify: classifyQB,
    fragments: [`aDOT ${GE} 65th`, `Ball Security ${GE} 65th`, `CPOE ${GE} 40th`, "Rush EPA < 75th"],
    pass: [[50, 40, 50, 65, 65, 50, 74]],
    fail: [[50, 40, 50, 64, 65, 50, 74], [50, 40, 50, 65, 64, 50, 74], [50, 39, 50, 65, 65, 50, 74], [50, 40, 50, 65, 65, 50, 75]],
  },
  {
    anchor: "improviser", classify: classifyQB,
    fragments: [`EPA/DB ${GE} 65th`, `3+ axes ${GE} 60th`, `CPOE ${LE} 50th`],
    pass: [[65, 50, 60, 60, 50, 50, 50]],
    fail: [[64, 50, 60, 60, 50, 50, 50], [65, 50, 60, 59, 50, 50, 50], [65, 51, 60, 60, 50, 50, 50]],
  },
  {
    anchor: "pocket-passer", classify: classifyQB,
    fragments: ["at least one axis at or above the 60th percentile", "in the order listed on this page"],
    pass: [[60, 50, 50, 50, 50, 50, 50]],
    fail: [[59, 50, 50, 50, 50, 50, 50]],
  },
];

const WR: Row[] = [
  {
    anchor: "alpha-wr1", classify: classifyWR,
    fragments: [
      `4+ of the six radar axes (Tgt/Game, EPA/Tgt, CROE, aDOT, YAC/Rec, YPRR) ${GE} 70th`,
      `Tgt/Game ${GE} 65th`, "no axis below the 30th",
      `Tgt/Game ${GE} 80th with 3+ axes ${GE} 70th, 4+ axes ${GE} 60th, and at most one axis below the 30th`,
    ],
    pass: [
      [65, 70, 70, 70, 70, 50],
      // Volume path: Tgt/Game counts as one of the three 70s; one axis at 29.
      [80, 70, 70, 50, 29, 60],
    ],
    fail: [
      [64, 70, 70, 70, 70, 50], [65, 70, 70, 70, 69, 50], [65, 70, 70, 70, 70, 29],
      [79, 70, 70, 50, 29, 60], [80, 69, 70, 50, 29, 60], [80, 70, 70, 50, 29, 59], [80, 70, 70, 29, 29, 60],
    ],
  },
  {
    anchor: "contested-catch-wr", classify: classifyWR,
    fragments: [`aDOT ${GE} 65th`, `CROE ${GE} 60th`],
    pass: [[50, 50, 60, 65, 50, 50]],
    fail: [[50, 50, 60, 64, 50, 50], [50, 50, 59, 65, 50, 50]],
  },
  {
    anchor: "yac-monster", classify: classifyWR,
    fragments: [`YAC/Rec ${GE} 75th`, `aDOT ${LE} 40th`, `Tgt/Game ${LE} 75th`, `checked after Playmaker, YAC/Rec ${GE} 80th and aDOT ${LE} 50th`],
    pass: [[75, 50, 50, 40, 75, 50], [50, 50, 50, 50, 80, 50]],
    fail: [[75, 50, 50, 40, 74, 50], [75, 50, 50, 41, 75, 50], [76, 50, 50, 40, 75, 50], [50, 50, 50, 50, 79, 50], [50, 50, 50, 51, 80, 50]],
  },
  {
    anchor: "target-magnet", classify: classifyWR,
    fragments: [`Tgt/Game ${GE} 78th percentile`, `2+ axes ${GE} 60th`],
    pass: [[78, 60, 50, 50, 50, 50]],
    fail: [[77, 60, 50, 50, 50, 50], [78, 59, 50, 50, 50, 50]],
  },
  {
    anchor: "field-stretcher", classify: classifyWR,
    fragments: [`aDOT ${GE} 75th`, `CROE ${LE} 50th`],
    pass: [[50, 50, 50, 75, 50, 50]],
    fail: [[50, 50, 50, 74, 50, 50], [50, 50, 51, 75, 50, 50]],
  },
  {
    // CROE at 60 makes the third axis at 60.
    anchor: "route-technician", classify: classifyWR,
    fragments: [`YPRR ${GE} 70th`, `Tgt/G ${GE} 55th`, `3+ axes ${GE} 60th`],
    pass: [[55, 60, 60, 50, 50, 70]],
    fail: [[55, 60, 60, 50, 50, 69], [54, 60, 60, 50, 50, 70], [55, 60, 59, 50, 50, 70]],
  },
  {
    anchor: "possession-receiver", classify: classifyWR,
    fragments: [`CROE ${GE} 70th`, `YPRR ${GE} 60th`, `aDOT ${LE} 45th`],
    pass: [[50, 50, 70, 45, 50, 60]],
    fail: [[50, 50, 69, 45, 50, 60], [50, 50, 70, 45, 50, 59], [50, 50, 70, 46, 50, 60]],
  },
  {
    // CROE at 55: at 50 Field Stretcher (CROE <= 50) would claim it first.
    anchor: "deep-threat", classify: classifyWR,
    fragments: [`aDOT ${GE} 80th percentile`],
    pass: [[50, 50, 55, 80, 50, 50]],
    fail: [[50, 50, 55, 79, 50, 50]],
  },
  {
    anchor: "efficient-producer", classify: classifyWR,
    fragments: [`YPRR ${GE} 75th`, `EPA/Tgt ${GE} 65th`, `Tgt/Game ${LE} 50th`],
    pass: [[50, 65, 50, 50, 50, 75]],
    fail: [[50, 65, 50, 50, 50, 74], [50, 64, 50, 50, 50, 75], [51, 65, 50, 50, 50, 75]],
  },
  {
    anchor: "playmaker-wr", classify: classifyWR,
    fragments: [`EPA/Tgt ${GE} 65th`, `YAC/Rec ${GE} 65th`, `3+ axes ${GE} 60th`],
    pass: [[50, 65, 60, 50, 65, 50]],
    fail: [[50, 64, 60, 50, 65, 50], [50, 65, 60, 50, 64, 50], [50, 65, 59, 50, 65, 50]],
  },
  {
    anchor: "role-player-wr", classify: classifyWR,
    fragments: ["at least one axis at or above the 60th percentile", "checked in the order listed"],
    pass: [[60, 50, 50, 50, 50, 50]],
    fail: [[59, 50, 50, 50, 50, 50]],
  },
];

const TE: Row[] = [
  {
    anchor: "elite-te1", classify: classifyTE,
    fragments: [
      `4+ of the six radar axes (Tgt/Game, EPA/Tgt, CROE, aDOT, YAC/Rec, YPRR) at the 70th percentile or above among TEs`,
      `Tgt/Game ${GE} 60th`, "no axis below the 30th",
      `Tgt/Game ${GE} 90th with EPA/Tgt ${GE} 65th, 3+ axes ${GE} 70th, and 4+ axes ${GE} 60th`,
    ],
    pass: [[60, 70, 70, 70, 70, 50], [90, 65, 70, 70, 50, 50]],
    fail: [
      [59, 70, 70, 70, 70, 50], [60, 70, 70, 70, 69, 50], [60, 70, 70, 70, 70, 29],
      [89, 65, 70, 70, 50, 50], [90, 64, 70, 70, 50, 50], [90, 65, 69, 70, 50, 50],
      // 3 axes >= 70 (Tgt/Game, EPA/Tgt, CROE) but only 3 >= 60.
      [90, 70, 70, 50, 50, 50],
    ],
  },
  {
    anchor: "mismatch-te", classify: classifyTE,
    fragments: [`EPA/Tgt ${GE} 70th`, `CROE ${GE} 60th`, `Tgt/Game ${GE} 40th`],
    pass: [[40, 70, 60, 50, 50, 50]],
    fail: [[40, 69, 60, 50, 50, 50], [40, 70, 59, 50, 50, 50], [39, 70, 60, 50, 50, 50]],
  },
  {
    anchor: "seam-stretcher", classify: classifyTE,
    fragments: [`aDOT ${GE} 70th`, `EPA/Tgt ${GE} 50th`],
    pass: [[50, 50, 50, 70, 50, 50]],
    fail: [[50, 50, 50, 69, 50, 50], [50, 49, 50, 70, 50, 50]],
  },
  {
    anchor: "yac-weapon-te", classify: classifyTE,
    fragments: [`YAC/Rec ${GE} 70th`, `aDOT ${LE} 55th`],
    pass: [[50, 50, 50, 55, 70, 50]],
    fail: [[50, 50, 50, 55, 69, 50], [50, 50, 50, 56, 70, 50]],
  },
  {
    anchor: "security-blanket", classify: classifyTE,
    fragments: [`CROE ${GE} 70th`, `Tgt/Game ${GE} 55th`],
    pass: [[55, 50, 70, 50, 50, 50]],
    fail: [[55, 50, 69, 50, 50, 50], [54, 50, 70, 50, 50, 50]],
  },
  {
    anchor: "move-te", classify: classifyTE,
    fragments: [`YPRR ${GE} 70th`, `EPA/Tgt ${GE} 55th`, `Tgt/Game ${GE} 50th`],
    pass: [[50, 55, 50, 50, 50, 70]],
    fail: [[50, 55, 50, 50, 50, 69], [50, 54, 50, 50, 50, 70], [49, 55, 50, 50, 50, 70]],
  },
  {
    anchor: "target-hog-te", classify: classifyTE,
    fragments: [`Tgt/Game ${GE} 80th percentile`],
    pass: [[80, 50, 50, 50, 50, 50]],
    fail: [[79, 50, 50, 50, 50, 50]],
  },
  {
    anchor: "blocking-te", classify: classifyTE,
    fragments: [`Tgt/Game ${LE} 25th`, `YPRR ${LE} 35th`],
    pass: [[25, 50, 50, 50, 50, 35]],
    fail: [[26, 50, 50, 50, 50, 35], [25, 50, 50, 50, 50, 36]],
  },
  {
    anchor: "complementary-te", classify: classifyTE,
    fragments: ["at least one axis at or above the 70th percentile", `Tgt/Game ${GE} 50th`, "checked in the order listed"],
    pass: [[50, 50, 50, 50, 50, 50], [40, 50, 50, 50, 50, 70]],
    fail: [[49, 50, 50, 50, 50, 50], [40, 50, 50, 50, 50, 69]],
  },
];

const RB: Row[] = [
  {
    anchor: "three-down-back", classify: classifyRB,
    fragments: [`Car/Game ${GE} 55th`, `Tgt/Game ${GE} 60th`, `Success% ${GE} 55th`, `2+ of EPA/Car, Stuff Avoid, Explosive%, Success% ${GE} 55th`, "no axis below the 30th"],
    pass: [[55, 55, 50, 50, 60, 55]],
    fail: [[54, 55, 50, 50, 60, 55], [55, 55, 50, 50, 59, 55], [55, 55, 50, 50, 60, 54], [55, 54, 50, 50, 60, 55], [55, 55, 29, 50, 60, 55]],
  },
  {
    anchor: "elite-runner-rb", classify: classifyRB,
    fragments: ["3+ of EPA/Car, Stuff Avoid, Explosive%, Success% at or above the 70th percentile", `Car/Game ${GE} 55th`],
    pass: [[55, 70, 70, 70, 50, 50]],
    fail: [[54, 70, 70, 70, 50, 50], [55, 70, 70, 69, 50, 50]],
  },
  {
    anchor: "dual-threat-back", classify: classifyRB,
    fragments: [`Car/Game ${GE} 55th`, `Tgt/Game ${GE} 70th`],
    pass: [[55, 50, 50, 50, 70, 50]],
    fail: [[54, 50, 50, 50, 70, 50], [55, 50, 50, 50, 69, 50]],
  },
  {
    anchor: "workhorse", classify: classifyRB,
    fragments: [`Car/Game ${GE} 70th`, `EPA/Car ${GE} 45th`, `Tgt/Game ${LE} 45th`],
    pass: [[70, 45, 50, 50, 45, 50]],
    fail: [[69, 45, 50, 50, 45, 50], [70, 44, 50, 50, 45, 50], [70, 45, 50, 50, 46, 50]],
  },
  {
    anchor: "power-back", classify: classifyRB,
    fragments: [`Stuff Avoid ${GE} 70th`, `Car/Game ${GE} 50th`, `Explosive% ${LE} 55th`],
    pass: [[50, 50, 70, 55, 50, 50]],
    fail: [[50, 50, 69, 55, 50, 50], [49, 50, 70, 55, 50, 50], [50, 50, 70, 56, 50, 50]],
  },
  {
    anchor: "home-run-hitter", classify: classifyRB,
    fragments: [`Explosive% ${GE} 75th`, `Success% ${LE} 45th`],
    pass: [[50, 50, 50, 75, 50, 45]],
    fail: [[50, 50, 50, 74, 50, 45], [50, 50, 50, 75, 50, 46]],
  },
  {
    anchor: "pass-catching-back", classify: classifyRB,
    fragments: [`Tgt/Game ${GE} 75th`, `Car/Game ${LE} 50th`],
    pass: [[50, 50, 50, 50, 75, 50]],
    fail: [[50, 50, 50, 50, 74, 50], [51, 50, 50, 50, 75, 50]],
  },
  {
    anchor: "efficient-runner", classify: classifyRB,
    fragments: [`EPA/Car ${GE} 70th`, `Success% ${GE} 60th`, `Car/Game ${LE} 55th`],
    pass: [[55, 70, 50, 50, 50, 60]],
    fail: [[55, 69, 50, 50, 50, 60], [55, 70, 50, 50, 50, 59], [56, 70, 50, 50, 50, 60]],
  },
  {
    anchor: "change-of-pace", classify: classifyRB,
    fragments: [`EPA/Car ${GE} 65th`, `Explosive% ${GE} 60th`, `Car/Game ${LE} 40th`],
    pass: [[40, 65, 50, 60, 50, 50]],
    fail: [[40, 64, 50, 60, 50, 50], [40, 65, 50, 59, 50, 50], [41, 65, 50, 60, 50, 50]],
  },
  {
    anchor: "bell-cow", classify: classifyRB,
    fragments: [`Car/Game ${GE} 85th percentile`],
    pass: [[85, 50, 50, 50, 50, 50]],
    fail: [[84, 50, 50, 50, 50, 50]],
  },
  {
    anchor: "rotational-back", classify: classifyRB,
    fragments: ["at least one of EPA/Car, Stuff Avoid, Explosive%, Tgt/Game, Success% at or above the 60th percentile", `Car/Game ${GE} 40th`, "checked in the order listed"],
    pass: [[40, 50, 50, 50, 50, 50], [30, 60, 50, 50, 50, 50]],
    fail: [[39, 50, 50, 50, 50, 50], [30, 59, 50, 50, 50, 50]],
  },
];

const ALL = [...QB, ...WR, ...TE, ...RB];

function glossary(): HTMLElement {
  return render(<GlossaryPage />).container;
}

describe("archetype entries match lib/stats/archetypes.ts (T7b)", () => {
  it("covers every archetype entry on the page, 43 in all", () => {
    expect(ALL).toHaveLength(43);
    const onPage = Array.from(glossary().querySelectorAll("dt"))
      .filter((dt) => /Archetype\)$/.test(dt.textContent ?? ""))
      .map((dt) => dt.parentElement!.id);
    expect([...onPage].sort()).toEqual(ALL.map((r) => r.anchor).sort());
  });

  it.each(ALL.map((r) => [r.anchor, r] as const))("%s", (anchor, row) => {
    const dd = glossary().querySelector(`#${anchor} dd`);
    expect(dd, anchor).not.toBeNull();
    const text = dd!.textContent ?? "";
    for (const f of row.fragments) expect(text, `${anchor}: "${f}"`).toContain(f);
    for (const v of row.pass) expect(row.classify(v)?.glossaryAnchor, `pass ${JSON.stringify(v)}`).toBe(anchor);
    for (const v of row.fail) expect(row.classify(v)?.glossaryAnchor, `fail ${JSON.stringify(v)}`).not.toBe(anchor);
  });
});

describe("archetype order on the page is the order the code checks (T7c)", () => {
  // lib/stats/archetypes.ts: first match wins, in these orders.
  const CODE_ORDER: Record<string, string[]> = {
    "QB Archetypes": [
      "dual-threat", "mobile-playmaker", "complete-passer", "playmaker", "gunslinger", "surgeon",
      "distributor", "volume-passer", "game-manager", "sniper", "improviser", "pocket-passer",
    ],
    "WR Archetypes": [
      "alpha-wr1", "contested-catch-wr", "yac-monster", "target-magnet", "field-stretcher", "route-technician",
      "possession-receiver", "deep-threat", "efficient-producer", "playmaker-wr", "role-player-wr",
    ],
    "TE Archetypes": [
      "elite-te1", "mismatch-te", "seam-stretcher", "yac-weapon-te", "security-blanket", "move-te",
      "target-hog-te", "blocking-te", "complementary-te",
    ],
    "RB Archetypes": [
      "three-down-back", "elite-runner-rb", "dual-threat-back", "workhorse", "power-back", "home-run-hitter",
      "pass-catching-back", "efficient-runner", "change-of-pace", "bell-cow", "rotational-back",
    ],
  };

  it.each(Object.entries(CODE_ORDER))("%s", (section, order) => {
    const entries = Array.from(glossary().querySelectorAll("dl > div"));
    const start = entries.findIndex((d) => d.querySelector("h2")?.textContent === section);
    expect(start, section).toBeGreaterThanOrEqual(0);
    expect(entries.slice(start, start + order.length).map((d) => d.id)).toEqual(order);
  });

  it("a QB who meets both Dual Threat and Complete Passer is Dual Threat, and the page lists it first", () => {
    // Passes today by design; swapping the Dual Threat and Complete Passer
    // blocks in archetypes.ts makes it fail.
    const both = [70, 70, 70, 70, 50, 50, 80];
    expect(classifyQB(both)?.glossaryAnchor).toBe("dual-threat");
    const ids = Array.from(glossary().querySelectorAll("dl > div")).map((d) => d.id);
    expect(ids.indexOf("dual-threat")).toBeGreaterThanOrEqual(0);
    expect(ids.indexOf("dual-threat")).toBeLessThan(ids.indexOf("complete-passer"));
  });
});
