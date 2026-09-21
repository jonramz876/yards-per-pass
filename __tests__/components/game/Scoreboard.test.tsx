import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import Scoreboard from "@/components/game/Scoreboard";
import { buildScoreboard } from "@/lib/stats/box-score";
import { BUF_HOU_GAME } from "../../fixtures/box-score-buf-hou";

const today = new Date(2026, 8, 21);
const model = buildScoreboard(BUF_HOU_GAME, { wins: 1, losses: 0, ties: 0 }, { wins: 0, losses: 1, ties: 0 }, today);

describe("Scoreboard", () => {
  it("renders the band, both teams with records, and the winner's score in gold", () => {
    const { container } = render(<Scoreboard model={model} />);
    expect(container.querySelector("[data-scoreboard-label]")?.textContent).toBe("WEEK 1 · SUN SEP 13");
    expect(container.textContent).toContain("FINAL");
    const away = container.querySelector('[data-scoreboard-team="away"]')!;
    expect(away.getAttribute("href")).toBe("/team/BUF");
    expect(away.getAttribute("title")).toBe("Buffalo Bills team page");
    expect(away.textContent).toBe("BUFBills · 1-0");
    expect(away.querySelector("img")?.getAttribute("alt")).toBe("Buffalo Bills");
    const home = container.querySelector('[data-scoreboard-team="home"]')!;
    expect(home.getAttribute("href")).toBe("/team/HOU");
    expect(home.textContent).toBe("HOUTexans · 0-1");
    expect((container.querySelector('[data-score="away"]') as HTMLElement).style.color).toBe("rgb(251, 191, 36)");
    expect((container.querySelector('[data-score="home"]') as HTMLElement).style.color).toBe("");
    expect(container.querySelector("[data-scoreboard-score]")?.textContent).toBe("36–31");
  });

  it("puts the away team first, the order spec §6 requires (away @ home)", () => {
    const { container } = render(<Scoreboard model={model} />);
    const sides = Array.from(container.querySelectorAll("[data-scoreboard-team]"));
    expect(sides.map((el) => el.getAttribute("data-scoreboard-team"))).toEqual(["away", "home"]);
    const scores = Array.from(container.querySelectorAll("[data-score]"));
    expect(scores.map((el) => el.getAttribute("data-score"))).toEqual(["away", "home"]);
  });

  it("omits the date when unknown and the logo when the team is unknown", () => {
    const { container } = render(
      <Scoreboard model={{ ...model, dateLabel: "", away: { ...model.away, logo: "", winner: false }, home: { ...model.home, winner: false } }} />
    );
    expect(container.querySelector("[data-scoreboard-label]")?.textContent).toBe("WEEK 1");
    expect(container.querySelectorAll("img")).toHaveLength(1);
    expect((container.querySelector('[data-score="away"]') as HTMLElement).style.color).toBe("");
  });

  // The assertion below used to sit on a model whose every field was already a
  // formatted string, so no path in the component could have produced the
  // words it looks for. Point it at the model's actual numbers instead: a 0-0
  // final is a played game (lib/data/box-score.ts gates on `=== null`, not on
  // falsiness), so both zeroes must print as "0" rather than a dash, a blank
  // or the word "null" — and neither side is the winner.
  it("prints a 0-0 final as two zeroes, with no winner and no stray undefined or NaN", () => {
    const zeroes = buildScoreboard(
      { ...BUF_HOU_GAME, away_score: 0, home_score: 0 },
      { wins: 0, losses: 0, ties: 1 },
      { wins: 0, losses: 0, ties: 1 },
      today
    );
    const { container } = render(<Scoreboard model={zeroes} />);
    expect(container.querySelector("[data-scoreboard-score]")?.textContent).toBe("0–0");
    expect(container.querySelector('[data-score="away"]')?.textContent).toBe("0");
    expect(container.querySelector('[data-score="home"]')?.textContent).toBe("0");
    expect((container.querySelector('[data-score="away"]') as HTMLElement).style.color).toBe("");
    expect((container.querySelector('[data-score="home"]') as HTMLElement).style.color).toBe("");
    expect(container.querySelector('[data-scoreboard-team="away"]')?.textContent).toBe("BUFBills · 0-0-1");
    expect(container.textContent).not.toMatch(/undefined|NaN|null/);
  });
});
