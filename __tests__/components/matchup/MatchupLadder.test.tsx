// Direction A's ladder (team matchup spec §8): 13 lines in 5 groups, offense
// on the left, defense on the right, a tug marker and a verdict in the
// middle. It prints the model's strings only.
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import MatchupLadder, {
  DEF_RANK_ONE_LINE_MAX, LADDER_COLUMN_MD, LADDER_COLUMN_SM, LADDER_VALUE_MD, LADDER_VALUE_SM,
} from "@/components/matchup/MatchupLadder";
import { MATCHUP_LADDER_NOTE, MATCHUP_STATS, type LadderModel, type LadderRow } from "@/lib/stats/matchup";
import { ACCENT, awayBall, classes, code, homeBall, model, rowsWithout, source } from "./helpers";

const show = (ladder: LadderModel) => render(<MatchupLadder ladder={ladder} />).container;
const ladder = awayBall().ladder;
const rowEl = (el: HTMLElement, key: string) => el.querySelector(`[data-ladder-row="${key}"]`) as HTMLElement;
const ALL: LadderModel[] = [ladder, homeBall().ladder, awayBall("DET", "NO").ladder, homeBall("DET", "NO").ladder, awayBall("CHI", "PHI").ladder];
const RED = /213,\s*10,\s*10|#D50A0A/i;

