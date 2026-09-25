// Spec A §4.9 (T7a, T7d): the glossary's stat definitions say what the code
// computes. The paired pytest pins in tests/ (spec A T13) tie several of these
// sentences to scripts/ingest.py; this file checks the page a visitor reads.
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import GlossaryPage from "@/app/glossary/page";

function page(): HTMLElement {
  return render(<GlossaryPage />).container;
}

/** The definition under a term, found by anchor id or by its exact dt text. */
function dd(container: HTMLElement, key: { id?: string; term?: string }): string {
  if (key.id) {
    const el = container.querySelector(`#${key.id} dd`);
    if (!el) throw new Error(`no entry #${key.id}`);
    return el.textContent ?? "";
  }
  const dt = Array.from(container.querySelectorAll("dt")).find((d) => d.textContent === key.term);
  if (!dt) throw new Error(`no entry "${key.term}"`);
  return dt.nextElementSibling?.textContent ?? "";
}

const OLD_FALSE = [
  "Above 0 = above average",
  "above-average rushing",
  "above-average efficiency",
  "40%/50%/100%",
  "excludes sacks from the denominator",
  "counts all play types",
  "across all plays",
  "chooses to pass",
];

// [entry, fragments its new wording must contain]
const ENTRIES: [{ id?: string; term?: string }, string[]][] = [
  [{ term: "EPA (Expected Points Added)" }, ["zero is not the league average", "not with zero; grey means close to average"]],
  [{ term: "EPA/Play" }, ["dropbacks and designed runs (kneel-downs left out)"]],
  [
    { term: "Success Rate" },
    ["nflverse’s success flag, not a yards-to-go rule", "leaves sacks out of the denominator", "box score passing lines count them"],
  ],
  [{ term: "Rush EPA" }, ["compare a quarterback with other quarterbacks, not with zero"]],
  [{ term: "EPA/Carry" }, ["a back at 0.00 is above average"]],
  [{ term: "Off EPA/Play" }, ["plays wiped out by a penalty are left out", "close to zero, but not exactly zero"]],
  [
    { term: "Pass Rate" },
    ["Sacks count as plays but not as passes", "sacks as passes, kneel-downs left out"],
  ],
  [
    { term: "YPRR (Yards Per Route Run)" },
    ["any pass thrown while the player was on the field", "neither do spikes", "a season without it shows “—”"],
  ],
  [{ term: "TPRR (Targets Per Route Run)" }, ["Routes are counted as in YPRR", "player-participation data"]],
  [
    { term: "Snap Count" },
    ["Plays wiped out by a penalty, kneel-downs, spikes and two-point tries aren’t counted", "player-participation data"],
  ],
  [{ term: "Snap Share (Snap%)" }, ["his main team only", "player-participation data"]],
  [{ term: "Route Participation Rate (Route%)" }, ["his main team only", "player-participation data"]],
  [{ id: "total-epa" }, ["dropbacks for a quarterback", "designed runs aren’t included", "carries for a running back, targets for a receiver"]],
];

describe("glossary definitions (spec A §4.9)", () => {
  it.each(ENTRIES)("%o has the new wording and none of the false strings", (key, fragments) => {
    const text = dd(page(), key);
    for (const f of fragments) expect(text).toContain(f);
    for (const old of OLD_FALSE) expect(text).not.toContain(old);
  });

  it("no false string is left anywhere on the page", () => {
    const text = page().textContent ?? "";
    for (const old of OLD_FALSE) expect(text, old).not.toContain(old);
    // The Total EPA example that only held for dropback EPA is gone.
    expect(text).not.toContain("A QB with 50 Total EPA");
  });

  it("renders no literal \\u escape anywhere (T7d)", () => {
    expect(page().textContent).not.toMatch(/\\u[0-9a-fA-F]{4}/);
  });
});
