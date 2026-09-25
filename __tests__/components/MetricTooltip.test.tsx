import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import MetricTooltip, { METRIC_DEFINITIONS as DEFINITION_TEXT } from "@/components/ui/MetricTooltip";
import { TooltipProvider } from "@/components/ui/tooltip";
import { buildComparison } from "@/lib/stats/box-score";
import { BUF_STATS, HOU_STATS } from "../fixtures/box-score-buf-hou";

describe("MetricTooltip — box score definitions (spec §4)", () => {
  it.each([
    ["EPA / play", "the way nflfastR and rbsdm.com do"],
    ["Success rate", "EPA above zero"],
    ["1st down rate", "penalty-wiped plays included"],
    ["Explosive plays", "QB scrambles of 10+ yards count as explosive runs"],
    ["Toxic differential", "Turnover margin plus explosive-play margin"],
    // Spec A §4.6: leaderboard entries whose old text was false.
    ["Success%", "EPA above zero"],
    ["Total EPA", "designed runs aren’t included"],
  ])("defines %s, and the popup a visitor opens says so", async (metric, fragment) => {
    render(
      <TooltipProvider delay={0}>
        <MetricTooltip metric={metric} />
      </TooltipProvider>
    );
    const trigger = screen.getByLabelText(`What is ${metric}?`);
    expect(trigger).toBeTruthy();
    // Asserting DEFINITION_TEXT alone is an assertion about the exported
    // object, not about anything rendered: all five cases passed with the
    // whole <TooltipContent> block deleted from the component. Open the real
    // popup and read what the visitor reads.
    fireEvent.pointerEnter(trigger);
    fireEvent.focus(trigger);
    await waitFor(() => {
      const popup = document.querySelector('[data-slot="tooltip-content"]');
      expect(popup).not.toBeNull();
      expect(popup!.textContent).toContain(metric);
      expect(popup!.textContent).toContain(fragment);
      // A definition authored with a literal escape rather than the character
      // it stands for would reach the visitor as "—".
      expect(popup!.textContent).not.toMatch(/\\u[0-9a-fA-F]{4}/);
    });
  });

  // The arithmetic on this page has 609 tests; the prose explaining it had
  // almost none, and shipped a definition that stated the opposite of what the
  // metric does. These two cases are the prose's tests: each pins a claim the
  // code either makes true or does not.
  it("puts penalty first downs INSIDE the 1st down rate, where the data has them", () => {
    // scripts/ingest.py's efficiency set filters on (pass | rush) + EPA present
    // + a possessing team — there is no no_play exclusion — and then counts
    // first_down == 1, which nflverse sets for a penalty first down too. The
    // page's own numbers say the same: BUF 36% x 56 plays = 20 = 13 passing +
    // 5 rushing + 2 penalty. A definition that excludes them is false.
    const text = DEFINITION_TEXT["1st down rate"];
    expect(text).toContain("penalty-wiped plays included");
    expect(text).not.toMatch(/not in it|isn’t in it|aren’t in it|excluded|leaves out/i);
    // ...and it must still warn that the Team stats total is a different set,
    // so rate x plays need not land on it (HOU: 32% x 79 = 25 against 26).
    expect(text).toContain("Team stats");
    expect(text).toMatch(/need not agree|can disagree/);
  });

  it("defines Tgt Share by team targets, which is what the ingest divides by", () => {
    // scripts/ingest.py:1114-1123 divides a receiver's targets by the team's
    // TOTAL TARGETS (target_plays, :1066: a receiver charged, a pass attempt,
    // no sack, no scramble) — never by pass attempts. The old wording sent a
    // reader to 6/29 for a number the site computes as 6/28.
    const text = DEFINITION_TEXT["Tgt Share"];
    expect(text).toMatch(/team\S* targets/i);
    expect(text).not.toMatch(/pass attempts/i);
  });

  it("defines every tooltip key the box score actually asks for", () => {
    // A renamed or typo'd key fails silently — MetricTooltip returns null and the
    // "i" badge just stops appearing, with no error and nothing for CI to catch.
    const keys = buildComparison(BUF_STATS, HOU_STATS)
      .flatMap((section) => section.rows)
      .map((row) => row.tooltip)
      .filter((key): key is string => Boolean(key));
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(DEFINITION_TEXT[key], `no definition for tooltip key "${key}"`).toBeTruthy();
    }
  });

  // The three leaderboard pages pass 48 tooltip keys between them and have no
  // tests of their own. This PR made METRIC_DEFINITIONS shared, so a rename —
  // or a tidy-up that merges the near-homograph pairs ("EPA / play" against
  // "EPA/Play", "Success rate" against "Success%") — would silently drop an
  // "i" badge from a leaderboard column: MetricTooltip returns null for an
  // unknown key, so there is no error, no failed render and nothing for CI to
  // catch. The whole key set is pinned by name, not by count.
  it("keeps every metric key the site asks for, by name", () => {
    const EXPECTED = [
      // QB leaderboard
      "EPA/Play", "EPA/DB", "CPOE", "Comp%", "Success%", "Sk", "Rush Att", "Rush EPA",
      "Sk Yds", "aDOT", "YPA", "ANY/A", "Rating", "Off EPA/Play", "Def EPA/Play", "FL",
      "TD:INT", "TD%", "INT%", "SK%", "SCR%", "AY%", "CROE",
      // Receiver leaderboard
      "EPA/Tgt", "Catch%", "ADOT", "YAC/Rec", "Tgt Share", "YPR", "YPRR", "TPRR",
      "Snaps", "Snap%", "Route%", "Total EPA",
      // RB leaderboard
      "EPA/Car", "Stuff%", "Explosive%", "Recv SR%", "TCH", "TCH/G",
      // Added by this PR for the box score comparison sections (spec §4)
      "EPA / play", "Success rate", "1st down rate", "Explosive plays", "Toxic differential",
    ];
    expect(Object.keys(DEFINITION_TEXT).sort()).toEqual([...EXPECTED].sort());
    // …and no key is held open by an empty string.
    for (const key of EXPECTED) {
      expect(DEFINITION_TEXT[key]?.length ?? 0, `empty definition for "${key}"`).toBeGreaterThan(20);
    }
  });

  // Spec A §4.6 / T6: each entry below said something the code does not do.
  // The paired pytest pins (tests/, spec A T13) tie the same sentences to
  // scripts/ingest.py; these pin the text itself.
  it.each(["EPA/Tgt", "EPA/Car", "EPA/Play", "Rush EPA"])(
    "%s compares with the league average, not with zero",
    (key) => {
      const text = DEFINITION_TEXT[key];
      expect(text).not.toMatch(/above 0 = above average|positive = above-average/i);
      expect(text).toContain("league average");
    },
  );

  it("Success% is the EPA flag, for QBs and running backs", () => {
    const text = DEFINITION_TEXT["Success%"];
    expect(text).toMatch(/EPA above zero/);
    expect(text).toMatch(/sacks/);
    expect(text).toMatch(/running backs/);
    expect(text).not.toMatch(/gain enough yards|stay on schedule/);
  });

  it("Route% is the share of the team's dropbacks", () => {
    const text = DEFINITION_TEXT["Route%"];
    expect(text).toMatch(/team.{0,6}dropbacks/);
    expect(text).not.toMatch(/when on the field|typically 80/);
  });

  it("YPRR and TPRR say what a route is", () => {
    expect(DEFINITION_TEXT.YPRR).toMatch(/sacks and scrambles/);
    expect(DEFINITION_TEXT.TPRR).toContain("as in YPRR");
  });

  it("Total EPA names its plays and leaves QB designed runs out", () => {
    const text = DEFINITION_TEXT["Total EPA"];
    expect(text).toMatch(/designed runs aren.t included/);
    expect(text).not.toMatch(/across all plays/);
  });

  it("Recv SR% is about expected points, not moving the chains", () => {
    const text = DEFINITION_TEXT["Recv SR%"];
    expect(text).toContain("EPA above zero");
    expect(text).not.toMatch(/move the chains/);
  });

  it("renders nothing for an unknown metric", () => {
    const { container } = render(
      <TooltipProvider>
        <MetricTooltip metric="No such stat" />
      </TooltipProvider>
    );
    expect(container.innerHTML).toBe("");
  });
});