describe("MatchupLadder", () => {
  it("13 rows in MATCHUP_STATS order under 5 group headings", () => {
    const el = show(ladder);
    expect(Array.from(el.querySelectorAll("[data-ladder-row]")).map((r) => r.getAttribute("data-ladder-row"))).toEqual(MATCHUP_STATS.map((s) => s.key));
    expect(Array.from(el.querySelectorAll("[data-ladder-group]")).map((g) => g.textContent)).toEqual(["Overall", "Passing", "Rushing", "Turnovers", "Downs"]);
  });

  it("the unit headings name the right teams: offense left, defense right", () => {
    const el = show(homeBall().ladder);
    expect(el.querySelector('[data-unit="off"] [data-unit-title]')?.textContent).toBe("HOU OFFENSE");
    expect(el.querySelector('[data-unit="off"]')?.textContent).toBe("HOU OFFENSEwhat it does");
    expect(el.querySelector('[data-unit="def"] [data-unit-title]')?.textContent).toBe("BUF DEFENSE");
    expect(el.querySelector('[data-unit="def"]')?.textContent).toBe("BUF DEFENSEwhat it allows");
    expect(el.querySelector("[data-ladder-how]")?.textContent).toBe(MATCHUP_LADDER_NOTE);
  });

  it("the head: two tracks below md with M15 on its own row; auto / 1fr / auto from md, headings nowrap only from md", () => {
    const el = show(ladder);
    const head = classes(el.querySelector("[data-ladder-head]"));
    expect(head).toContain("grid-cols-[minmax(0,1fr)_minmax(0,1fr)]");
    expect(head).toContain("md:grid-cols-[auto_minmax(0,1fr)_auto]");
    for (const unit of ["off", "def"]) {
      const title = classes(el.querySelector(`[data-unit="${unit}"] [data-unit-title]`));
      expect(title).toContain("md:whitespace-nowrap");
      expect(title).not.toContain("whitespace-nowrap");
    }
    const how = classes(el.querySelector("[data-ladder-how]"));
    expect(how).toContain("col-span-2");
    expect(how).toContain("md:col-span-1");
  });

  it("each row prints the model's strings: both values, both ranks, the defense word, the verdict", () => {
    for (const l of ALL) {
      const el = show(l);
      for (const r of l.rows) {
        const row = rowEl(el, r.key);
        expect(row.querySelector("[data-off-value]")?.textContent).toBe(r.offValue);
        expect(row.querySelector("[data-off-rank]")?.textContent).toBe(r.offRank);
        expect(row.querySelector("[data-def-value]")?.textContent).toBe(r.defValue);
        const cell = row.querySelector("[data-def-rank]")!;
        if (r.defRank === "—") {
          expect(cell.textContent).toBe("—");
        } else {
          expect(cell.querySelector("[data-def-rank-stacked] [data-rank]")?.textContent).toBe(r.defRank);
          expect(cell.querySelector("[data-def-rank-stacked] [data-word]")?.textContent).toBe(r.defWord);
        }
        expect(row.querySelector("[data-verdict]")?.textContent).toBe(r.verdict);
      }
    }
  });

  // Chaos 6 / review nit 6: "4th ·" on one line and "allowed" on the next. The
  // cell now breaks on purpose. Stacked (rank, then the word, NO dot) below md
  // always, and from md whenever the one-line text would be longer than the
  // column holds; one line with the dot only from md and only when it fits.
  describe("the defense rank cell never leaves a dot dangling", () => {
    const rowWith = (defRank: string, defWord: string): LadderModel => ({
      offId: "BUF", defId: "HOU", rows: [{ ...ladder.rows[0], defRank, defWord }],
    });
    const cell = (defRank: string, defWord: string) => show(rowWith(defRank, defWord)).querySelector("[data-def-rank]") as HTMLElement;

    it("the stacked form is two block lines and holds no dot", () => {
      const c = cell("4th", "allowed");
      const stacked = c.querySelector("[data-def-rank-stacked]")!;
      expect(stacked.textContent).toBe("4thallowed");
      expect(stacked.textContent).not.toContain("·");
      for (const part of ["[data-rank]", "[data-word]"]) expect(classes(stacked.querySelector(part))).toContain("block");
    });

    it.each([["4th", "allowed"], ["26th", "made"], ["3rd", "takeaways"], ["T-4th", "allowed"], ["T-32nd", "made"], ["32nd", "allowed"]])(
      "%s / %s fits one line from md: stacked below md, \"rank · word\" from md",
      (rank, word) => {
        const c = cell(rank, word);
        expect(`${rank} · ${word}`.length).toBeLessThanOrEqual(DEF_RANK_ONE_LINE_MAX);
        expect(classes(c.querySelector("[data-def-rank-stacked]"))).toContain("md:hidden");
        const inline = c.querySelector("[data-def-rank-inline]")!;
        expect(inline.textContent).toBe(`${rank} · ${word}`);
        expect(classes(inline)).toEqual(expect.arrayContaining(["hidden", "md:inline"]));
      },
    );

    it.each([["T-14th", "takeaways"], ["14th of 29", "allowed"], ["T-3rd of 31", "made"], ["22nd", "takeaways"], ["32nd", "takeaways"], ["T-30th", "allowed"]])(
      "%s / %s does not fit: stacked at every width, and no one-line form at all",
      (rank, word) => {
        const c = cell(rank, word);
        expect(`${rank} · ${word}`.length).toBeGreaterThan(DEF_RANK_ONE_LINE_MAX);
        expect(c.querySelector("[data-def-rank-inline]")).toBeNull();
        expect(classes(c.querySelector("[data-def-rank-stacked]"))).not.toContain("md:hidden");
        expect(c.textContent).not.toContain("·");
      },
    );

    // Measured in a browser on 2026-10-10 (week 5's 15 pairs, both tabs, 768
    // and 1280 px): at 16 characters "22nd · takeaways" and "32nd · takeaways"
    // wrapped in the 104 px column ("24th · takeaways" did not), so 16 is
    // stacked and the one-line limit is 15.
    it("the limit is 15 characters: a 16-character line (\"22nd · takeaways\") was measured wrapping", () => {
      expect(DEF_RANK_ONE_LINE_MAX).toBe(15);
      expect("22nd · takeaways").toHaveLength(16);
      expect("3rd · takeaways").toHaveLength(15);
    });

    it("no rank: a dash alone, no word and no dot", () => {
      const c = cell("—", "allowed");
      expect(c.textContent).toBe("—");
    });
  });

  it("each row prints both labels: the long one from md, the short one below it", () => {
    const el = show(ladder);
    for (const r of ladder.rows) {
      const long = rowEl(el, r.key).querySelector("[data-label-long]")!;
      const short = rowEl(el, r.key).querySelector("[data-label-short]")!;
      expect(long.textContent).toBe(r.label);
      expect(short.textContent).toBe(r.shortLabel);
      expect(classes(long)).toEqual(expect.arrayContaining(["hidden", "md:block"]));
      expect(classes(short)).toContain("md:hidden");
      expect(classes(short)).not.toContain("hidden");
    }
    expect(ladder.rows.some((r) => r.label !== r.shortLabel)).toBe(true);
  });

  it("even and na rows: a hollow grey marker, no bar, no red; lean and clear rows: a red marker and a red bar", () => {
    const seen = new Set<string>();
    for (const l of [...ALL, model("BUF", "HOU", rowsWithout("BUF")).awayBall!.ladder]) {
      const el = show(l);
      for (const r of l.rows) {
        seen.add(r.edge.side === "na" || r.edge.side === "even" ? r.edge.side : `level${r.edge.level}`);
        const row = rowEl(el, r.key);
        const marker = row.querySelector("[data-tug-marker]") as HTMLElement;
        const bar = row.querySelector("[data-tug-bar]") as HTMLElement | null;
        expect(marker.style.left).toBe(`${r.tug}%`);
        if (r.edge.level === 0) {
          expect(marker.getAttribute("data-hollow")).toBe("true");
          expect(bar).toBeNull();
          expect(row.outerHTML).not.toMatch(RED);
        } else {
          expect(marker.getAttribute("data-hollow")).toBeNull();
          expect(marker.getAttribute("style")).toMatch(RED);
          expect(bar!.getAttribute("style")).toMatch(RED);
          // the bar runs from the middle to the marker
          expect(bar!.style.left).toBe(`${Math.min(50, r.tug)}%`);
          expect(bar!.style.width).toBe(`${Math.abs(50 - r.tug)}%`);
        }
      }
    }
    expect(Array.from(seen).sort()).toEqual(["even", "level1", "level2", "na"]);
  });

  it("the three verdict forms appear as the model wrote them", () => {
    const texts = ALL.flatMap((l) => Array.from(show(l).querySelectorAll("[data-verdict]")).map((v) => v.textContent!));
    expect(texts.some((t) => / (offense|defense) by \d+ places$/.test(t))).toBe(true);
    expect(texts.some((t) => /clear edge$/.test(t))).toBe(true);
    expect(texts.some((t) => /places? apart$|same rank$/.test(t))).toBe(true);
  });

  it("a team that has not played: dashes, every row na, no red", () => {
    const side = model("BUF", "HOU", rowsWithout("BUF")).awayBall!;
    const el = show(side.ladder);
    expect(el.querySelectorAll("[data-tug-bar]")).toHaveLength(0);
    expect(Array.from(el.querySelectorAll("[data-off-value]")).every((v) => v.textContent === "—")).toBe(true);
    expect(Array.from(el.querySelectorAll("[data-verdict]")).every((v) => v.textContent === "Not enough data")).toBe(true);
  });

  it("survives a row list that is empty or short (never throws)", () => {
    expect(() => show({ offId: "BUF", defId: "HOU", rows: [] })).not.toThrow();
    expect(() => show({ offId: "BUF", defId: "HOU", rows: [ladder.rows[0]] as LadderRow[] })).not.toThrow();
  });
});

