import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ComponentType } from "react";

// Read resilience spec §1.4 / §1.6 (review M8). After PR 1A a failed read
// reaches these boundaries far more often (it used to render as an empty page
// or a 404), so each one's visitor-facing title is pinned here. Before this
// file only app/game/[game_id]/error.tsx had a test (game-error.test.tsx).
//
// What this cannot show: that Next hands a page's rejection to the nearest
// error.tsx. That join needs Next's runtime; the route tests show each page
// function rejects, and the forced-failure run (spec §1.7) checks the rest.
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
  useParams: () => ({ game_id: "2026_01_BUF_HOU" }),
}));

import RootError from "@/app/error";
import CompareError from "@/app/compare/error";
import GameError from "@/app/game/[game_id]/error";
import MatchupError from "@/app/matchup/error";
import PlayerError from "@/app/player/[slug]/error";
import QBError from "@/app/qb-leaderboard/error";
import ReceiversError from "@/app/receivers/error";
import RunGapsError from "@/app/run-gaps/error";
import RushingError from "@/app/rushing/error";
import TeamError from "@/app/team/[team_id]/error";
import TeamStatsError from "@/app/team-stats/error";
import TeamsError from "@/app/teams/error";
import TrendsError from "@/app/trends/error";

type Boundary = ComponentType<{ error: Error & { digest?: string }; reset: () => void }>;

const BOUNDARIES: [string, Boundary, string][] = [
  ["app/error.tsx (/ and /card)", RootError as Boundary, "Something went wrong"],
  ["app/compare/error.tsx", CompareError as Boundary, "Something went wrong"],
  ["app/game/[game_id]/error.tsx", GameError as Boundary, "Unable to load this box score"],
  ["app/matchup/error.tsx (/matchup and /matchup/[away]/[home])", MatchupError as Boundary, "Unable to load matchups"],
  ["app/player/[slug]/error.tsx", PlayerError as Boundary, "Unable to load player data"],
  ["app/qb-leaderboard/error.tsx", QBError as Boundary, "Unable to load QB data"],
  ["app/receivers/error.tsx", ReceiversError as Boundary, "Unable to load receiver data"],
  ["app/run-gaps/error.tsx", RunGapsError as Boundary, "Unable to load run gap data"],
  ["app/rushing/error.tsx", RushingError as Boundary, "Unable to load rushing data"],
  ["app/team/[team_id]/error.tsx", TeamError as Boundary, "Unable to load team data"],
  ["app/team-stats/error.tsx", TeamStatsError as Boundary, "Unable to load team stats"],
  ["app/teams/error.tsx", TeamsError as Boundary, "Unable to load team data"],
  ["app/trends/error.tsx", TrendsError as Boundary, "Unable to load trend data"],
];

const ERROR = Object.assign(new Error("Failed to fetch seasons: TypeError: fetch failed"), { digest: "abc123" });

beforeEach(() => {
  refresh.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("route error boundaries", () => {
  it("covers every error.tsx under app/", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const root = path.resolve(__dirname, "../../app");
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) walk(path.join(dir, entry.name));
        else if (entry.name === "error.tsx") found.push(path.join(dir, entry.name));
      }
    };
    walk(root);
    expect(found).toHaveLength(BOUNDARIES.length);
  });

  it.each(BOUNDARIES)("%s shows its title, the shared message and both buttons", (_file, Boundary, title) => {
    render(<Boundary error={ERROR} reset={vi.fn()} />);
    expect(screen.getByRole("heading", { name: title })).toBeTruthy();
    expect(
      screen.getByText("Something went wrong loading this page. Try refreshing, or come back in a few minutes."),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Report issue" })).toBeTruthy();
  });

  it.each(BOUNDARIES)("%s: 'Try again' re-runs the server render once and clears the boundary once", (_file, Boundary) => {
    const reset = vi.fn();
    render(<Boundary error={ERROR} reset={reset} />);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it.each(BOUNDARIES)("%s never shows the raw error text to the visitor", (_file, Boundary) => {
    const { container } = render(<Boundary error={ERROR} reset={vi.fn()} />);
    expect(container.textContent).not.toContain("fetch failed");
    expect(container.textContent).not.toContain("abc123");
  });
});