describe("ladder numerals fit their columns (§8.4): Barlow Condensed at 0.50 em a character", () => {
  it("six characters (−0.195, 100.0%) fit the 104 px and the 70 px column", () => {
    expect([LADDER_COLUMN_MD, LADDER_COLUMN_SM]).toEqual([104, 70]);
    expect(6 * 0.5 * LADDER_VALUE_MD).toBeLessThanOrEqual(LADDER_COLUMN_MD);
    expect(6 * 0.5 * LADDER_VALUE_SM).toBeLessThanOrEqual(LADDER_COLUMN_SM);
  });

  it("the class strings carry exactly those numbers (Tailwind needs the literal)", () => {
    const src = source("MatchupLadder.tsx");
    expect(src).toContain(`grid-cols-[${LADDER_COLUMN_SM}px_minmax(0,1fr)_${LADDER_COLUMN_SM}px]`);
    expect(src).toContain(`md:grid-cols-[${LADDER_COLUMN_MD}px_minmax(0,1fr)_${LADDER_COLUMN_MD}px]`);
    expect(src).toContain(`text-[${LADDER_VALUE_SM}px]`);
    expect(src).toContain(`md:text-[${LADDER_VALUE_MD}px]`);
    expect(src).toContain("tabular-nums");
  });

  it("the accent is written once in the ladder (the marker and the bar share it)", () => {
    expect(code("MatchupLadder.tsx").split(ACCENT).length - 1).toBe(1);
  });
});
